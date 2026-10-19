import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { session, shell, WebContentsView, type BrowserWindow, type Session } from 'electron'
import { parseEnterpriseNavigation, parseChatPage, parseChatId, parseChatPresentation, type EnterpriseChatHistory, type EnterpriseChatPresentation, type EnterpriseChatViewState } from '../../shared/enterprise-chat-view'
import type { EnterpriseDesktopRuntime } from './enterprise-desktop'

/** Remote Chat gets its own in-memory browser session and a presentation-only preload. */
export class EnterpriseChatView {
  private landing?: boolean
  private navigation?: ReturnType<typeof parseEnterpriseNavigation>
  private navigationRequest = 0
  private origin?: string
  private routes = new Map<string, string>()
  private view?: WebContentsView
  private isolated?: Session
  private owner?: BrowserWindow
  private key?: string
  private generation = 0
  private timer?: NodeJS.Timeout
  private pending?: Promise<void>
  private unsubscribe: () => void
  private state: EnterpriseChatViewState = { phase: 'idle' }
  private presentation?: EnterpriseChatPresentation

  constructor(private enterprise: EnterpriseDesktopRuntime, private note: (line: string) => void) {
    this.unsubscribe = enterprise.subscribe((state) => {
      if (!state.connected || state.connectionKey !== this.key) this.clear()
      if (state.connected && this.presentation?.visible && this.owner && !this.owner.isDestroyed()) {
        void this.connect()
      }
    })
  }

  snapshot(): EnterpriseChatViewState {
    return { ...this.state, navigation: this.navigation, path: this.view ? new URL(this.view.webContents.getURL() || 'about:blank').pathname.replace(/^\/workspace/u, '') : undefined, landing: this.landing, epoch: this.generation, conversationId: this.view?.webContents.getURL().match(/\/workspace\/(?:c|chat|linsight)\/([a-zA-Z0-9_-]+)/u)?.[1], connected: this.enterprise.snapshot().connected }
  }

  private notify(): void {
    if (this.owner && !this.owner.isDestroyed()) this.owner.webContents.send('enterprise-chat:changed', this.snapshot())
  }

  present(window: BrowserWindow, input: unknown): EnterpriseChatViewState {
    this.presentation = parseChatPresentation(input)
    if (this.owner !== window) {
      this.clear()
      this.owner = window
      window.once('closed', () => { this.clear(); this.owner = undefined })
      window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame && this.presentation) { this.presentation.visible = false; this.layout() }
      })
    }
    this.layout()
    if (this.presentation.visible && this.enterprise.snapshot().connected && !this.view) void this.connect()
    return this.snapshot()
  }

  retry(): void { this.clear(); void this.connect() }

  /** Fixed read-only endpoint. The isolated cookie stays in the host session. */
  async history(input: unknown): Promise<EnterpriseChatHistory> {
    const page = parseChatPage(input)
    const epoch = this.generation
    if (this.state.phase !== 'ready') await this.connect()
    if (epoch !== this.generation || !this.isolated || !this.origin || !this.enterprise.snapshot().connected) throw new Error('Chat identity changed.')
    const response = await this.isolated.fetch(new URL(`/api/v1/chat/list?page=${page}&limit=40`, this.origin).href, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Chat history unavailable.')
    const result = await response.json() as { data?: unknown }
    if (epoch !== this.generation) throw new Error('Chat identity changed.')
    if (!Array.isArray(result.data) || result.data.length > 40) throw new Error('Invalid Chat history.')
    const items = result.data.map((row: Record<string, unknown>) => {
      const id = parseChatId(row.chat_id)
      const flowType = Number(row.flow_type)
      const route = flowType === 20 ? `/workspace/linsight/${id}` : [1, 5, 10].includes(flowType) ? `/workspace/chat/${id}/${parseChatId(String(row.flow_id))}/${flowType}` : `/workspace/c/${id}`
      this.routes.set(id, route)
      return { id, title: String(row.name || row.flow_name || '').slice(0, 500), updatedAt: String(row.update_time || row.create_time || '').slice(0, 50) }
    })
    return { epoch, items, hasMore: items.length === 40 }
  }

  async open(input: unknown): Promise<void> {
    const id = parseChatId(input)
    const epoch = this.generation
    if (this.state.phase !== 'ready') await this.connect()
    if (epoch !== this.generation || !this.view || !this.origin) throw new Error('Chat unavailable.')
    const route = id === 'new' ? '/workspace/c/new' : this.routes.get(id)
    if (!route) throw new Error('Select a conversation from current Chat history.')
    await this.navigate(route)
  }

  /** Only current, account-published module identities can be opened by the host. */
  async openPage(input: unknown): Promise<void> {
    const id = parseChatId(input)
    const entry = this.navigation?.entries.find(item => item.id === id)
    if (!entry || !this.enterprise.snapshot().connected) throw new Error('Enterprise page unavailable.')
    await this.navigate(`/workspace${entry.path}`)
  }

  private async navigate(route: string): Promise<void> {
    const view = this.view, origin = this.origin, epoch = this.generation
    if (!view || !origin) throw new Error('Enterprise page unavailable.')
    const current = new URL(view.webContents.getURL())
    current.searchParams.delete('embed')
    current.searchParams.delete('dshTheme')
    if (current.pathname + current.search === route) return
    const request = ++this.navigationRequest
    const accepted = await view.webContents.executeJavaScript(`(() => {
      const event = new CustomEvent('dsh:navigate', { detail: { path: ${JSON.stringify(route.slice('/workspace'.length))} }, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`)
    if (request !== this.navigationRequest || epoch !== this.generation || this.view !== view) return
    if (accepted === true) return
    this.state = { phase: 'loading' }
    this.layout()
    await view.webContents.loadURL(this.entryURL(route, origin))
  }

  private layout(): void {
    if (!this.view || !this.owner || this.owner.isDestroyed() || !this.presentation) return
    const { bounds, visible, theme } = this.presentation
    this.view.setVisible(visible && this.state.phase === 'ready')
    if (!visible) return
    const zoom = this.owner.webContents.getZoomFactor()
    const [width = 0, height = 0] = this.owner.getContentSize()
    const x = Math.max(0, Math.round(bounds.x * zoom))
    const y = Math.max(0, Math.round(bounds.y * zoom))
    this.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width * zoom))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height * zoom))) })
    this.view.setBackgroundColor(theme === 'dark' ? '#141416' : '#ffffff')
    if (this.state.phase === 'ready') {
      void this.view.webContents.executeJavaScript(`document.documentElement.dataset.dshHostTheme = '${theme}'; window.dispatchEvent(new CustomEvent('dsh:appearance', { detail: { theme: '${theme}' } }))`).catch(() => this.note('[enterprise-chat] appearance_delivery_failed'))
    }
  }

  private entryURL(path: string, base: string): string {
    const url = new URL(path, base)
    url.searchParams.set('embed', 'dsh')
    url.searchParams.set('dshTheme', this.presentation?.theme ?? 'light')
    return url.href
  }

  private connect(): Promise<void> {
    if (this.pending) return this.pending
    const state = this.enterprise.snapshot()
    if (!state.connected || !state.connectionKey || !this.owner || this.owner.isDestroyed()) return Promise.resolve()
    const generation = this.generation
    const key = state.connectionKey
    this.key = key
    if (!this.view) this.state = { phase: 'loading' }
    this.layout()
    const operation = this.exchange(key, generation)
    this.pending = operation
    void operation.finally(() => { if (this.pending === operation) this.pending = undefined })
    return operation
  }

  private async exchange(key: string, generation: number): Promise<void> {
    try {
      const credential = await this.enterprise.webSession(key)
      if (generation !== this.generation || this.key !== key || !this.owner || this.owner.isDestroyed()) return
      if (!this.view) {
        const origin = new URL(credential.base).origin
        this.origin = origin
        const isolated = session.fromPartition(`enterprise-chat-${randomUUID()}`)
        isolated.setPermissionRequestHandler((_contents, permission, callback, details) => {
          callback(permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith(origin + '/'))
        })
        isolated.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === origin)
        const view = new WebContentsView({ webPreferences: { session: isolated, preload: join(import.meta.dirname, '../preload/enterprise-chat.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
        view.setVisible(false)
        view.setBackgroundColor(this.presentation?.theme === 'dark' ? '#141416' : '#ffffff')
        view.webContents.setWindowOpenHandler(({ url }) => {
          if (/^https?:\/\//u.test(url)) void shell.openExternal(url).catch(() => this.note('[enterprise-chat] external_link_failed'))
          return { action: 'deny' }
        })
        const allowNavigation = (event: Electron.Event, url: string): void => {
          if (new URL(url).origin !== origin) event.preventDefault()
        }
        view.webContents.on('ipc-message', (event, channel, input: unknown) => {
          if (generation !== this.generation || this.view !== view || event.senderFrame !== view.webContents.mainFrame) return
          const url = new URL(view.webContents.getURL())
          if (url.origin !== origin || !url.pathname.startsWith('/workspace/')) return
          if (!input || typeof input !== 'object') return
          const report = input as Record<string, unknown>
          if (report.path !== url.pathname) return
          if (channel === 'enterprise-chat:navigation') {
            try { this.navigation = parseEnterpriseNavigation(report.navigation); this.notify() }
            catch { this.note('[enterprise-chat] invalid_navigation_report') }
            return
          }
          if (channel !== 'enterprise-chat:landing' || !/^\/workspace\/c\/[a-zA-Z0-9_-]+$/u.test(url.pathname) || typeof report.landing !== 'boolean') return
          this.landing = url.pathname === '/workspace/c/new' && report.landing
          this.notify()
        })
        view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
          if (isMainFrame && generation === this.generation && this.view === view) {
            this.landing = undefined
            this.notify()
          }
        })
        view.webContents.on('will-navigate', allowNavigation)
        view.webContents.on('will-redirect', allowNavigation)
        view.webContents.on('will-attach-webview', (event) => event.preventDefault())
        view.webContents.on('render-process-gone', () => { this.clear(); this.state = { phase: 'error' }; this.note('[enterprise-chat] renderer_gone') })
        view.webContents.on('did-finish-load', () => {
          if (generation !== this.generation) return
          if (new URL(view.webContents.getURL()).pathname.startsWith('/workspace')) {
            this.state = { phase: 'ready' }; this.layout(); this.notify()
          } else {
            this.state = { phase: 'error' }; this.layout(); this.note('[enterprise-chat] unexpected_login_redirect')
          }
        })
        this.isolated = isolated
        this.view = view
        this.owner.contentView.addChildView(view)
      }
      const view = this.view
      await view.webContents.session.cookies.set({ url: credential.base, name: 'access_token_cookie', value: credential.cookie, path: '/', httpOnly: true, secure: new URL(credential.base).protocol === 'https:', sameSite: 'lax', expirationDate: credential.expiresAt / 1000 })
      if (generation !== this.generation) return
      if (!view.webContents.getURL()) await view.webContents.loadURL(this.entryURL('/workspace/', credential.base))
      else { this.state = { phase: 'ready' }; this.layout() }
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { void this.connect() }, Math.max(1000, credential.expiresAt - Date.now() - 30_000))
      this.note('[enterprise-chat] session_ready')
    } catch (error) {
      if (generation !== this.generation) return
      this.clear()
      this.state = { phase: 'error' }
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 'transport'
      this.note(`[enterprise-chat] session_failed status=${status}`)
    }
  }

  private clear(): void {
    this.landing = undefined
    this.navigation = undefined
    this.navigationRequest++
    this.generation += 1
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
    this.key = undefined
    this.origin = undefined
    this.routes.clear()
    const view = this.view
    const isolated = this.isolated
    this.view = undefined
    this.isolated = undefined
    if (view) {
      if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    if (isolated) {
      void isolated.clearStorageData().then(() => isolated.closeAllConnections()).catch(() => this.note('[enterprise-chat] session_cleanup_failed'))
    }
    this.state = { phase: 'idle' }
  }

  dispose(): void { this.unsubscribe(); this.clear() }
}
