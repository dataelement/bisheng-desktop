import {
  parseProjectAction, parseProjectConversationRows, parseProjectPage, parseProjectResult,
  parseProjectSnapshot, projectRecord,
  type ChatProjectsState, type ProjectActionResult, type ProjectConversationPage
} from '../../shared/chat-projects'

interface ProjectTransport {
  epoch: number
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  renew: () => Promise<void>
  changed: (state: ChatProjectsState) => void
  note: (line: string) => void
  expectedUserId?: string
  expectedTenantId?: string
}
class ProjectTransportError extends Error {
  constructor(readonly code: number) { super(`Project request failed (${code}).`) }
}
const ENDPOINT = '/api/v1/chat/projects'

/**
 * One authenticated Session's project projection. The server has no push channel:
 * the snapshot is read on start, after every action, and when a window regains
 * focus (refreshIfStale), the same way the ordinary conversation list updates.
 */
export class EnterpriseChatProjects {
  private readonly lifetime = new AbortController()
  private value: ChatProjectsState
  private sequence = 0n
  private lastSnapshot = ''
  private lastReadAt = 0
  private refreshPending?: Promise<ChatProjectsState>
  private renewal?: Promise<void>
  private dirty = false
  private started = false

  constructor(private readonly options: ProjectTransport) {
    this.value = { epoch: options.epoch, phase: 'idle', connection: 'live', revision: '0', projects: [], assignments: {} }
  }

  state(): ChatProjectsState {
    return { ...this.value, projects: this.value.projects.map(row => ({ ...row })), assignments: { ...this.value.assignments } }
  }

  private current(epoch = this.options.epoch): void {
    if (this.lifetime.signal.aborted || epoch !== this.options.epoch) throw new Error('Project identity changed.')
  }

  private publish(patch: Partial<ChatProjectsState>): void {
    if (this.lifetime.signal.aborted) return
    if (Object.keys(patch).every(key => Object.is(this.value[key as keyof ChatProjectsState], patch[key as keyof ChatProjectsState]))) return
    this.value = { ...this.value, ...patch }
    this.options.changed(this.state())
  }

  private async renew(): Promise<void> {
    this.current()
    if (!this.renewal) this.renewal = this.options.renew().finally(() => { this.renewal = undefined })
    await this.renewal
    this.current()
  }

  private async response(path: string, init: RequestInit = {}): Promise<Response> {
    this.current()
    const signal = AbortSignal.any([this.lifetime.signal, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(15000)])
    const send = () => this.options.fetch(path, { ...init, signal, redirect: 'error' })
    let response = await send()
    this.current()
    if (response.status === 401) {
      await response.body?.cancel()
      this.publish({ phase: 'error', connection: 'auth_required', error: 'auth_required', projects: [], assignments: {}, identity: undefined })
      await this.renew()
      response = await send()
      this.current()
    }
    if (!response.ok) { await response.body?.cancel(); throw new ProjectTransportError(response.status) }
    return response
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.response(path, init)
    if (!response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); throw new ProjectTransportError(404) }
    const reader = response.body?.getReader()
    if (!reader) throw new ProjectTransportError(0)
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const next = await reader.read()
        this.current()
        if (next.done) break
        length += next.value.byteLength
        if (length > 16 * 1024 * 1024) throw new ProjectTransportError(0)
        chunks.push(next.value)
      }
      const envelope = projectRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
      if (envelope.status_code !== 200) throw new ProjectTransportError(typeof envelope.status_code === 'number' ? envelope.status_code : 0)
      return envelope.data
    } finally {
      try { await reader.cancel() } finally { reader.releaseLock() }
    }
  }

  start(): void {
    if (this.started || this.lifetime.signal.aborted) return
    this.started = true
    void this.refresh().catch(() => this.options.note('[project-sync] initial_snapshot_failed'))
  }

  /**
   * Focus hook: another client's edits appear when a window comes back. The short
   * floor only absorbs focus bursts; concurrent calls coalesce in refresh().
   */
  refreshIfStale(maxAgeMs = 1000): void {
    if (!this.started || this.lifetime.signal.aborted || this.refreshPending) return
    if (this.value.phase !== 'error' && Date.now() - this.lastReadAt < maxAgeMs) return
    void this.refresh().catch(() => this.options.note('[project-sync] focus_refresh_failed'))
  }

  refresh(): Promise<ChatProjectsState> {
    this.current()
    this.dirty = true
    if (!this.refreshPending) this.refreshPending = this.drain().finally(() => { this.refreshPending = undefined })
    return this.refreshPending
  }

  private async drain(): Promise<ChatProjectsState> {
    this.publish({ phase: this.value.projects.length ? this.value.phase : 'loading', error: undefined })
    try {
      while (this.dirty) {
        this.dirty = false
        const snapshot = parseProjectSnapshot(await this.json(`${ENDPOINT}/snapshot`))
        this.current()
        if ((this.options.expectedUserId && String(snapshot.identity.user_id) !== this.options.expectedUserId) || (this.options.expectedTenantId && String(snapshot.identity.tenant_id) !== this.options.expectedTenantId)) throw new ProjectTransportError(401)
        const ids = new Set(snapshot.projects.map(row => row.id))
        if (ids.size !== snapshot.projects.length || snapshot.memberships.some(row => !ids.has(row.project_id)) || new Set(snapshot.memberships.map(row => row.chat_id)).size !== snapshot.memberships.length) throw new ProjectTransportError(0)
        this.lastReadAt = Date.now()
        const projects = snapshot.projects.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
        const assignments = Object.fromEntries(snapshot.memberships.map(row => [row.chat_id, row.project_id]))
        // Advance the local sequence only on a content change, so the UI reloads
        // expanded project pages exactly when something actually moved.
        const fingerprint = JSON.stringify([snapshot.identity, projects, assignments])
        if (fingerprint !== this.lastSnapshot) { this.lastSnapshot = fingerprint; this.sequence += 1n }
        this.publish({ phase: 'ready', connection: 'live', error: undefined, revision: String(this.sequence), identity: snapshot.identity, projects, assignments })
      }
      return this.state()
    } catch (error) {
      if (!this.lifetime.signal.aborted) {
        const code = error instanceof ProjectTransportError ? error.code : 0
        this.options.note(`[project-sync] snapshot_failed code=${code}`)
        const auth = code === 401 || code === 403
        this.publish({ phase: 'error', error: code === 404 ? 'unsupported' : auth ? 'auth_required' : 'unavailable', connection: auth ? 'auth_required' : 'offline', ...(auth ? { projects: [], assignments: {}, identity: undefined } : {}) })
      }
      throw error
    }
  }

  async action(input: unknown, expectedEpoch: unknown): Promise<ProjectActionResult & { epoch: number }> {
    if (typeof expectedEpoch !== 'number') throw new Error('Invalid project epoch.')
    this.current(expectedEpoch)
    const action = parseProjectAction(input)
    const body = JSON.stringify(action)
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Project import is too large.')
    const result = parseProjectResult(await this.json(`${ENDPOINT}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
    this.current(expectedEpoch)
    // The action result confirms the operation; the view always comes from a fresh snapshot.
    await this.refresh()
    this.current(expectedEpoch)
    return { ...result, epoch: this.options.epoch }
  }

  async conversations(input: unknown, expectedEpoch: unknown): Promise<ProjectConversationPage> {
    if (typeof expectedEpoch !== 'number') throw new Error('Invalid project epoch.')
    this.current(expectedEpoch)
    const page = parseProjectPage(input)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(page)) if (value) query.set(key, value)
    const revision = this.value.revision
    const result = parseProjectConversationRows(await this.json(`${ENDPOINT}/conversations?${query}`), this.options.epoch, revision)
    this.current(expectedEpoch)
    return result
  }

  dispose(): void {
    this.lifetime.abort()
    this.value = { ...this.value, phase: 'idle', projects: [], assignments: {}, identity: undefined }
  }
}
