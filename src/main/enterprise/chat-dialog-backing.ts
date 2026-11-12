import { randomUUID } from 'node:crypto'
import type { EnterpriseChatFrame } from '../../shared/enterprise-chat-view'

interface BackingOwner {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    executeJavaScript(script: string): Promise<unknown>
  }
}

/** Owner pixels remain visible while its native child replaces a resized surface. */
export function chatDialogBackingScript(scope: string, revision: number, frame: EnterpriseChatFrame): string {
  const { bounds } = frame
  return `(async () => {
    const key = '__dshChatDialogBacking';
    window[key]?.cancel();
    const image = document.createElement('img');
    image.id = 'dsh-chat-dialog-backing';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.style.cssText = ${JSON.stringify(`position:fixed;left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px;object-fit:fill;pointer-events:none;z-index:900;`)};
    const state = { scope: ${JSON.stringify(scope)}, revision: ${revision}, cancel: () => image.remove() };
    window[key] = state;
    document.body.appendChild(image);
    image.src = ${JSON.stringify(frame.dataURL)};
    await image.decode();
    if (window[key] !== state) { image.remove(); return false; }
    await new Promise(resolve => {
      let first, second, timer, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(timer);
        resolve();
      };
      state.cancel = () => { image.remove(); finish(); };
      timer = setTimeout(finish, 200);
      first = requestAnimationFrame(() => { second = requestAnimationFrame(finish); });
    });
    return window[key] === state && image.isConnected;
  })()`
}

export function clearChatDialogBackingScript(scope: string, revision: number): string {
  return `(() => {
    const key = '__dshChatDialogBacking';
    if (window[key]?.scope !== ${JSON.stringify(scope)} || window[key].revision > ${revision}) return;
    window[key].cancel();
    delete window[key];
  })()`
}

/** One backing belongs to this view/account, including capture and decode races. */
export class ChatDialogBacking {
  private readonly scope = randomUUID()
  private revision = 0
  private active = false
  private disposed = false

  constructor(
    private owner: BackingOwner,
    private capture: () => Promise<EnterpriseChatFrame | undefined>,
    private paint: () => Promise<unknown>,
    private note: (line: string) => void
  ) {}

  async hold(): Promise<void> {
    const revision = ++this.revision
    try {
      const frame = await this.capture()
      if (this.disposed || revision !== this.revision || this.owner.isDestroyed()) return
      if (!frame) { this.note('[enterprise-chat] dialog_backing_unavailable'); return }
      const active = await this.deliver(chatDialogBackingScript(this.scope, revision, frame))
      if (!this.disposed && revision === this.revision) this.active = Boolean(active)
    } catch (error) {
      if (this.disposed || revision !== this.revision) return
      this.note(`[enterprise-chat] dialog_backing_failed: ${error instanceof Error ? error.message : 'unknown capture error'}`)
      await this.clear(revision)
    }
  }

  async release(): Promise<void> {
    const revision = ++this.revision
    if (this.active) {
      try { await this.paint() }
      catch (error) { this.note(`[enterprise-chat] dialog_backing_paint_failed: ${error instanceof Error ? error.message : 'unknown paint error'}`) }
    }
    if (this.disposed || revision !== this.revision) return
    await this.clear(revision)
  }

  dispose(): void {
    this.disposed = true
    void this.clear(++this.revision)
  }

  private async deliver(script: string): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([this.owner.webContents.executeJavaScript(script),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owner paint timed out.')), 750) })])
    } finally { clearTimeout(timer) }
  }

  private async clear(revision: number): Promise<void> {
    this.active = false
    if (this.owner.isDestroyed() || this.owner.webContents.isDestroyed()) return
    try { await this.deliver(clearChatDialogBackingScript(this.scope, revision)) }
    catch (error) { this.note(`[enterprise-chat] dialog_backing_cleanup_failed: ${error instanceof Error ? error.message : 'unknown cleanup error'}`) }
  }
}
