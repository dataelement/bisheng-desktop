import { BrowserWindow, shell } from 'electron'
import type { HostedAppIdentity } from './hosted-app-session'
import { hostedAppTarget } from './hosted-app-url'

export interface HostedAppWindowOptions {
  acquire: () => Promise<HostedAppIdentity>
  /** Host conventions shared with other Desktop windows, such as the context menu. */
  prepare?: (window: BrowserWindow) => void
  note: (line: string) => void
}

/**
 * Hosted apps opened from the embedded web workspace (Chat → Apps / App square).
 * The page asks for a new tab; the system browser would make the user sign in
 * again, and navigating Chat itself away from /workspace is treated as a failed
 * session (see chat-view.ts). Each app therefore opens in its own Desktop window
 * with the user's web login, and closing it returns to the list, untouched.
 */
export class HostedAppWindows {
  private readonly windows = new Map<string, BrowserWindow>()

  constructor(private readonly options: HostedAppWindowOptions) {}

  async open(url: string, origin: string): Promise<void> {
    const identity = await this.options.acquire()
    // The web page chose the address; it must still be this enterprise's app path.
    const target = identity.origin === origin ? hostedAppTarget(url, identity.origin) : undefined
    if (!target) throw new Error('Not a hosted application of the signed-in enterprise.')
    const key = `${identity.connectionKey}:${target.slug}`
    const existing = this.windows.get(key)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return
    }
    const window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 480, minHeight: 360, autoHideMenuBar: true, title: target.slug,
      webPreferences: { session: identity.session, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false }
    })
    this.windows.set(key, window)
    window.on('closed', () => { if (this.windows.get(key) === window) this.windows.delete(key) })
    const contents = window.webContents
    contents.setWindowOpenHandler(({ url: next }) => {
      if (hostedAppTarget(next, identity.origin)) {
        void this.open(next, identity.origin).catch(error => this.fail(next, error))
      } else if (/^https?:\/\//u.test(next)) {
        void shell.openExternal(next).catch(() => this.options.note('[hosted-app] external_link_failed'))
      }
      return { action: 'deny' }
    })
    // Pages stay on this enterprise (the app itself, or its login when the cookie
    // lapsed). Other sites belong in the user's browser.
    contents.on('will-navigate', (event, next) => {
      if (sameOrigin(next, identity.origin)) return
      event.preventDefault()
      if (/^https?:\/\//u.test(next)) void shell.openExternal(next).catch(() => this.options.note('[hosted-app] external_link_failed'))
    })
    contents.on('will-redirect', (event, next) => { if (!sameOrigin(next, identity.origin)) event.preventDefault() })
    contents.on('will-attach-webview', event => event.preventDefault())
    this.options.prepare?.(window)
    try {
      await window.loadURL(target.url)
    } catch (error) {
      // Chromium already shows its own error page in the window; keep it for the user.
      this.options.note(`[hosted-app] load_failed ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  /** Account changes end every page opened with the previous identity. */
  closeAll(): void {
    const windows = [...this.windows.values()]
    this.windows.clear()
    for (const window of windows) if (!window.isDestroyed()) window.close()
  }

  /** Falls back to the system browser so a failed in-app open never strands the user. */
  fail(url: string, error: unknown): void {
    this.options.note(`[hosted-app] open_failed ${error instanceof Error ? error.message : 'unknown'}`)
    if (/^https?:\/\//u.test(url)) void shell.openExternal(url).catch(() => this.options.note('[hosted-app] external_link_failed'))
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin } catch { return false }
}
