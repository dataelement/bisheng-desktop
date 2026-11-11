import {
  parseProjectAction, parseProjectConversationRows, parseProjectPage, parseProjectResult,
  parseProjectSnapshot, projectRecord, projectRevision,
  type ChatProjectsState, type ProjectActionResult, type ProjectConversationPage, type ProjectSnapshot
} from './shared/chat-projects'

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

/** One authenticated Session's project projection and event subscription. */
export class EnterpriseChatProjects {
  private readonly lifetime = new AbortController()
  private value: ChatProjectsState
  private observed = '0'
  private refreshPending?: Promise<ChatProjectsState>
  private renewal?: Promise<void>
  private dirty = false
  private started = false
  private retryTimer?: ReturnType<typeof setTimeout>
  private releaseRetry?: () => void
  private streamReader?: ReadableStreamDefaultReader<Uint8Array>

  constructor(private readonly options: ProjectTransport) {
    this.value = { epoch: options.epoch, phase: 'idle', connection: 'connecting', revision: '0', projects: [], assignments: {} }
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

  private observe(revision: string): void {
    if (BigInt(revision) > BigInt(this.observed)) this.observed = revision
  }

  private async renew(): Promise<void> {
    this.current()
    if (!this.renewal) this.renewal = this.options.renew().finally(() => { this.renewal = undefined })
    await this.renewal
    this.current()
  }

  private async response(path: string, init: RequestInit = {}, stream = false): Promise<Response> {
    this.current()
    const signal = AbortSignal.any([this.lifetime.signal, ...(init.signal ? [init.signal] : []), ...(stream ? [] : [AbortSignal.timeout(15000)])])
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
    if (!reader) throw new ProjectTransportError(13016)
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const next = await reader.read()
        this.current()
        if (next.done) break
        length += next.value.byteLength
        if (length > 4 * 1024 * 1024) throw new ProjectTransportError(13016)
        chunks.push(next.value)
      }
      const envelope = projectRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
      if (envelope.status_code !== 200) throw new ProjectTransportError(typeof envelope.status_code === 'number' ? envelope.status_code : 13016)
      return envelope.data
    } finally {
      try { await reader.cancel() } finally { reader.releaseLock() }
    }
  }

  start(): void {
    if (this.started || this.lifetime.signal.aborted) return
    this.started = true
    void this.refresh().catch(() => this.options.note('[project-sync] initial_snapshot_failed'))
    void this.listen().catch(() => this.options.note('[project-sync] subscription_stopped'))
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
        let assembled: ProjectSnapshot | undefined
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            let cursor: string | null = null
            const seen = new Set<string>()
            assembled = undefined
            do {
              const page = parseProjectSnapshot(await this.json(`${ENDPOINT}/snapshot${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`))
              this.current()
              if ((this.options.expectedUserId && String(page.identity.user_id) !== this.options.expectedUserId) || (this.options.expectedTenantId && String(page.identity.tenant_id) !== this.options.expectedTenantId)) throw new ProjectTransportError(401)
              if (assembled && (page.revision !== assembled.revision || page.identity.user_id !== assembled.identity.user_id || page.identity.tenant_id !== assembled.identity.tenant_id)) throw new ProjectTransportError(13013)
              assembled = assembled ? { ...page, projects: [...assembled.projects, ...page.projects], memberships: [...assembled.memberships, ...page.memberships] } : page
              cursor = page.next_cursor
              if (cursor && seen.has(cursor)) throw new ProjectTransportError(13016)
              if (cursor) seen.add(cursor)
              if (assembled.projects.length + assembled.memberships.length > 1000000) throw new ProjectTransportError(13016)
            } while (cursor)
            if (!assembled || BigInt(assembled.revision) < BigInt(this.observed)) throw new ProjectTransportError(13013)
            break
          } catch (error) {
            if (!(error instanceof ProjectTransportError) || error.code !== 13013 || attempt === 5) throw error
          }
        }
        if (!assembled) throw new ProjectTransportError(13016)
        const ids = new Set(assembled.projects.map(row => row.id))
        if (ids.size !== assembled.projects.length || assembled.memberships.some(row => !ids.has(row.project_id)) || new Set(assembled.memberships.map(row => row.chat_id)).size !== assembled.memberships.length) throw new ProjectTransportError(13016)
        this.observe(assembled.revision)
        this.publish({ phase: 'ready', error: undefined, revision: assembled.revision, identity: assembled.identity, projects: assembled.projects.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)), assignments: Object.fromEntries(assembled.memberships.map(row => [row.chat_id, row.project_id])) })
      }
      return this.state()
    } catch (error) {
      if (!this.lifetime.signal.aborted) {
        const code = error instanceof ProjectTransportError ? error.code : 13016
        this.options.note(`[project-sync] snapshot_failed code=${code}`)
        this.publish({ phase: 'error', error: code === 404 ? 'unsupported' : code === 401 || code === 403 ? 'auth_required' : 'unavailable', ...(code === 401 || code === 403 ? { projects: [], assignments: {}, identity: undefined, connection: 'auth_required' as const } : {}) })
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
    this.observe(result.revision)
    this.publish({ connection: result.notification })
    // An old replay receipt confirms the operation, never the current view.
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
    const result = parseProjectConversationRows(await this.json(`${ENDPOINT}/conversations?${query}`), this.options.epoch)
    this.current(expectedEpoch)
    if (BigInt(result.revision) < BigInt(this.observed)) throw new ProjectTransportError(13013)
    return result
  }

  private async stream(healthy: () => void): Promise<void> {
    const controller = new AbortController()
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(() => controller.abort(), 45000) }
    try {
      touch()
      const response = await this.response(`${ENDPOINT}/events`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } }, true)
      if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) { await response.body?.cancel(); throw new ProjectTransportError(404) }
      reader = response.body.getReader()
      this.streamReader = reader
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let buffer = ''
      while (true) {
        const next = await reader.read()
        this.current()
        if (next.done) throw new ProjectTransportError(13016)
        buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/gu, '\n')
        let end: number
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          if (end > 16384) throw new ProjectTransportError(13016)
          const frame = buffer.slice(0, end), lines = frame.split('\n')
          buffer = buffer.slice(end + 2)
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
          const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!event || !raw) continue
          const data = projectRecord(JSON.parse(raw))
          if (data.protocol_version !== 1 || !['ready', 'changed', 'heartbeat', 'auth_required'].includes(event)) throw new ProjectTransportError(13016)
          const revision = projectRevision(data.revision)
          touch()
          healthy()
          if (event === 'auth_required') {
            this.publish({ phase: 'error', connection: 'auth_required', error: 'auth_required', projects: [], assignments: {}, identity: undefined })
            await this.renew()
            throw new ProjectTransportError(401)
          }
          this.observe(revision)
          this.publish({ connection: data.notification === 'degraded' ? 'degraded' : 'live' })
          if (event === 'ready' || this.value.phase === 'error' || BigInt(this.value.revision) < BigInt(revision)) void this.refresh().catch(() => this.options.note('[project-sync] event_refresh_failed'))
        }
        if (buffer.length > 16384) throw new ProjectTransportError(13016)
      }
    } finally {
      clearTimeout(watchdog)
      controller.abort()
      if (reader) { try { await reader.cancel() } finally { reader.releaseLock() } }
      if (this.streamReader === reader) this.streamReader = undefined
    }
  }

  private async listen(): Promise<void> {
    let attempt = 0
    while (!this.lifetime.signal.aborted) {
      try { await this.stream(() => { attempt = 0 }) }
      catch (error) {
        if (this.lifetime.signal.aborted) return
        const code = error instanceof ProjectTransportError ? error.code : 13016
        this.options.note(`[project-sync] stream_disconnected code=${code}`)
        this.publish({ connection: code === 401 || code === 403 ? 'auth_required' : 'offline', ...(code === 404 ? { phase: 'error' as const, error: 'unsupported' as const } : {}) })
      }
      const delay = [2000, 5000, 10000, 30000][Math.min(attempt++, 3)] ?? 30000
      await new Promise<void>(resolve => { this.releaseRetry = resolve; this.retryTimer = setTimeout(resolve, delay * (0.85 + Math.random() * 0.3)) })
      this.releaseRetry = undefined
    }
  }

  dispose(): void {
    this.lifetime.abort()
    void this.streamReader?.cancel().catch(() => this.options.note('[project-sync] reader_cleanup_failed'))
    clearTimeout(this.retryTimer)
    this.releaseRetry?.()
    this.value = { ...this.value, phase: 'idle', projects: [], assignments: {}, identity: undefined }
  }
}
