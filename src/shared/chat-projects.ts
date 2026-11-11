/** Serializable fixed project protocol shared by main and preload. */
export interface ChatProject { id: string; name: string; createdAt?: string }
export interface ProjectSnapshot {
  identity: { user_id: number; tenant_id: number }
  projects: ChatProject[]
  memberships: Array<{ chat_id: string; project_id: string }>
}
/**
 * The server has no push channel or version: main re-reads the snapshot on start,
 * after each action and when a window regains focus. `revision` is main's own
 * sequence, advanced only when the snapshot content changes, so the UI can still
 * tell a newer projection from an older one.
 */
export interface ChatProjectsState {
  epoch: number
  phase: 'idle' | 'loading' | 'ready' | 'error'
  connection: 'live' | 'offline' | 'auth_required'
  revision: string
  projects: ChatProject[]
  assignments: Record<string, string>
  identity?: ProjectSnapshot['identity']
  identityLabel?: string
  error?: 'unsupported' | 'unavailable' | 'auth_required'
}
/** create carries a client-generated project id, so retrying the same create is idempotent. */
export type ProjectOperation =
  | { operation: 'create'; project_id: string; name: string; chat_id?: string }
  | { operation: 'rename'; project_id: string; name: string }
  | { operation: 'delete'; project_id: string }
  | { operation: 'assign'; chat_id: string; project_id: string | null }
  | { operation: 'import'; projects: Array<{ legacy_id: string; name: string; created_at?: string }>; memberships: Array<{ chat_id: string; legacy_project_id: string }> }
export type ProjectAction = ProjectOperation
export interface ProjectActionResult {
  outcome: { project_id?: string; chat_id?: string; items?: Array<{ kind: string; status: string; legacy_id?: string; chat_id?: string }> }
}
export interface ProjectPageInput { project_id?: string; query?: string; cursor?: string }
export interface ProjectConversationRow { id: string; title: string; updatedAt: string; flowId: string; flowType: number }
export interface ProjectConversationPage { epoch: number; revision: string; items: ProjectConversationRow[]; nextCursor: string | null; total: number }

export function projectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project data.')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('Invalid project text.')
  return value
}
export function projectUuid(value: unknown): string {
  const result = text(value, 36)
  if (!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/u.test(result)) throw new Error('Invalid project identity.')
  return result
}
function chatId(value: unknown): string {
  const result = text(value, 255)
  if (!/^[a-zA-Z0-9_-]+$/u.test(result)) throw new Error('Invalid project conversation.')
  return result
}
export function projectRevision(value: unknown): string {
  const result = text(value, 20)
  if (!/^(0|[1-9]\d*)$/u.test(result)) throw new Error('Invalid project revision.')
  return result
}
function name(value: unknown): string { return text(typeof value === 'string' ? value.trim() : value, 30) }
function exact(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Invalid project operation field.')
}
/** The server's page cursor is an opaque decimal offset. */
function cursor(value: unknown): string | null {
  if (value === null) return null
  const result = text(value, 9)
  if (!/^\d+$/u.test(result)) throw new Error('Invalid project cursor.')
  return result
}

export function parseProjectAction(value: unknown): ProjectAction {
  const input = projectRecord(value)
  const base = ['operation']
  if (input.operation === 'create') {
    exact(input, [...base, 'project_id', 'name', 'chat_id'])
    return { operation: 'create', project_id: projectUuid(input.project_id), name: name(input.name), ...(input.chat_id === undefined ? {} : { chat_id: chatId(input.chat_id) }) }
  }
  if (input.operation === 'rename') {
    exact(input, [...base, 'project_id', 'name'])
    return { operation: 'rename', project_id: projectUuid(input.project_id), name: name(input.name) }
  }
  if (input.operation === 'delete') {
    exact(input, [...base, 'project_id'])
    return { operation: 'delete', project_id: projectUuid(input.project_id) }
  }
  if (input.operation === 'assign') {
    exact(input, [...base, 'chat_id', 'project_id'])
    return { operation: 'assign', chat_id: chatId(input.chat_id), project_id: input.project_id === null ? null : projectUuid(input.project_id) }
  }
  if (input.operation !== 'import') throw new Error('Invalid project operation.')
  exact(input, [...base, 'projects', 'memberships'])
  // One request carries the whole legacy record; the server caps it at 100 projects / 2000 memberships.
  if (!Array.isArray(input.projects) || input.projects.length > 100 || !Array.isArray(input.memberships) || input.memberships.length > 2000) throw new Error('Invalid project import batch.')
  const projects = input.projects.map((value: unknown) => {
    const row = projectRecord(value)
    exact(row, ['legacy_id', 'name', 'created_at'])
    return { legacy_id: text(row.legacy_id, 255), name: name(row.name), ...(row.created_at === undefined ? {} : { created_at: text(row.created_at, 64) }) }
  })
  const memberships = input.memberships.map((value: unknown) => {
    const row = projectRecord(value)
    exact(row, ['chat_id', 'legacy_project_id'])
    return { chat_id: chatId(row.chat_id), legacy_project_id: text(row.legacy_project_id, 255) }
  })
  return { operation: 'import', projects, memberships }
}

export function parseProjectPage(value: unknown): ProjectPageInput {
  const input = projectRecord(value)
  exact(input, ['project_id', 'query', 'cursor'])
  const project_id = input.project_id === undefined ? undefined : projectUuid(input.project_id)
  const query = input.query === undefined ? undefined : text(input.query, 255).trim()
  if (!project_id && !query) throw new Error('A project or search query is required.')
  return { project_id, query, cursor: input.cursor === undefined ? undefined : cursor(input.cursor) ?? undefined }
}

export function parseProjectSnapshot(value: unknown): ProjectSnapshot {
  const input = projectRecord(value), identity = projectRecord(input.identity)
  if (!Number.isSafeInteger(identity.user_id) || Number(identity.user_id) < 1 || !Number.isSafeInteger(identity.tenant_id) || Number(identity.tenant_id) < 1 || !Array.isArray(input.projects) || !Array.isArray(input.memberships) || input.projects.length + input.memberships.length > 1000000) throw new Error('Unsupported project protocol.')
  const projects = input.projects.map((value: unknown) => { const row = projectRecord(value); return { id: projectUuid(row.id), name: name(row.name), ...(typeof row.created_at === 'string' && row.created_at.length <= 64 ? { createdAt: row.created_at } : {}) } })
  const memberships = input.memberships.map((value: unknown) => { const row = projectRecord(value); return { chat_id: chatId(row.chat_id), project_id: projectUuid(row.project_id) } })
  return { identity: { user_id: Number(identity.user_id), tenant_id: Number(identity.tenant_id) }, projects, memberships }
}

export function parseProjectResult(value: unknown): ProjectActionResult {
  const input = projectRecord(value), row = projectRecord(input.outcome)
  const outcome: ProjectActionResult['outcome'] = {}
  if (row.project_id != null) outcome.project_id = projectUuid(row.project_id)
  if (row.chat_id !== undefined) outcome.chat_id = chatId(row.chat_id)
  if (row.items !== undefined) {
    if (!Array.isArray(row.items) || row.items.length > 2100) throw new Error('Invalid import results.')
    outcome.items = row.items.map((value: unknown) => {
      const item = projectRecord(value)
      return { kind: text(item.kind, 32), status: text(item.status, 64), ...(item.chat_id === undefined ? {} : { chat_id: chatId(item.chat_id) }), ...(item.legacy_id === undefined ? {} : { legacy_id: text(item.legacy_id, 255) }) }
    })
  }
  return { outcome }
}

/** `revision` is main's snapshot sequence at the time of the read, not a server field. */
export function parseProjectConversationRows(value: unknown, epoch: number, revision: string): ProjectConversationPage {
  const input = projectRecord(value)
  if (!Array.isArray(input.data) || input.data.length > 100 || !Number.isSafeInteger(input.total) || Number(input.total) < 0) throw new Error('Invalid project history.')
  const items = input.data.map((value: unknown) => {
    const row = projectRecord(value)
    const flowType = Number(row.flow_type)
    if (![1, 5, 10, 15, 20].includes(flowType)) throw new Error('Invalid project conversation type.')
    return { id: chatId(row.chat_id), title: String(row.name || row.flow_name || '').slice(0, 500), updatedAt: String(row.update_time || row.create_time || '').slice(0, 50), flowType, flowId: typeof row.flow_id === 'string' ? row.flow_id : '' }
  })
  return { epoch, revision: projectRevision(revision), items, total: Number(input.total), nextCursor: cursor(input.next_cursor) }
}
