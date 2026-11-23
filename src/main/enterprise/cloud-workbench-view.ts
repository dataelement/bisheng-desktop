import { WebContentsView, shell, type BrowserWindow, type Session } from 'electron'
import type { CloudEntry } from './cloud-workbench'

export interface CloudBounds { x: number; y: number; width: number; height: number }
export function cloudBounds(input: unknown, width: number, height: number): CloudBounds {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud view bounds.')
  const value = input as Record<string, unknown>
  const fields = ['x', 'y', 'width', 'height'] as const
  if (fields.some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error('Invalid cloud view bounds.')
  const x = Math.max(0, Math.min(width, Math.floor(value.x as number)))
  const y = Math.max(0, Math.min(height, Math.floor(value.y as number)))
  return { x, y, width: Math.max(0, Math.min(width - x, Math.floor(value.width as number))),
    height: Math.max(0, Math.min(height - y, Math.floor(value.height as number))) }
}
interface RetainedView { view: WebContentsView; session: Session; connectionKey: string; appId: string }

/**
 * Embedded hosted app pages for the workbench page. Pages run unprivileged in
 * the account's hosted-app session (hosted-app-session.ts), which holds the
 * user's web login; that session owns cookie renewal and cleanup, so closing a
 * page here never clears storage another page still uses.
 */
export class CloudWorkbenchView {
  private readonly retained = new Map<string, RetainedView>()
  private active: RetainedView | undefined
  private owner: string | undefined
  private generation = 0
  private hostOccluded = false
  private attached = false
  private connectionKey: string | undefined
  private parent: BrowserWindow | undefined
  private timer: NodeJS.Timeout | undefined
  private readonly onParentClosed = () => this.close()

  async open(parent: BrowserWindow, entry: CloudEntry, bounds: unknown, owner: string, currentKey: () => string | undefined, pageSession: Session): Promise<void> {
    this.hide()
    if (this.connectionKey && this.connectionKey !== entry.connectionKey) this.close()
    const generation = ++this.generation
    this.parent?.removeListener('closed', this.onParentClosed)
    this.parent = parent
    // Owner closure must also cancel an open that is still loading behind an overlay.
    this.owner = owner
    parent.once('closed', this.onParentClosed)
    this.connectionKey = entry.connectionKey
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => { if (currentKey() !== this.connectionKey) this.close() }, 500)
    this.timer.unref()
    const cacheKey = `${entry.connectionKey}:${entry.appId}`
    let item = this.retained.get(cacheKey)
    // A page from a signed-out identity cannot be reused even under the same account key.
    if (item && item.session !== pageSession) {
      this.retained.delete(cacheKey)
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
      item = undefined
    }
    let created = false
    let superseded = false
    try {
      if (!item) {
        if (this.retained.size >= 8) throw new Error('Eight cloud workbenches are open. Reconnect to release inactive pages.')
        const view = new WebContentsView({ webPreferences: { session: pageSession, sandbox: true, contextIsolation: true,
          nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false } })
        item = { view, session: pageSession, connectionKey: entry.connectionKey, appId: entry.appId }
        this.retained.set(cacheKey, item)
        created = true
        const home = new URL(entry.entryUrl)
        const allowed = (url: string): boolean => {
          try { const next = new URL(url); return next.origin === home.origin && next.pathname.startsWith(home.pathname) } catch { return false }
        }
        view.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
          return { action: 'deny' }
        })
        // The page stays inside its app. A lapsed or refused web login sends it to the
        // platform login (as a navigation or as the proxy's redirect); the host then
        // asks the user to reopen, which signs a fresh web session.
        const leave = (event: Electron.Event, url: string) => {
          if (allowed(url)) return
          event.preventDefault()
          let target: URL
          try { target = new URL(url) } catch { return }
          if (target.origin === home.origin && /\/(?:admin|login)(?:\/|$)/u.test(target.pathname) && this.active?.view === view) {
            parent.webContents.send('enterprise-cloud:access-required', { owner: this.owner, appId: entry.appId })
            this.hide()
          }
        }
        view.webContents.on('will-navigate', leave)
        view.webContents.on('will-redirect', leave)
        view.webContents.on('will-attach-webview', event => event.preventDefault())
        await view.webContents.loadURL(entry.entryUrl)
      }
      if (generation !== this.generation || this.retained.get(cacheKey) !== item) {
        superseded = true
        throw new Error('Cloud workbench opening was cancelled.')
      }
      if (currentKey() !== entry.connectionKey) {
        this.close()
        throw new Error('Enterprise account changed.')
      }
      this.active = item
      this.owner = owner
      this.resize(bounds)
      this.attach()
    } catch (error) {
      // Superseded opens may share a retained page with the newer open.
      if (!superseded && created && item && this.retained.get(cacheKey) === item) {
        this.retained.delete(cacheKey)
        if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
      }
      if (generation === this.generation) this.hide()
      throw error
    }
  }

  resize(bounds: unknown): void {
    if (!this.active || !this.parent || this.parent.isDestroyed()) return
    const [width, height] = this.parent.getContentSize()
    this.active.view.setBounds(cloudBounds(bounds, width ?? 0, height ?? 0))
  }
  resizeFor(owner: unknown, bounds: unknown): void { if (owner === this.owner) this.resize(bounds) }
  closeFor(owner: unknown): void { if (owner === this.owner) { this.generation++; this.hide() } }

  async release(appId: string, connectionKey: string): Promise<void> {
    const key = `${connectionKey}:${appId}`
    const item = this.retained.get(key)
    if (!item) return
    this.retained.delete(key)
    if (this.active === item) this.hide()
    if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
  }

  async capture(parent: BrowserWindow): Promise<{ dataURL: string; bounds: CloudBounds } | undefined> {
    const item = this.active, generation = this.generation
    if (parent !== this.parent || parent.isDestroyed() || !item || !this.attached || item.view.webContents.isDestroyed()) return
    const bounds = item.view.getBounds()
    const url = item.view.webContents.getURL()
    let timeout: NodeJS.Timeout | undefined
    try {
      const image = await Promise.race([item.view.webContents.capturePage(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Cloud backing capture timed out.')), 1500)
      })])
      // A mode/account change or resize must never paint an old page into a new seat.
      if (generation !== this.generation || item !== this.active || !this.attached || parent.isDestroyed() ||
        item.view.webContents.isDestroyed() || url !== item.view.webContents.getURL() ||
        JSON.stringify(bounds) !== JSON.stringify(item.view.getBounds()) || image.isEmpty()) return
      return { dataURL: image.toDataURL(), bounds }
    } catch (error) {
      console.warn('[cloud-workbench] overlay capture failed', error)
      return undefined
    } finally { clearTimeout(timeout) }
  }

  setHostOccluded(occluded: boolean): void {
    if (this.hostOccluded === occluded) return
    this.hostOccluded = occluded
    if (occluded) {
      // Keep the logical selection and native bounds; host overlays own input.
      this.detach()
      if (this.parent && !this.parent.isDestroyed()) this.parent.webContents.focus()
    } else {
      this.attach()
    }
  }

  private attach(): void {
    if (this.hostOccluded || this.attached || !this.active || !this.parent || this.parent.isDestroyed() || this.active.view.webContents.isDestroyed()) return
    this.parent.contentView.addChildView(this.active.view)
    this.attached = true
  }

  private detach(): void {
    if (this.attached && this.active && this.parent && !this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.active.view)
    this.attached = false
  }

  private hide(): void {
    this.detach()
    this.active = undefined
    this.owner = undefined
  }

  close(): void {
    this.generation++
    this.hide()
    this.parent?.removeListener('closed', this.onParentClosed)
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const item of this.retained.values()) {
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
    }
    this.retained.clear()
    this.parent = undefined
    this.connectionKey = undefined
  }
}
