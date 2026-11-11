import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, session, shell, WebContentsView, type BrowserWindow, type Session } from 'electron'
import { parseEnterpriseNavigation, parseEnterpriseSettingsSection, parseChatPage, parseChatId, parseChatPresentation, type EnterpriseSettingsSection, type EnterpriseChatFrame, type EnterpriseChatHistory, type EnterpriseChatPresentation, type EnterpriseChatViewState } from '../../shared/enterprise-chat-view'
import type { EnterpriseDesktopRuntime } from './enterprise-desktop'
import { MODULE_ROUTE_PATTERN, MODULE_THEME_CSS, moduleThemeScript } from './chat-module-theme'
import { chatDialogViewportScript, guardChatDialogViewportScript } from './chat-dialog-viewport'
import { ChatDialogBacking } from './chat-dialog-backing'
import { chatLocaleScript } from './chat-locale'
import { chatLayoutCss } from './chat-layout'
import { CHAT_WELCOME_CSS, CHAT_WELCOME_WORLD, chatWelcomeCasesScript } from './chat-welcome-cases'
import { parseUsageSummary, parseUsageStorage, type EnterpriseUsage, type UsageSection } from '../../shared/enterprise-usage'
import { EnterprisePlatformError, isEnterprisePlatformError } from './enterprise-request'
import { EnterpriseChatProjects } from './chat-projects'
import { projectUuid, type ChatProjectsState, type ProjectConversationPage } from '../../shared/chat-projects'
import { raiseUpdateCardViewIfShown } from '../update/update-card-view'

/** Remote Chat gets its own in-memory browser session and a presentation-only preload. */
const DOCUMENT_LOAD_TIMEOUT_MS = 45_000
const INITIAL_BACKOFF_MS = [2_000, 5_000, 10_000]
const RENEWAL_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000]
const RETRYABLE_NETWORK_CODES = new Set([
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_TIMED_OUT',
])

type ExchangeStage = 'session' | 'cookie' | 'load' | 'renew'

/**
 * Retry only listed transport failures. isTransientPlatformError treats every Error as transient,
 * which would also retry identity changes and keep a dead session alive.
 */
function isRetryableChatExchangeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message === 'Enterprise account changed.' || error.message === 'Enterprise login required.') return false
  const status = (error instanceof EnterprisePlatformError || 'status' in error) ? (error as { status?: unknown }).status : undefined
  if (status === 401 || status === 409) return false
  if (status === 'timeout') return true
  if (typeof status === 'number' && (status === 408 || status === 429 || status >= 500)) return true
  if (isEnterprisePlatformError(error) && (error.code === 'network_error' || error.uncertain)) return true
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)
}

function exchangeErrorLabel(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { status?: unknown, code?: unknown } : {}
  const status = typeof value.status === 'number' || typeof value.status === 'string' ? String(value.status).slice(0, 16) : 'transport'
  const code = typeof value.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value.code) ? value.code : ''
  return `status=${status}${code ? ` code=${code}` : ''}`
}

function backoffStep(steps: readonly number[], attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), steps.length - 1)
  return steps[index] ?? 30_000
}

/** Spread retries so chat renewal does not line up with the work poll or other windows. */
function backoffDelay(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4))
}

/** A document load that never settles (platform stalls mid-deploy) must not pin the exchange forever. */
async function loadWithin<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Chat document load timed out.'), { status: 'timeout' })), ms) })])
  } finally { clearTimeout(timer) }
}

export class EnterpriseChatView {
  private projects?: EnterpriseChatProjects
  private projectsRequested = false
  // Projects have no server push; re-read when any Desktop window regains focus.
  private readonly refreshProjectsOnFocus = (): void => { this.projects?.refreshIfStale() }
  private projectFocusBound = false
  private modalOpen = false
  private modalRequest = 0
  private modalOpening = false
  private modalBacking?: ChatDialogBacking
  private viewBackground?: string
  private dialogViewport?: { pathname: string; script: string }
  private dialogViewportRevision = 0
  private landing?: boolean
  private navigation?: ReturnType<typeof parseEnterpriseNavigation>
  private navigationRequest = 0
  private origin?: string
  private routes = new Map<string, string>()
  private deletedConversations = new Set<string>()
  private view?: WebContentsView
  private isolated?: Session
  private owner?: BrowserWindow
  private key?: string
  private generation = 0
  private timer?: NodeJS.Timeout
  private pending?: Promise<void>
  private initialAttempt = 0
  private renewalAttempt = 0
  private backoffScheduled = false
  /** True after a workspace document has been ready, so later redirects stay on the renewal schedule. */
  private renewalMode = false
  /** Finite recovery budget after the document leaves /workspace. Independent of the on-workspace renewal counter. */
  private offWorkspaceAttempt = 0
  /** Set while a recovery load is in flight, so its login redirect is not treated as a terminal navigation. */
  private offWorkspaceRecovery = false
  private unsubscribe: () => void
  private state: EnterpriseChatViewState = { phase: 'idle' }
  private presentation?: EnterpriseChatPresentation
  private settingsSection?: EnterpriseSettingsSection
  private settingsReturnRoute?: string
  private settingsReady = false
  private settingsFailure?: 'load' | 'unsupported'
  private settingsTimer?: NodeJS.Timeout
  private appearance?: string
  private welcomeCases?: { active: boolean; locale: 'zh' | 'en'; revision: number }
  private welcomeRevision = 0

  constructor(private enterprise: EnterpriseDesktopRuntime, private note: (line: string) => void, private notificationWindow?: () => BrowserWindow | undefined) {
    this.unsubscribe = enterprise.subscribe((state) => {
      if (!state.connected || (this.key !== undefined && state.connectionKey !== this.key)) this.clear()
      this.notify()
      if (state.connected && !this.view && this.state.phase !== 'error' && this.presentation?.visible && this.owner && !this.owner.isDestroyed()) {
        void this.connect()
      }
    })
  }

  snapshot(): EnterpriseChatViewState {
    const account = this.enterprise.snapshot()
    const url = this.view ? new URL(this.view.webContents.getURL() || 'about:blank') : undefined
    const projectId = url?.pathname === '/workspace/c/new' ? url.searchParams.get('projectId') : undefined
    return {
      ...this.state,
      settingsProtocolVersion: 1,
      settingsSection: this.settingsSection,
      settingsReady: this.isSettingsReady(),
      settingsFailure: this.settingsFailure,
      navigation: this.navigation,
      path: url?.pathname.replace(/^\/workspace/u, ''),
      landing: this.landing,
      epoch: this.generation,
      conversationId: url?.pathname.match(/\/workspace\/(?:c|chat|linsight)\/([a-zA-Z0-9_-]+)/u)?.[1],
      connected: account.connected,
      projectScope: account.connected ? account.connectionKey : undefined,
      draftProjectId: projectId && /^[a-zA-Z0-9_-]{1,128}$/u.test(projectId) ? projectId : undefined
    }
  }

  private notify(): void {
    const window = this.notificationWindow?.() ?? this.owner
    if (window && !window.isDestroyed()) window.webContents.send('enterprise-chat:changed', this.snapshot())
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
    if (this.presentation.visible && this.state.phase !== 'error' && this.enterprise.snapshot().connected && !this.view) void this.connect()
    if (this.view) void this.syncSettings()
    return this.snapshot()
  }

  async capture(window: BrowserWindow): Promise<EnterpriseChatFrame | undefined> {
    const view = this.view, epoch = this.generation
    if (window !== this.owner || window.isDestroyed() || !view?.getVisible() || this.state.phase !== 'ready') return
    const bounds = view.getBounds()
    const url = view.webContents.getURL()
    const zoom = window.webContents.getZoomFactor()
    try {
      const image = await loadWithin(view.webContents.capturePage(), 1_500)
      // Navigation, logout and native resizing invalidate a frame captured for the old surface.
      if (epoch !== this.generation || view !== this.view || !this.presentation?.visible || window.isDestroyed() ||
        url !== view.webContents.getURL() || zoom !== window.webContents.getZoomFactor() ||
        JSON.stringify(bounds) !== JSON.stringify(view.getBounds()) || image.isEmpty()) return
      return { dataURL: image.toDataURL(), bounds: { x: bounds.x / zoom, y: bounds.y / zoom, width: bounds.width / zoom, height: bounds.height / zoom } }
    } catch (error) {
      // A failed backing must not prevent the host menu from receiving input.
      this.note(`[enterprise-chat] overlay_capture_failed: ${error instanceof Error ? error.message : 'unknown capture error'}`)
      return undefined
    }
  }

  retry(): void { this.clear(); void this.connect() }

  private isSettingsReady(): boolean {
    if (!this.view || !this.settingsSection || !this.settingsReady) return false
    const url = new URL(this.view.webContents.getURL() || 'about:blank')
    return url.origin === this.origin && url.pathname === `/workspace/settings/${this.settingsSection}` && url.searchParams.get('dshSettings') === '1'
  }

  focusSettings(): void {
    if (this.presentation?.visible && this.presentation.settings === this.settingsSection && this.isSettingsReady()) this.view?.webContents.focus()
  }

  /** Fixed self-service reads reuse the identity-owned cookie session, never renderer URLs. */
  async usage(): Promise<EnterpriseUsage> {
    const epoch = this.generation
    if (this.state.phase !== 'ready') await this.connect()
    if (epoch !== this.generation || !this.isolated || !this.origin || !this.enterprise.snapshot().connected) throw new Error('Usage identity changed.')
    const isolated = this.isolated, origin = this.origin
    const assertCurrent = () => {
      if (epoch !== this.generation || isolated !== this.isolated || !this.enterprise.snapshot().connected) throw new Error('Usage identity changed.')
    }
    let renewal: Promise<void> | undefined
    const read = async (path: string): Promise<unknown> => {
      const request = () => {
        assertCurrent()
        return isolated.fetch(new URL(path, origin).href, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      }
      let response = await request()
      if (response.status === 401) {
        await response.body?.cancel()
        assertCurrent()
        renewal ??= this.connect()
        await renewal
        assertCurrent()
        response = await request()
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Usage request failed (${response.status}).`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Usage response is empty.')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          length += next.value.byteLength
          if (length > 512 * 1024) throw new Error('Usage response is too large.')
          chunks.push(next.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!result || typeof result !== 'object' || !('status_code' in result) || result.status_code !== 200 || !('data' in result)) throw new Error('Usage unavailable.')
      return result.data
    }
    const section = async <T>(name: 'summary' | 'storage', path: string, parse: (value: unknown) => T): Promise<UsageSection<T>> => {
      try {
        return { status: 'ready', data: parse(await read(path)) }
      } catch (error) {
        // Fixed host stages retain diagnostics while response bodies stay in the host.
        const status = error instanceof Error ? error.message.match(/^Usage request failed \((\d{3})\)\.$/u)?.[1] : undefined
        this.note(`[enterprise-chat] usage_failed section=${name} status=${status ?? 'transport-or-response'}`)
        return { status: 'error' }
      }
    }
    const [summary, storage] = await Promise.all([
      section('summary', '/api/v1/dsh/me/usage-summary', parseUsageSummary),
      section('storage', '/api/v1/quota/effective', parseUsageStorage)
    ])
    assertCurrent()
    return { summary, storage }
  }

  /** Fixed read-only endpoint. The isolated cookie stays in the host session. */
  async projectsState(): Promise<ChatProjectsState> {
    this.projectsRequested = true
    if (!this.projects) await this.connect()
    this.projects?.start()
    // A sidebar read (including its retry button) also re-reads a failed or stale projection.
    this.projects?.refreshIfStale()
    const user = this.enterprise.snapshot().user
    return this.projects ? { ...this.projects.state(), identityLabel: user?.display_name || user?.username || user?.name || user?.id } : { epoch: this.generation, phase: 'idle', connection: 'live', revision: '0', projects: [], assignments: {} }
  }

  async projectAction(input: unknown, epoch: unknown) {
    if (epoch !== this.generation) throw new Error('Project identity changed.')
    await this.projectsState()
    if (!this.projects) throw new Error('Project sync unavailable.')
    return this.projects.action(input, epoch)
  }

  async projectConversations(input: unknown, epoch: unknown): Promise<ProjectConversationPage> {
    if (epoch !== this.generation) throw new Error('Project identity changed.')
    await this.projectsState()
    if (!this.projects) throw new Error('Project sync unavailable.')
    const page = await this.projects.conversations(input, epoch)
    if (epoch !== this.generation) throw new Error('Project identity changed.')
    for (const row of page.items) {
      const route = row.flowType === 20 ? `/workspace/linsight/${row.id}` : [1, 5, 10].includes(row.flowType) ? `/workspace/chat/${row.id}/${parseChatId(row.flowId)}/${row.flowType}` : `/workspace/c/${row.id}`
      if (!this.deletedConversations.has(row.id)) this.routes.set(row.id, route)
    }
    return { ...page, items: page.items.filter(row => !this.deletedConversations.has(row.id)) }
  }

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
    const items = result.data.filter((row: Record<string, unknown>) => !this.deletedConversations.has(String(row.chat_id))).map((row: Record<string, unknown>) => {
      const id = parseChatId(row.chat_id)
      const flowType = Number(row.flow_type)
      const route = flowType === 20 ? `/workspace/linsight/${id}` : [1, 5, 10].includes(flowType) ? `/workspace/chat/${id}/${parseChatId(String(row.flow_id))}/${flowType}` : `/workspace/c/${id}`
      this.routes.set(id, route)
      return { id, title: String(row.name || row.flow_name || '').slice(0, 500), updatedAt: String(row.update_time || row.create_time || '').slice(0, 50) }
    })
    return { epoch, items, hasMore: result.data.length === 40 }
  }

  /** The history grant and confirmation belong to one authenticated identity. */
  async remove(input: unknown, expectedEpoch: unknown): Promise<{ epoch: number }> {
    const id = parseChatId(input)
    const epoch = this.generation
    if (expectedEpoch !== epoch || !this.enterprise.snapshot().connected || !this.routes.has(id)) {
      throw new Error('Select a conversation from current Chat history.')
    }
    if (this.state.phase !== 'ready') await this.connect()
    if (epoch !== this.generation || !this.isolated || !this.origin) throw new Error('Chat identity changed.')
    const response = await this.isolated.fetch(new URL(`/api/v1/chat/${id}`, this.origin).href, {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`Chat deletion failed (${response.status}).`)
    const result: unknown = await response.json()
    if (epoch !== this.generation) throw new Error('Chat identity changed.')
    if (!result || typeof result !== 'object' || !('status_code' in result) || result.status_code !== 200) {
      throw new Error('Chat deletion failed.')
    }
    this.deletedConversations.add(id)
    this.routes.delete(id)
    this.note('[enterprise-chat] conversation deleted')
    // The server unbinds the project membership in the delete commit; with no push
    // channel, re-read so the sidebar drops the stale assignment.
    void this.projects?.refresh().catch(() => this.note('[project-sync] post_delete_refresh_failed'))
    if (this.settingsReturnRoute?.match(/^\/workspace\/(?:c|chat|linsight)\/([a-zA-Z0-9_-]+)/u)?.[1] === id) {
      this.settingsReturnRoute = '/workspace/c/new'
    }
    if (this.snapshot().conversationId === id) {
      try { await this.navigate('/workspace/c/new') }
      catch {
        // Deletion is already committed. navigate restores a document that stayed
        // in the workspace, or starts the same limited recovery as a login redirect.
        // Only an unsettled loading phase still needs the error page.
        if (epoch === this.generation && !this.backoffScheduled && this.state.phase === 'loading') {
          this.state = { phase: 'error', error: 'Chat navigation failed.' }
          this.layout()
          this.notify()
        }
      }
    }
    return { epoch }
  }

  async open(input: unknown, projectInput?: unknown): Promise<void> {
    const id = parseChatId(input)
    const projectId = projectInput === undefined ? undefined : projectUuid(projectInput)
    if (projectId && id !== 'new') throw new Error('A project can only be selected for a new Chat draft.')
    const epoch = this.generation
    if (this.state.phase !== 'ready') await this.connect()
    if (epoch !== this.generation || !this.view || !this.origin) throw new Error('Chat unavailable.')
    const route = id === 'new' ? `/workspace/c/new${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}` : this.routes.get(id)
    if (!route) throw new Error('Select a conversation from current Chat history.')
    await this.navigate(route, id === 'new')
  }

  /** Only current, account-published module identities can be opened by the host. */
  async openPage(input: unknown): Promise<void> {
    const id = parseChatId(input)
    const entry = this.navigation?.entries.find(item => item.id === id)
    if (!entry || !this.enterprise.snapshot().connected) throw new Error('Enterprise page unavailable.')
    await this.navigate(`/workspace${entry.path}`)
  }

  /** Only enumerated settings pages share the existing identity-owned document. */
  private async syncSettings(): Promise<void> {
    const section = this.presentation?.settings
    if (!this.view || !this.origin || !this.enterprise.snapshot().connected || section === this.settingsSection) return
    const view = this.view, epoch = this.generation
    if (!view.webContents.getURL()) return
    const current = new URL(view.webContents.getURL())
    if (current.origin !== this.origin || !current.pathname.startsWith('/workspace')) return
    if (section && !this.settingsReturnRoute) {
      for (const key of ['embed', 'dshTheme', 'dshLocale', 'dshSettings']) current.searchParams.delete(key)
      this.settingsReturnRoute = current.pathname + current.search
    }
    const route = section ? `/workspace/settings/${section}?dshSettings=1` : this.settingsReturnRoute ?? '/workspace/c/new'
    this.settingsSection = section
    this.note(`[enterprise-settings] navigate section=${section ?? 'return'}`)
    this.settingsReady = false
    this.settingsFailure = undefined
    clearTimeout(this.settingsTimer)
    if (section) {
      this.settingsTimer = setTimeout(() => {
        if (epoch !== this.generation || section !== this.settingsSection || this.settingsReady) return
        this.settingsFailure = 'unsupported'
        this.note('[enterprise-settings] content_ready_timeout')
        this.layout(); this.notify()
      }, DOCUMENT_LOAD_TIMEOUT_MS)
    }
    this.layout(); this.notify()
    try {
      await this.navigate(route)
      if (epoch !== this.generation || view !== this.view || section !== this.settingsSection) return
      if (!section) { this.settingsReturnRoute = undefined; this.state = { phase: 'ready' } }
      this.layout(); this.notify()
    } catch (error) {
      if (epoch !== this.generation || view !== this.view || section !== this.settingsSection) return
      clearTimeout(this.settingsTimer)
      this.settingsFailure = 'load'
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 80) : 'transport'
      this.note(`[enterprise-settings] navigation_failed code=${code}`)
      this.layout(); this.notify()
    }
  }

  private async navigate(route: string, resetDraft = false): Promise<void> {
    const view = this.view, origin = this.origin, epoch = this.generation
    if (!view || !origin) throw new Error('Enterprise page unavailable.')
    const current = new URL(view.webContents.getURL())
    current.searchParams.delete('embed')
    current.searchParams.delete('dshTheme')
    current.searchParams.delete('dshLocale')
    // A new-conversation action must reset the web draft even at the same URL.
    // Existing conversations and module pages retain their idempotent navigation.
    if (!resetDraft && current.pathname + current.search === route) return
    const request = ++this.navigationRequest
    const accepted = await view.webContents.executeJavaScript(`(() => {
      const event = new CustomEvent('dsh:navigate', { detail: { path: ${JSON.stringify(route.slice('/workspace'.length))}, resetDraft: ${resetDraft} }, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`)
    if (request !== this.navigationRequest || epoch !== this.generation || this.view !== view) return
    if (accepted === true) return
    this.state = { phase: 'loading' }
    this.layout()
    try {
      await loadWithin(view.webContents.loadURL(this.entryURL(route, origin)), DOCUMENT_LOAD_TIMEOUT_MS)
    } catch (error) {
      if (request === this.navigationRequest && epoch === this.generation && this.view === view) {
        if (this.onWorkspace()) {
          this.state = { phase: 'ready' }
          this.layout()
          this.notify()
        } else {
          this.noteDocumentLeftWorkspace()
        }
      }
      throw error
    }
  }

  /** Native menu zoom changes do not necessarily trigger a renderer presentation. */
  syncZoom(window: BrowserWindow): void {
    if (window === this.owner) this.layout()
  }

  private layout(): void {
    if (!this.view || !this.owner || this.owner.isDestroyed() || !this.presentation) return
    // A WebContentsView has independent Chromium zoom. Resize alone only changes
    // its native bounds, leaving remote text and controls at their original size.
    const zoom = this.owner.webContents.getZoomFactor()
    if (this.view.webContents.getZoomFactor() !== zoom) this.view.webContents.setZoomFactor(zoom)
    const { bounds, visible, theme } = this.presentation
    const onSettingsPath = /\/workspace\/settings\//u.test(this.view.webContents.getURL())
    const surfaceReady = this.presentation.settings ? this.settingsSection === this.presentation.settings && this.isSettingsReady() : !onSettingsPath
    const shown = visible && this.state.phase === 'ready' && surfaceReady
    if (!shown || this.presentation.settings) this.discardDialogBacking()
    if (this.view.getVisible() !== shown) this.view.setVisible(shown)
    this.syncWelcomeCases(shown && !this.presentation.settings)
    // Settings hides the view while changing locale; its navigation labels still need updates.
    if (this.state.phase === 'ready') this.applyLocale()
    if (!visible) return
    const [width = 0, height = 0] = this.owner.getContentSize()
    const x = Math.max(0, Math.round(bounds.x * zoom))
    const y = Math.max(0, Math.round(bounds.y * zoom))
    const contentBounds = { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width * zoom))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height * zoom))) }
    const windowDialog = this.modalOpen && !this.modalOpening && !this.presentation.settings
    const pathname = new URL(this.view.webContents.getURL() || 'about:blank').pathname
    const modulePage = new RegExp(MODULE_ROUTE_PATTERN, 'u').test(pathname)
    const surface = modulePage ? this.presentation.palette?.surface : undefined
    const background = surface ? `#${surface.map((channel) => channel.toString(16).padStart(2, '0')).join('')}` : theme === 'dark' ? '#141416' : '#ffffff'
    const viewZoom = this.view.webContents.getZoomFactor()
    // Install the seat before any modal appears. CSS follows native resizing in the same paint;
    // opening/closing a dialog must not asynchronously replace root positioning or transparency.
    const viewportScript = chatDialogViewportScript(!this.presentation.settings ? {
      x: x / viewZoom, y: y / viewZoom, width: contentBounds.width / viewZoom, height: contentBounds.height / viewZoom,
      windowWidth: width / viewZoom, windowHeight: height / viewZoom, background,
      followNativeView: process.platform === 'darwin' && modulePage
    } : undefined)
    if (this.state.phase === 'ready' &&
        (this.dialogViewport?.pathname !== pathname || this.dialogViewport.script !== viewportScript)) {
      const delivery = { pathname, script: viewportScript }
      this.dialogViewport = delivery
      const script = guardChatDialogViewportScript(viewportScript, pathname, ++this.dialogViewportRevision)
      void this.view.webContents.executeJavaScript(script).catch(() => {
        if (this.dialogViewport === delivery) this.dialogViewport = undefined
        this.note('[enterprise-chat] dialog_viewport_failed')
      })
    }
    const nextBounds = windowDialog ? { x: 0, y: 0, width, height } : contentBounds
    const currentBounds = this.view.getBounds()
    if (!currentBounds || currentBounds.x !== nextBounds.x || currentBounds.y !== nextBounds.y ||
      currentBounds.width !== nextBounds.width || currentBounds.height !== nextBounds.height) this.view.setBounds(nextBounds)
    // The seat paints the previous backing color; the native view stays transparent across modals.
    const backing = this.state.phase === 'ready' && !this.presentation.settings ? '#00000000' : background
    if (this.viewBackground !== backing) { this.view.setBackgroundColor(backing); this.viewBackground = backing }
    if (this.state.phase === 'ready') this.applyTheme()
  }

  /** Theme reaches the document on every presentation, load and in-page route change. */
  private applyTheme(): void {
    const theme = this.presentation?.theme
    if (!this.view || !theme) return
    const palette = this.presentation?.palette
    void this.view.webContents.executeJavaScript(moduleThemeScript(theme, palette)).then((result: unknown) => {
      const summary = `theme=${theme} palette=${palette ? palette.surface.join(' ') : 'absent'} ${typeof result === 'string' ? result : 'unreported'}`
      if (summary === this.appearance) return
      this.appearance = summary
      this.note(`[enterprise-chat] appearance ${summary}`)
    }).catch(() => this.note('[enterprise-chat] appearance_delivery_failed'))
  }

  private entryURL(path: string, base: string): string {
    const url = new URL(path, base)
    url.searchParams.set('embed', 'dsh')
    url.searchParams.set('dshTheme', this.presentation?.theme ?? 'light')
    if (this.presentation?.locale) url.searchParams.set('dshLocale', this.presentation.locale)
    return url.href
  }

  private applyLocale(): void {
    const locale = this.presentation?.locale
    if (!this.view || !locale) return
    void this.view.webContents.executeJavaScript(chatLocaleScript(locale)).catch(() => this.note('[enterprise-chat] locale_delivery_failed'))
  }

  /** Only the visible, identity-owned blank Chat document receives the case surface. */
  private syncWelcomeCases(visible: boolean): void {
    const view = this.view, origin = this.origin
    if (!view || !origin || this.state.phase !== 'ready') return
    const url = new URL(view.webContents.getURL() || 'about:blank')
    if (url.origin !== origin) return
    const active = visible && !this.modalOpen && url.pathname === '/workspace/c/new' && this.landing === true
    const locale = this.presentation?.locale ?? 'zh'
    if (!active && !this.welcomeCases?.active) return
    if (active === this.welcomeCases?.active && locale === this.welcomeCases.locale) return
    const next = { active, locale, revision: ++this.welcomeRevision }
    this.welcomeCases = next
    void view.webContents.executeJavaScriptInIsolatedWorld(CHAT_WELCOME_WORLD, [{ code: chatWelcomeCasesScript({ ...next, origin }) }]).catch(() => {
      if (this.welcomeCases === next) this.welcomeCases = undefined
      this.note('[enterprise-chat] welcome_cases_delivery_failed')
    })
  }

  private connect(): Promise<void> {
    if (this.backoffScheduled) return this.pending ?? Promise.resolve()
    if (this.pending) return this.pending
    const state = this.enterprise.snapshot()
    if (!state.connected || !state.connectionKey || !this.owner || this.owner.isDestroyed()) return Promise.resolve()
    const generation = this.generation
    const key = state.connectionKey
    this.key = key
    if (!this.view) this.state = { phase: 'loading' }
    this.layout()
    this.notify()
    const operation = this.exchange(key, generation)
    this.pending = operation
    void operation.finally(() => { if (this.pending === operation) this.pending = undefined })
    return operation
  }

  private async exchange(key: string, generation: number): Promise<void> {
    let stage: ExchangeStage = 'session'
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
        // Observe successful saves on this identity-owned browser session. The
        // notification carries no remote data or authority; Harness rereads permissions.
        isolated.webRequest.onCompleted({ urls: [origin + '/api/v1/dsh/capabilities/*/availability'] }, details => {
          if (generation !== this.generation || this.view !== view || this.key !== key) return
          if (details.webContentsId !== view.webContents.id || details.method !== 'PUT' || details.statusCode !== 200) return
          const saved = new URL(details.url)
          if (saved.origin !== origin || !/^\/api\/v1\/dsh\/capabilities\/[1-9][0-9]*\/availability$/u.test(saved.pathname)) return
          if (this.owner && !this.owner.isDestroyed()) this.owner.webContents.send('enterprise-chat:tools-changed')
        })
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
          if (channel === 'enterprise-chat:settings-ready') {
            this.note(`[enterprise-settings] ready_report path_match=${report.path === url.pathname} section_match=${report.section === this.settingsSection} content_mode=${url.searchParams.get('dshSettings') === '1'}`)
          }
          if (report.path !== url.pathname) return
          if (channel === 'enterprise-chat:modal') {
            if (typeof report.open !== 'boolean') return
            const changed = report.open !== this.modalOpen
            const request = changed ? ++this.modalRequest : this.modalRequest
            const opening = report.open && changed
            this.modalOpen = report.open
            const owner = this.owner
            if (opening && owner && this.presentation?.visible && !this.presentation.settings) {
              const backing = this.modalBacking ??= new ChatDialogBacking(owner, () => this.capture(owner),
                () => loadWithin(view.webContents.capturePage(), 1_500), this.note)
              this.modalOpening = true
              void backing.hold().then(() => {
                if (request !== this.modalRequest || this.modalBacking !== backing || !this.modalOpen || this.view !== view) return
                this.modalOpening = false
                this.layout()
                if (this.presentation?.visible) view.webContents.focus()
              })
            } else {
              if (!report.open) this.modalOpening = false
              this.layout()
              if (!report.open) void this.modalBacking?.release()
              if (opening && this.presentation?.visible) view.webContents.focus()
            }
            return
          }
          if (channel === 'enterprise-chat:settings-ready') {
            try {
              const section = parseEnterpriseSettingsSection(report.section)
              if (section !== this.settingsSection || url.pathname !== `/workspace/settings/${section}`) return
              this.settingsReady = true
              this.settingsFailure = undefined
              clearTimeout(this.settingsTimer)
              this.layout(); this.notify()
            } catch { this.note('[enterprise-settings] invalid_ready_report') }
            return
          }
          if (channel === 'enterprise-chat:settings-close') {
            if (this.settingsSection && url.pathname === `/workspace/settings/${this.settingsSection}`) {
              this.owner?.webContents.focus()
              this.owner?.webContents.send('enterprise-chat:close-settings')
            }
            return
          }
          if (channel === 'enterprise-chat:settings-focus') {
            if (this.settingsSection && url.pathname === `/workspace/settings/${this.settingsSection}` && (report.direction === 'previous' || report.direction === 'next')) {
              this.owner?.webContents.focus()
              this.owner?.webContents.send('enterprise-chat:settings-focus', { section: this.settingsSection, direction: report.direction })
            }
            return
          }
          if (channel === 'enterprise-chat:navigation') {
            try { this.navigation = parseEnterpriseNavigation(report.navigation); this.notify() }
            catch { this.note('[enterprise-chat] invalid_navigation_report') }
            return
          }
          if (channel !== 'enterprise-chat:landing' || !/^\/workspace\/c\/[a-zA-Z0-9_-]+$/u.test(url.pathname) || typeof report.landing !== 'boolean') return
          this.landing = url.pathname === '/workspace/c/new' && report.landing
          this.syncWelcomeCases(Boolean(this.presentation?.visible && !this.presentation.settings))
          this.notify()
        })
        view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
          if (isMainFrame && !isInPlace && generation === this.generation && this.view === view) {
            this.resetModalPresentation()
            this.dialogViewport = undefined
            this.landing = undefined
            this.welcomeCases = undefined
            this.layout()
          }
          if (isMainFrame && !isInPlace && generation === this.generation && this.view === view && this.settingsSection) {
            this.settingsReady = false
            this.layout(); this.notify()
          }
        })
        view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
          if (isMainFrame && generation === this.generation && this.view === view) {
            if (!this.onWorkspace()) {
              this.noteDocumentLeftWorkspace()
              return
            }
            this.resetModalPresentation()
            view.webContents.send('enterprise-chat:sync-modal')
            this.landing = undefined
            if (this.settingsSection) {
              const url = new URL(view.webContents.getURL())
              this.note(`[enterprise-settings] navigated section_match=${url.pathname === `/workspace/settings/${this.settingsSection}`} content_mode=${url.searchParams.get('dshSettings') === '1'}`)
            }
            if (!this.isSettingsReady()) this.settingsReady = false
            this.layout()
            if (this.state.phase === 'ready') this.applyTheme()
            if (this.state.phase === 'ready') this.applyLocale()
            this.notify()
          }
        })
        view.webContents.on('will-navigate', allowNavigation)
        view.webContents.on('will-redirect', allowNavigation)
        view.webContents.on('will-attach-webview', (event) => event.preventDefault())
        view.webContents.on('render-process-gone', () => {
          if (generation !== this.generation || this.view !== view) return
          this.clear(); this.state = { phase: 'error' }; this.note('[enterprise-chat] renderer_gone'); this.notify()
        })
        view.webContents.on('did-finish-load', () => {
          if (generation !== this.generation) return
          if (new URL(view.webContents.getURL()).pathname.startsWith('/workspace')) {
            // Host-owned module styles live in this document until the next full load replaces it.
            void view.webContents.insertCSS(`${MODULE_THEME_CSS}\n${chatLayoutCss(process.platform)}\n${CHAT_WELCOME_CSS}`).catch(() => this.note('[enterprise-chat] module_style_failed'))
            this.dialogViewport = undefined
            this.state = { phase: 'ready' }; void this.syncSettings(); this.layout(); this.notify()
          } else {
            this.noteDocumentLeftWorkspace()
          }
        })
        this.isolated = isolated
        this.view = view
        this.owner.contentView.addChildView(view)
        raiseUpdateCardViewIfShown(this.owner)
      }
      const view = this.view
      if (!view) throw new Error('Enterprise page unavailable.')
      stage = 'cookie'
      await view.webContents.session.cookies.set({ url: credential.base, name: credential.cookieName, value: credential.cookie, path: '/', httpOnly: true, secure: new URL(credential.base).protocol === 'https:', sameSite: 'lax', expirationDate: credential.expiresAt / 1000 })
      if (generation !== this.generation) return
      if (!this.projects && this.isolated && this.origin) {
        const isolated = this.isolated, origin = this.origin
        const account = this.enterprise.snapshot()
        this.projects = new EnterpriseChatProjects({
          epoch: generation, expectedUserId: account.user?.id, expectedTenantId: account.tenant?.id,
          fetch: (path, init) => {
            if (generation !== this.generation || isolated !== this.isolated || !this.enterprise.snapshot().connected) throw new Error('Project identity changed.')
            return isolated.fetch(new URL(path, origin).href, init)
          },
          renew: () => this.connect(), note: this.note,
          changed: state => {
            if (generation !== this.generation) return
            const owner = this.notificationWindow?.() ?? this.owner
            if (owner && !owner.isDestroyed()) owner.webContents.send('enterprise-chat:projects-changed', { ...state, identityLabel: account.user?.display_name || account.user?.username || account.user?.name || account.user?.id })
            if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.send('enterprise-chat:projects-changed')
          }
        })
        if (this.projectsRequested) this.projects.start()
        if (!this.projectFocusBound) { app.on('browser-window-focus', this.refreshProjectsOnFocus); this.projectFocusBound = true }
      }
      stage = this.renewalMode ? 'renew' : 'load'
      const reloaded = !this.onWorkspace()
      if (reloaded) {
        this.offWorkspaceRecovery = this.renewalMode
        try {
          await loadWithin(view.webContents.loadURL(this.entryURL('/workspace/', credential.base)), DOCUMENT_LOAD_TIMEOUT_MS)
        } finally { this.offWorkspaceRecovery = false }
      }
      if (generation !== this.generation) return
      if (!this.onWorkspace()) {
        this.noteDocumentLeftWorkspace()
        return
      }
      // The workspace shell finishes before the client decides it is logged in.
      // A recovery reload must keep its attempt count until a later renewal
      // finds the document still here; otherwise every login redirect starts over.
      const recovering = reloaded && this.offWorkspaceAttempt > 0
      this.renewalMode = true
      this.initialAttempt = 0
      this.renewalAttempt = 0
      if (!recovering) this.offWorkspaceAttempt = 0
      if (this.state.phase !== 'ready') {
        this.state = { phase: 'ready' }
        this.notify()
      }
      this.layout()
      await this.syncSettings()
      if (generation !== this.generation) return
      if (!this.onWorkspace()) {
        if (!this.backoffScheduled) this.noteDocumentLeftWorkspace()
        return
      }
      if (!recovering) this.offWorkspaceAttempt = 0
      this.armTimer(Math.max(1000, credential.expiresAt - Date.now() - 30_000), key, false)
      this.note('[enterprise-chat] session_ready')
    } catch (error) {
      if (generation !== this.generation) return
      this.recoverExchange(key, error, stage)
    }
  }

  private onWorkspace(): boolean {
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return false
    try { return new URL(view.webContents.getURL()).pathname.startsWith('/workspace') }
    catch { return false }
  }

  private cancelTimer(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.backoffScheduled = false
  }

  /** One timer owns both the normal renewal and failure backoff. The callback drops its own mutex before connecting. */
  private armTimer(delayMs: number, key: string, backoff: boolean): void {
    clearTimeout(this.timer)
    const generation = this.generation
    this.backoffScheduled = backoff
    this.timer = setTimeout(() => {
      this.backoffScheduled = false
      this.timer = undefined
      if (generation !== this.generation || this.key !== key) return
      const state = this.enterprise.snapshot()
      if (!state.connected || state.connectionKey !== key) return
      void this.connect()
    }, delayMs)
  }

  private failExchange(key: string, error: unknown, stage: ExchangeStage): void {
    this.clear()
    this.key = key
    this.state = { phase: 'error' }
    this.note(`[enterprise-chat] session_failed stage=${stage} ${exchangeErrorLabel(error)}`)
    this.notify()
  }

  private recoverExchange(key: string, error: unknown, stage: ExchangeStage): void {
    const keepDocument = this.renewalMode && !!this.view && !this.view.webContents.isDestroyed()
    if (!isRetryableChatExchangeError(error)) {
      this.failExchange(key, error, stage)
      return
    }
    if (keepDocument) {
      if (!this.onWorkspace()) {
        if (!this.continueOffWorkspace(key, error, stage)) this.failExchange(key, error, stage)
        return
      }
      this.offWorkspaceAttempt = 0
      this.note(`[enterprise-chat] session_renew_failed stage=${stage} ${exchangeErrorLabel(error)}`)
      const delay = backoffDelay(backoffStep(RENEWAL_BACKOFF_MS, this.renewalAttempt))
      this.renewalAttempt += 1
      this.armTimer(delay, key, true)
      this.notify()
      return
    }
    if (this.initialAttempt >= INITIAL_BACKOFF_MS.length) {
      this.failExchange(key, error, stage)
      return
    }
    const delay = backoffDelay(backoffStep(INITIAL_BACKOFF_MS, this.initialAttempt))
    this.initialAttempt += 1
    this.note(`[enterprise-chat] session_retry stage=${stage} attempt=${this.initialAttempt} ${exchangeErrorLabel(error)}`)
    if (this.view) {
      const attempt = this.initialAttempt
      this.clear()
      this.initialAttempt = attempt
      this.key = key
    }
    this.state = { phase: 'loading' }
    this.armTimer(delay, key, true)
    this.notify()
  }

  /**
   * A document that has reached /workspace can recover from a later login redirect.
   * A redirect during an in-flight recovery must not spend another attempt.
   * The first load, before any workspace document, stays a terminal error.
   */
  private noteDocumentLeftWorkspace(): void {
    const key = this.key
    const state = this.enterprise.snapshot()
    const sameAccount = Boolean(key) && state.connected && state.connectionKey === key
    const canRecover = this.renewalMode && sameAccount && !!this.view && !this.view.webContents.isDestroyed()
    if (canRecover && (this.backoffScheduled || this.offWorkspaceRecovery)) {
      this.renewalMode = true
      this.state = { phase: 'loading' }
      this.layout()
      this.note('[enterprise-chat] renewal_left_workspace')
      this.notify()
      return
    }
    if (canRecover && key) {
      const redirect = new Error('Chat left the workspace.')
      if (!this.continueOffWorkspace(key, redirect, 'renew')) this.failExchange(key, redirect, 'renew')
      return
    }
    this.cancelTimer()
    if (this.state.phase !== 'error') {
      this.state = { phase: 'error' }
      this.layout()
      this.note('[enterprise-chat] unexpected_login_redirect')
      this.notify()
    }
  }

  /** did-finish-load must not reset this counter; only success and clear() do. */
  private continueOffWorkspace(key: string, error: unknown, stage: ExchangeStage): boolean {
    if (this.offWorkspaceAttempt >= INITIAL_BACKOFF_MS.length) return false
    const delay = backoffDelay(backoffStep(INITIAL_BACKOFF_MS, this.offWorkspaceAttempt))
    this.offWorkspaceAttempt += 1
    this.state = { phase: 'loading' }
    this.layout()
    this.note(`[enterprise-chat] session_renew_failed stage=${stage} ${exchangeErrorLabel(error)}`)
    this.armTimer(delay, key, true)
    this.notify()
    return true
  }

  private discardDialogBacking(): void {
    this.modalOpening = false
    this.modalBacking?.dispose()
    this.modalBacking = undefined
  }

  private resetModalPresentation(): void {
    this.modalRequest++
    this.modalOpen = false
    this.discardDialogBacking()
  }

  private clear(): void {
    if (this.projectFocusBound) { app.removeListener('browser-window-focus', this.refreshProjectsOnFocus); this.projectFocusBound = false }
    this.projects?.dispose()
    this.projects = undefined
    this.projectsRequested = false
    this.resetModalPresentation()
    this.viewBackground = undefined
    this.dialogViewport = undefined
    clearTimeout(this.settingsTimer)
    this.settingsSection = undefined
    this.settingsReturnRoute = undefined
    this.settingsReady = false
    this.settingsFailure = undefined
    this.landing = undefined
    this.welcomeCases = undefined
    this.navigation = undefined
    this.navigationRequest++
    this.generation += 1
    this.initialAttempt = 0
    this.renewalAttempt = 0
    this.offWorkspaceAttempt = 0
    this.offWorkspaceRecovery = false
    this.backoffScheduled = false
    this.renewalMode = false
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
    this.key = undefined
    this.origin = undefined
    this.routes.clear()
    this.deletedConversations.clear()
    const view = this.view
    const isolated = this.isolated
    this.view = undefined
    this.isolated = undefined
    if (view) {
      if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    if (isolated) {
      isolated.webRequest.onCompleted(null)
      void isolated.clearStorageData().then(() => isolated.closeAllConnections()).catch(() => this.note('[enterprise-chat] session_cleanup_failed'))
    }
    this.state = { phase: 'idle' }
  }

  dispose(): void { this.unsubscribe(); this.clear() }
}
