import { randomUUID } from 'node:crypto'
import type { MobileProductTransport, MobileRpcResult } from '../../../../src/main/mobile/product-extension'
import { isWorkRpcMethod, MobileWorkUploads, parseWorkDispatch, readUploadResult, readWorkEnvelope, readWorkJson } from './mobile-work-rpc'
import { projectChangesSummary, projectMobileOfficeCatalog, projectMobilePpt, projectSessionList, projectSessionRow, projectLiveAssistantFrame, projectTranscriptFrame, projectTranscriptHistory } from './mobile-phone-view'
const PERMISSION_PRESET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Enterprise gateway protocol adapter. Host auth, mux and native pairing remain upstream-owned. */
export class EnterpriseMobileRpc {
  private readonly workUploads = new MobileWorkUploads()
  private readonly now = Date.now
  private stopped = false
  constructor(private readonly transport: MobileProductTransport) {}
  dispose(): void { this.stopped = true }
  async dispatch(input: { method?: unknown; payload?: unknown }): Promise<MobileRpcResult | undefined> {
    if (this.stopped) return { ok: false, error: 'Mobile connection closed.' }
    if (typeof input.method !== 'string' || input.method.startsWith('interaction.')) return undefined
    if (isWorkRpcMethod(input.method)) return this.forwardWork(input.method, input.payload ?? {})
    if (input.method === 'session.changes') return this.forwardChanges(input.payload ?? {})
    if (['workspace.list','session.listPage','session.history','permission.current','permission.select','permission.catalog','session.list'].includes(input.method)) return this.forwardRpc(input.method, input.payload ?? {}, true)
    return undefined
  }
  private invokeHarness(endpoint: string, args: Record<string, unknown>): Promise<MobileRpcResult> { return this.transport.invoke(endpoint, args) }
  private async forwardChanges(payload: unknown): Promise<MobileRpcResult> {
    const fields = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
    const sessionId = typeof fields.sessionId === 'string' ? fields.sessionId.trim() : ''
    const rawSeq = typeof fields.seq === 'number' ? fields.seq : typeof fields.seq === 'string' ? Number(fields.seq) : Number.NaN
    if (sessionId.length === 0 || !Number.isSafeInteger(rawSeq) || rawSeq < 0) {
      return { ok: false, error: 'Missing change coordinates.' }
    }
    let response: Response
    try {
      response = await this.transport.request(
        `/api/changes.summary?${new URLSearchParams({ sessionId, seq: String(rawSeq) })}`,
        { method: 'GET', signal: AbortSignal.timeout(30_000) }
      )
    } catch {
      return { ok: false, error: 'Change summary was not available.' }
    }
    if (!response.ok) return { ok: false, error: `Change summary returned HTTP ${response.status}.` }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: 'Change summary was not JSON.' }
    }
    const projected = projectChangesSummary(body)
    if (projected === undefined) return { ok: false, error: 'Change summary was unreadable.' }
    return { ok: true, value: projected }
  }
  private requestHost(url: URL, init: RequestInit, _base: string): Promise<Response> {
    return this.transport.request(url.pathname + url.search, init)
  }
  private async readyWorkspaceSnapshot(): Promise<{ ok: true; value: WorkspaceSnapshot } | { ok: false; error: string }> {
    const deadline = Date.now() + 5000
    while (!this.stopped) {
      const result = await this.transport.forward('workspace.list', {})
      if (result.ok && isWorkspaceSnapshot(result.value)) return { ok: true, value: result.value }
      if (Date.now() >= deadline) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return { ok: false, error: 'Harness workspaces are not loaded yet.' }
  }
async forwardRpc(
    method: string,
    payload: unknown,
    remote = false
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const fields = typeof payload === 'object' && payload !== null
      ? payload as Record<string, unknown>
      : {}

    if (method === 'workspace.list') {
      // The Host kept no unary workspace read: `workspace/follow` is a stream,
      // and its opening `baseline` frame is exactly the projection this call
      // used to return. The mux consumer keeps that baseline, so the answer is
      // whatever the carrier last observed. An app request has to wait for
      // that first frame instead of failing while the socket is still opening.
      const ready = await this.readyWorkspaceSnapshot()
      if (!ready.ok) return ready
      return { ok: true, value: ready.value }
    }

    if (method === 'session.listPage') return this.forwardSessionPage(fields)

    if (method === 'session.history') {
      const sessionId = fields.sessionId
      const listed = await this.invokeHarness('session/list', { _request: {} })
      if (!listed.ok) return listed
      const items = (listed.value as {
        items?: {
          sessionId?: unknown
          projections?: { asOfSeq?: unknown; values?: unknown }
        }[]
      }).items ?? []
      const row = items.find((item) => item.sessionId === sessionId)
      const projections = row?.projections
      const throughSeq = projections?.asOfSeq
      if (typeof throughSeq !== 'number') return { ok: false, error: 'Harness has no cursor for this session.' }
      const page = await this.invokeHarness('session/page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(typeof fields.maxMessages === 'number' ? { maxMessages: fields.maxMessages } : {})
        }
      })
      if (!page.ok) return page
      const value = page.value as { records?: unknown; hasMore?: unknown }
      if (!Array.isArray(value?.records)) {
        return { ok: false, error: 'Harness returned invalid session history.' }
      }
      // Harness 0.1.2 calls the durable entries `records` and serves
      // projections on the list row. Keep the stable mobile-page contract so
      // cached pages can still render messages, running state, and todos.
      const history = {
        events: value.records,
        projections,
        hasMore: value.hasMore === true
      }
      return {
        ok: true,
        value: fields.view === 'transcript' ? projectTranscriptHistory(history) : history
      }
    }

    if (method === 'permission.current') return this.forwardPermissionCurrent(fields)
    if (method === 'permission.select') return this.forwardPermissionSelect(fields)

    const listed = method === 'permission.catalog'
      ? await this.invokeHarness('permissionPresets/catalog', {})
      : await this.transport.forward(method, fields)
    // The LAN page has no frame cap. Only the platform channel needs the trim.
    if (remote && method === 'session.list' && listed.ok) {
      return { ok: true, value: projectSessionList(listed.value) }
    }
    return listed
  }

private async forwardSessionPage(
    fields: Record<string, unknown>
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const ready = await this.readyWorkspaceSnapshot()
    if (!ready.ok) return ready
    const listed = await this.invokeHarness('session/list', { _request: {} })
    if (!listed.ok) return listed
    const items = isRecord(listed.value) && Array.isArray(listed.value.items)
      ? listed.value.items
      : []
    const workspaceId = typeof fields.workspaceId === 'string' ? fields.workspaceId.trim() : ''
    const openSessionId = typeof fields.openSessionId === 'string' && fields.openSessionId.trim() !== ''
      ? fields.openSessionId.trim()
      : undefined
    const archived = sessionIdSet(ready.value.archivedSessionIds)
    const pinned = sessionIdSet(ready.value.pinnedSessionIds)
    // `ungrouped` is its own page. An empty workspaceId still means "do not
    // filter by workspace", which is the whole list rather than the stray bucket.
    if (fields.ungrouped === true) {
      const accounted = new Set<string>()
      for (const item of ready.value.items) {
        if (!isRecord(item) || !Array.isArray(item.sessionIds)) continue
        for (const id of item.sessionIds) {
          if (typeof id === 'string' && id.length > 0) accounted.add(id)
        }
      }
      return {
        ok: true,
        value: pageMobileSessions({
          items,
          excludeSessionIds: accounted,
          archivedSessionIds: archived,
          pinnedSessionIds: pinned,
          openSessionId,
          cursor: fields.cursor,
          limit: fields.limit
        })
      }
    }
    let sessionIds: Set<string> | undefined
    if (workspaceId !== '') {
      const workspace = ready.value.items.find((item) => workspaceIdOf(item) === workspaceId)
      if (!isRecord(workspace)) return { ok: true, value: { items: [], hasMore: false } }
      sessionIds = sessionIdSet(workspace.sessionIds)
    }
    return {
      ok: true,
      value: pageMobileSessions({
        items,
        sessionIds,
        archivedSessionIds: archived,
        pinnedSessionIds: pinned,
        openSessionId,
        cursor: fields.cursor,
        limit: fields.limit
      })
    }
  }

  /**
   * Work-tab calls stay on the routes the desktop composer already uses.
   * Upload chunks are reassembled here because a phone RPC body is capped.
   */

private async forwardWork(
    method: string,
    payload: unknown
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const dispatch = parseWorkDispatch(method, payload)
    if ('error' in dispatch) return { ok: false, error: dispatch.error }
    if (dispatch.kind === 'upload-start') return this.workUploads.start(payload, this.now())
    if (dispatch.kind === 'upload-chunk') return this.workUploads.chunk(payload, this.now())
    if (dispatch.kind === 'upload-finish') {
      const ready = this.workUploads.finish(payload, this.now())
      if (!ready.ok) return ready
      return this.postWorkUpload(ready.value)
    }
    // Only a URL parser anchor; actual origin and cookie come from the Host transport.
    const base = 'http://harness.local'
    if (!base) return { ok: false, error: 'Harness is not ready.' }
    const rpcId = randomUUID()
    if (dispatch.kind === 'json') {
      const response = await this.requestHost(
        new URL(dispatch.path, base),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(dispatch.body),
          signal: AbortSignal.timeout(30_000)
        },
        base
      )
      return readWorkJson(response.status, await response.text())
    }
    if (dispatch.kind === 'office') {
      if (dispatch.payload.endpoint === 'welcome-cases') {
        const response = await this.transport.request('/api/enterprise.workbenches/welcome-cases.json', { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) return { ok: false, error: `Enterprise cases returned HTTP ${response.status}.` }
        const catalog: unknown = await response.json()
        if (!isRecord(catalog) || !Array.isArray(catalog.work) || !isRecord(catalog.batches)) return { ok: false, error: 'Invalid enterprise welcome cases.' }
        return { ok: true, value: { cases: catalog.work, batches: catalog.batches.work,
          chat: Array.isArray(catalog.chat) ? catalog.chat : [], chatBatches: Array.isArray(catalog.batches.chat) ? catalog.batches.chat : [] } }
      }
      // The phone sheet lists names only. Ask the catalogue to skip thumbnail files.
      const payload = dispatch.payload.endpoint === 'catalog'
        ? { ...dispatch.payload, summary: true }
        : dispatch.payload
      const response = await this.requestHost(
        new URL('/api/office-templates', base),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId,
            method: 'office-templates',
            payload
          }),
          signal: AbortSignal.timeout(30_000)
        },
        base
      )
      if (!response.ok) return { ok: false, error: `Harness transport returned HTTP ${response.status}.` }
      const envelope = readWorkEnvelope(await response.text(), rpcId)
      if (!envelope.ok || payload.endpoint !== 'catalog') return envelope
      return { ok: true, value: projectMobileOfficeCatalog(envelope.value) }
    }
    const response = await this.requestHost(
      new URL(`/dsh-ppt/${dispatch.endpoint}`, base),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rpcId, payload: dispatch.payload }),
        signal: AbortSignal.timeout(30_000)
      },
      base
    )
    if (!response.ok) return { ok: false, error: `Harness transport returned HTTP ${response.status}.` }
    const envelope = readWorkEnvelope(await response.text(), rpcId)
    if (!envelope.ok || dispatch.kind !== 'ppt') return envelope
    return { ok: true, value: projectMobilePpt(dispatch.endpoint, envelope.value) }
  }

private async postWorkUpload(upload: {
    sessionId: string
    name: string
    body: Buffer
  }): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    // Only a URL parser anchor; actual origin and cookie come from the Host transport.
    const base = 'http://harness.local'
    if (!base) return { ok: false, error: 'Harness is not ready.' }
    const url = new URL('/api/session/uploadFileBinary', base)
    url.searchParams.set('sessionId', upload.sessionId)
    url.searchParams.set('name', upload.name)
    const response = await this.requestHost(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(upload.body),
        signal: AbortSignal.timeout(60_000)
      },
      base
    )
    return readUploadResult(response.status, await response.text())
  }

private async forwardPermissionCurrent(
    fields: Record<string, unknown>
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const sessionId = fields.sessionId
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      return { ok: false, error: 'Session id is required.' }
    }
    const listed = await this.invokeHarness('session/list', { _request: {} })
    if (!listed.ok) return listed
    const items = isRecord(listed.value) && Array.isArray(listed.value.items)
      ? listed.value.items
      : []
    const row = items.find((item) => isRecord(item) && item.sessionId === sessionId)
    if (!isRecord(row) || !isRecord(row.projections) || !isRecord(row.projections.values)) {
      return { ok: true, value: {} }
    }
    const values = row.projections.values
    if (!Object.prototype.hasOwnProperty.call(values, 'permissions')) {
      return { ok: true, value: {} }
    }
    const permissions = values.permissions
    const currentValue = isRecord(permissions) && typeof permissions.currentValue === 'string'
      ? permissions.currentValue.trim()
      : ''
    if (currentValue === '') return { ok: true, value: {} }
    return { ok: true, value: { currentValue } }
  }

private async forwardPermissionSelect(
    fields: Record<string, unknown>
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    if ('line' in fields || 'command' in fields) {
      return { ok: false, error: 'Permission changes do not accept a command line.' }
    }
    const sessionId = fields.sessionId
    const preset = fields.preset
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      return { ok: false, error: 'Session id is required.' }
    }
    if (typeof preset !== 'string' || preset === 'custom' || !PERMISSION_PRESET_NAME.test(preset)) {
      return { ok: false, error: 'Unknown permission preset.' }
    }
    const executed = await this.invokeHarness('commands/execute', {
      agentId: sessionId,
      line: `/permission ${preset}`,
      submittedAttachments: []
    })
    if (!executed.ok) return executed
    if (!isRecord(executed.value)) {
      return { ok: false, error: 'the host offers no /permission command' }
    }
    const outcome = isRecord(executed.value.result) ? executed.value.result : undefined
    if (outcome?.kind === 'error') {
      const text = typeof outcome.text === 'string' && outcome.text.trim() !== ''
        ? outcome.text
        : 'Permission change failed.'
      return { ok: false, error: text }
    }
    return { ok: true, value: { preset } }
  }
}

export function transcriptFollowValue(
  value: unknown,
  transcript: boolean,
  liveTurn: { turn?: number; step?: number }
): unknown {
  if (!isRecord(value)) return transcript ? undefined : value
  if (value.type === 'snapshot') rememberLiveTurn(value.assistantStream, liveTurn)
  if (value.type === 'assistant-stream') return projectLiveAssistantFrame(value.frame, liveTurn)
  return transcript ? projectTranscriptFrame(value) : value
}

function rememberLiveTurn(baseline: unknown, liveTurn: { turn?: number; step?: number }): void {
  const attempt = isRecord(baseline) && isRecord(baseline.activeAttempt) ? baseline.activeAttempt : undefined
  if (attempt === undefined) return
  if (typeof attempt.turn === 'number') liveTurn.turn = attempt.turn
  if (typeof attempt.step === 'number') liveTurn.step = attempt.step
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface WorkspaceSnapshot extends Record<string, unknown> {
  items: unknown[]
  archivedSessionIds?: unknown
  pinnedSessionIds?: unknown
}

/** Default and cap for one phone page. A page stays far under the gateway frame. */
export const SESSION_PAGE_LIMIT = 30
const SESSION_PAGE_MAX = 100

/**
 * Sidebar segments. A blank placeholder and pinned rows sit ahead of recency,
 * so one updatedAt keyset is not monotonic across the whole page. Each segment
 * stays ordered by updatedAt, and the cursor names the segment it left off in.
 */
const SESSION_SEGMENTS = ['blank', 'pinned', 'plain'] as const
type SessionSegment = (typeof SESSION_SEGMENTS)[number]

/**
 * Cut a harness session list into one phone page.
 *
 * Membership matches the desktop sidebar's default view: subagent rows, archived
 * rows, and blank rows other than the phone's open session stay off the page
 * so they do not consume a slot. Within the page the open blank row is first,
 * then pinned rows, then the rest. Each of those groups is newest-first, and
 * equal times break ties by session id. A cursor names the segment and the last
 * row already delivered. A cursor that cannot be read starts at the first row.
 */
export function pageMobileSessions(input: {
  items: unknown
  sessionIds?: ReadonlySet<string>
  excludeSessionIds?: ReadonlySet<string>
  archivedSessionIds?: ReadonlySet<string>
  pinnedSessionIds?: ReadonlySet<string>
  openSessionId?: string
  cursor?: unknown
  limit?: unknown
}): { items: Record<string, unknown>[]; nextCursor?: string; hasMore: boolean } {
  const pinned = input.pinnedSessionIds ?? new Set<string>()
  const rows: Array<{
    updatedAt: number
    sessionId: string
    segment: SessionSegment
    row: Record<string, unknown>
  }> = []
  if (Array.isArray(input.items)) {
    for (const item of input.items) {
      if (!isRecord(item) || typeof item.sessionId !== 'string' || item.sessionId.length === 0) continue
      if (input.sessionIds !== undefined && !input.sessionIds.has(item.sessionId)) continue
      if (input.excludeSessionIds?.has(item.sessionId)) continue
      if (input.archivedSessionIds?.has(item.sessionId)) continue
      if (item.origin === 'subagent') continue
      if (item.blank === true && item.sessionId !== input.openSessionId) continue
      const updatedAt = typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
        ? item.updatedAt
        : 0
      rows.push({
        updatedAt,
        sessionId: item.sessionId,
        segment: sessionSegment(item, input.openSessionId, pinned),
        row: item
      })
    }
  }
  rows.sort(compareSidebarRows)
  const cursor = parseSessionCursor(input.cursor)
  const start = cursor === undefined ? 0 : rows.findIndex((row) => isAfterSessionCursor(row, cursor))
  const offset = start < 0 ? rows.length : start
  const limit = sessionPageLimit(input.limit)
  const slice = rows.slice(offset, offset + limit)
  const hasMore = offset + slice.length < rows.length
  const last = slice[slice.length - 1]
  return {
    items: slice.flatMap((item) => {
      const projected = projectSessionRow(item.row)
      return projected === undefined ? [] : [projected]
    }),
    ...(hasMore && last !== undefined ? { nextCursor: sessionCursor(last) } : {}),
    hasMore
  }
}

function sessionSegment(
  row: Record<string, unknown>,
  openSessionId: string | undefined,
  pinned: ReadonlySet<string>
): SessionSegment {
  if (row.blank === true && row.sessionId === openSessionId) return 'blank'
  if (typeof row.sessionId === 'string' && pinned.has(row.sessionId)) return 'pinned'
  return 'plain'
}

function compareSidebarRows(
  left: { updatedAt: number; sessionId: string; segment: SessionSegment },
  right: { updatedAt: number; sessionId: string; segment: SessionSegment }
): number {
  const bySegment = SESSION_SEGMENTS.indexOf(left.segment) - SESSION_SEGMENTS.indexOf(right.segment)
  if (bySegment !== 0) return bySegment
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  if (left.sessionId < right.sessionId) return -1
  if (left.sessionId > right.sessionId) return 1
  return 0
}

function sessionPageLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return SESSION_PAGE_LIMIT
  return Math.min(Math.floor(value), SESSION_PAGE_MAX)
}

function parseSessionCursor(value: unknown): {
  segment: SessionSegment
  updatedAt: number
  sessionId: string
} | undefined {
  if (typeof value !== 'string') return undefined
  const split = value.indexOf(':')
  if (split <= 0) return undefined
  const segment = value.slice(0, split)
  if (!isSessionSegment(segment)) return undefined
  const rest = value.slice(split + 1)
  const timeSplit = rest.indexOf(':')
  if (timeSplit <= 0) return undefined
  const updatedAt = Number(rest.slice(0, timeSplit))
  const sessionId = rest.slice(timeSplit + 1)
  if (!Number.isFinite(updatedAt) || sessionId.length === 0) return undefined
  return { segment, updatedAt, sessionId }
}

function isSessionSegment(value: string): value is SessionSegment {
  return (SESSION_SEGMENTS as readonly string[]).includes(value)
}

function isAfterSessionCursor(
  row: { updatedAt: number; sessionId: string; segment: SessionSegment },
  cursor: { updatedAt: number; sessionId: string; segment: SessionSegment }
): boolean {
  const bySegment = SESSION_SEGMENTS.indexOf(row.segment) - SESSION_SEGMENTS.indexOf(cursor.segment)
  if (bySegment !== 0) return bySegment > 0
  if (row.updatedAt !== cursor.updatedAt) return row.updatedAt < cursor.updatedAt
  return row.sessionId > cursor.sessionId
}

function sessionCursor(row: { updatedAt: number; sessionId: string; segment: SessionSegment }): string {
  return `${row.segment}:${row.updatedAt}:${row.sessionId}`
}

function sessionIdSet(value: unknown): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(value)) return ids
  for (const id of value) {
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return ids
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  return isRecord(value) && Array.isArray(value.items)
}

function workspaceIdOf(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) return undefined
  return value.workspaceId
}
