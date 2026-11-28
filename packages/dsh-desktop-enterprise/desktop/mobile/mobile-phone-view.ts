/**
 * Fields the phone actually renders. The full PPT state and session page carry
 * preview images and tool results that a single gateway frame cannot hold.
 * Reasoning stays, but a history page keeps it only for the latest turns so
 * the unary RPC still fits the gateway frame. Live follow frames are chunked
 * and keep every reasoning delta.
 */

/** History turns whose reasoning text is copied through. Older turns keep the answer only. */
const RECENT_REASONING_TURNS = 3

const PPT_STATE_FIELDS = [
  'selectedTemplateId',
  'presentationMode',
  'documentMode',
  'selectedDocumentTemplate',
  'templateMigration'
] as const

const PPT_TEMPLATE_FIELDS = ['id', 'name', 'title', 'displayName', 'revision', 'mode'] as const

const USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens'
] as const

const SESSION_ROW_FIELDS = ['updatedAt', 'running', 'blank', 'origin'] as const

// Harness 0.2.1 keeps the preset inside the projection, not on the row.
const SESSION_VALUE_FIELDS = [
  'title',
  'sessionTitle',
  'session.title',
  'modelSelection',
  'agentPreset'
] as const

/**
 * One session-list row the phone menu can render. The rest of the projection
 * (todos, goals, questions) is what pushes a full list past the gateway frame.
 * A row without a session id is skipped so one bad item does not drop the page.
 */
export function projectSessionRow(value: unknown): Record<string, unknown> | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const sessionId = row.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  const projected: Record<string, unknown> = { sessionId }
  copyOwn(projected, row, [...SESSION_ROW_FIELDS])
  const values = record(record(row.projections)?.values)
  if (values === undefined) return projected
  const kept: Record<string, unknown> = {}
  copyOwn(kept, values, [...SESSION_VALUE_FIELDS])
  if (Object.keys(kept).length > 0) projected.projections = { values: kept }
  return projected
}

/** Remote session.list. The LAN page keeps the harness payload unchanged. */
export function projectSessionList(value: unknown): unknown {
  const body = record(value)
  if (body === undefined || !Array.isArray(body.items)) return value
  return {
    items: body.items.flatMap((item) => {
      const row = projectSessionRow(item)
      return row === undefined ? [] : [row]
    })
  }
}

/**
 * Office catalogue rows the phone sheet can render. Thumbnails, prompts, and
 * page geometry stay on the desktop; a phone frame cannot carry them.
 */
export function projectMobileOfficeCatalog(value: unknown): unknown {
  const body = record(value)
  if (body === undefined) return value
  const listed = templateList(body)
  if (listed === undefined) return value
  return { [listed.key]: listed.items }
}

export function projectMobilePpt(endpoint: string, value: unknown): unknown {
  if (endpoint !== 'state' && endpoint !== 'template/catalog') return value
  const body = record(value)
  if (body === undefined) return value
  const projected: Record<string, unknown> = {}
  for (const field of PPT_STATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) projected[field] = body[field]
  }
  const listed = templateList(body)
  if (listed !== undefined) projected[listed.key] = listed.items
  return projected
}

/**
 * History page the phone reads: events it can render, plus whether older
 * history sits before this window. List-row projections stay on the desktop.
 */
export function projectTranscriptHistory(value: unknown): unknown {
  const body = record(value)
  if (body === undefined) return value
  const raw = Array.isArray(body.events)
    ? body.events
    : Array.isArray(body.records)
      ? body.records
      : undefined
  const events = raw === undefined ? [] : raw.flatMap(projectRecord)
  return {
    events: keepRecentReasoning(events),
    hasMore: body.hasMore === true
  }
}

/** One follow frame. Undefined means the phone has nothing to append. */
export function projectTranscriptFrame(value: unknown): unknown | undefined {
  const body = record(value)
  if (body === undefined) return undefined
  if (body.type === 'snapshot') {
    const records = Array.isArray(body.records) ? body.records : []
    return {
      type: 'snapshot',
      records: [...records.flatMap(projectRecord), ...liveAttemptChunks(body.assistantStream)],
      hasMore: body.hasMore === true
    }
  }
  if (body.type !== 'event') return undefined
  const projected = projectRecord(body.event)
  const event = projected[0]
  if (event === undefined) return undefined
  return { type: 'event', event }
}

/**
 * One process-local assistant frame, rewritten as the durable chunk the phone
 * already appends. `turn` is filled from the matching `start` frame because a
 * later chunk does not repeat it. A tool delta becomes one compact
 * `tool/status` row; raw arguments and tool output stay on the desktop.
 */
export interface LiveAssistantCursor {
  turn?: number
  step?: number
  tools?: Record<string, { name?: string; args: string; sent?: string }>
}

const TOOL_DETAIL_KEYS = [
  'title',
  'description',
  'objective',
  'task',
  'task_name',
  'name',
  'question',
  'questions',
  'prompt',
  'message',
  'command',
  'cmd',
  'queries',
  'query',
  'pattern',
  'url',
  'uri',
  'file_path',
  'path',
  'target',
  'action',
  'status'
] as const

const TOOL_ARGUMENT_CAP = 2048

export function projectLiveAssistantFrame(
  frame: unknown,
  turn: LiveAssistantCursor
): Record<string, unknown> | undefined {
  const body = record(frame)
  if (body === undefined) return undefined
  if (body.type === 'start') {
    if (typeof body.turn === 'number') turn.turn = body.turn
    if (typeof body.step === 'number') turn.step = body.step
    return undefined
  }
  if (body.type !== 'chunk') return undefined
  const tool = projectLiveToolDelta(body, turn)
  if (tool !== undefined) return tool
  const chunk = visibleDelta(body.chunk)
  if (chunk === undefined || typeof turn.turn !== 'number' || typeof turn.step !== 'number') return undefined
  return {
    type: 'event',
    event: {
      type: 'assistant/chunk',
      ...(typeof body.time === 'number' ? { time: body.time } : {}),
      data: { turn: turn.turn, step: turn.step, chunk }
    }
  }
}

/** Text already generated when the phone joins, carried on the follow snapshot. */
function liveAttemptChunks(value: unknown): Record<string, unknown>[] {
  const attempt = record(record(value)?.activeAttempt)
  if (attempt === undefined || typeof attempt.turn !== 'number' || typeof attempt.step !== 'number') return []
  if (!Array.isArray(attempt.stream)) return []
  const chunks: Record<string, unknown>[] = []
  for (const item of attempt.stream) {
    const row = record(item)
    if (row === undefined) continue
    const kind = row.type === 'text-chunks' ? 'text-delta' : row.type === 'reasoning-chunks' ? 'reasoning-delta' : undefined
    if (kind === undefined || !Array.isArray(row.texts)) continue
    const text = row.texts.filter((piece): piece is string => typeof piece === 'string').join('')
    if (text.length === 0) continue
    const chunk: Record<string, unknown> = { type: kind, text }
    if (typeof row.index === 'number') chunk.index = row.index
    chunks.push({
      type: 'assistant/chunk',
      data: { turn: attempt.turn, step: attempt.step, chunk }
    })
  }
  return chunks
}

function visibleDelta(value: unknown): Record<string, unknown> | undefined {
  const chunk = record(value)
  if (chunk === undefined || (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta')) return undefined
  if (typeof chunk.text !== 'string' || chunk.text.length === 0) return undefined
  const projected: Record<string, unknown> = { type: chunk.type, text: chunk.text }
  if (typeof chunk.index === 'number') projected.index = chunk.index
  return projected
}

function templateList(
  body: Record<string, unknown>
): { key: 'templates' | 'items'; items: Record<string, unknown>[] } | undefined {
  if (Array.isArray(body.templates)) {
    return { key: 'templates', items: body.templates.flatMap(projectTemplate) }
  }
  if (Array.isArray(body.items)) {
    return { key: 'items', items: body.items.flatMap(projectTemplate) }
  }
  return undefined
}

function projectTemplate(value: unknown): Record<string, unknown>[] {
  const item = record(value)
  if (item === undefined) return []
  const projected: Record<string, unknown> = {}
  for (const field of PPT_TEMPLATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item, field)) projected[field] = item[field]
  }
  return [projected]
}

function projectRecord(value: unknown): unknown[] {
  const entry = record(value)
  if (entry === undefined) return []
  const nested = record(entry.event)
  const event = projectEvent(nested ?? entry)
  if (event === undefined) return []
  if (nested !== undefined) return [{ event }]
  return [event]
}

function projectEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const type = event.type
  if (type === 'turn/start') return copyFields(event, ['type', 'time'])
  if (type === 'turn/end') {
    const data = record(event.data)
    const projected = copyFields(event, ['type', 'time'])
    const reason = projectTurnReason(data?.reason)
    if (reason !== undefined) projected.data = { reason }
    return projected
  }
  if (type === 'user/message') return projectUserMessage(event)
  if (type === 'developer/message') return projectDeveloperMessage(event)
  if (type === 'assistant/chunk') return projectAssistantChunk(event)
  if (type === 'assistant/message') return projectAssistantMessage(event)
  if (type === 'tool/call') return projectToolCall(event)
  if (type === 'tool/result') return projectToolResult(event)
  if (type === 'deliverables/presented') return projectPresented(event)
  if (type === 'workspace/changes') return projectWorkspaceChanges(event)
  return undefined
}

function projectLiveToolDelta(
  body: Record<string, unknown>,
  turn: LiveAssistantCursor
): Record<string, unknown> | undefined {
  const chunk = record(body.chunk)
  if (chunk === undefined || chunk.type !== 'tool-call-delta') return undefined
  if (typeof turn.turn !== 'number' || typeof turn.step !== 'number') return undefined
  const index = typeof chunk.index === 'number' ? String(chunk.index) : '0'
  const tools = turn.tools ?? {}
  turn.tools = tools
  const existing = tools[index]
  const slot = existing ?? { args: '' }
  tools[index] = slot
  if (typeof chunk.name === 'string' && chunk.name.length > 0) slot.name = chunk.name
  if (typeof chunk.argumentsDelta === 'string' && slot.args.length < TOOL_ARGUMENT_CAP) {
    slot.args += chunk.argumentsDelta.slice(0, TOOL_ARGUMENT_CAP - slot.args.length)
  }
  if (slot.name === undefined) return undefined
  const detail = toolDetail(slot.args)
  const asks = projectQuestionAsks(slot.name, slot.args)
  const signature = `${slot.name}\n${detail}\n${asks.map((item) => typeof item.question === 'string' ? item.question : '').join('\n')}`
  if (slot.sent === signature) return undefined
  slot.sent = signature
  const data: Record<string, unknown> = {
    turn: turn.turn,
    step: turn.step,
    phase: 'preparing',
    activity: toolActivity(slot.name),
    name: slot.name
  }
  if (typeof chunk.id === 'string' && chunk.id.length > 0) data.callId = chunk.id
  if (detail.length > 0) data.detail = detail
  if (asks.length > 0) data.asks = asks
  return {
    type: 'event',
    event: {
      type: 'tool/status',
      ...(typeof body.time === 'number' ? { time: body.time } : {}),
      data
    }
  }
}

function projectToolCall(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  const name = typeof data?.name === 'string' ? data.name : ''
  if (name.length === 0) return undefined
  const projected = copyFields(event, ['type', 'time'])
  projected.type = 'tool/status'
  const next: Record<string, unknown> = {
    phase: 'calling',
    activity: toolActivity(name),
    name
  }
  if (typeof data?.callId === 'string' && data.callId.length > 0) next.callId = data.callId
  const detail = toolDetail(data?.arguments)
  if (detail.length > 0) next.detail = detail
  const asks = projectQuestionAsks(name, data?.arguments)
  if (asks.length > 0) next.asks = asks
  copyOwn(next, data, ['turn', 'step'])
  projected.data = next
  return projected
}

function projectToolResult(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  const message = record(data?.message)
  const source = record(message?.source)
  const callId = typeof source?.callId === 'string' && source.callId.length > 0
    ? source.callId
    : typeof message?.toolCallId === 'string' && message.toolCallId.length > 0
      ? message.toolCallId
      : undefined
  if (callId === undefined) return undefined
  const projected = copyFields(event, ['type', 'time'])
  projected.type = 'tool/status'
  const next: Record<string, unknown> = { phase: 'done', callId }
  const asks = projectQuestionAnswers(message)
  if (asks.length > 0) next.asks = asks
  copyOwn(next, data, ['turn', 'step'])
  projected.data = next
  return projected
}

function projectPresented(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  const files = presentedFiles(data.files)
  if (files.length === 0) return undefined
  const projected = copyFields(event, ['type', 'time'])
  const seq = safeSeq(event.seq)
  if (seq !== undefined) projected.seq = seq
  const next: Record<string, unknown> = { files }
  copyOwn(next, data, ['turn', 'step'])
  if (typeof data.callId === 'string' && data.callId.length > 0) next.callId = data.callId
  projected.data = next
  return projected
}

function projectWorkspaceChanges(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  const seq = safeSeq(event.seq)
  const turn = data?.turn
  if (seq === undefined || typeof turn !== 'number' || !Number.isSafeInteger(turn)) return undefined
  const projected = copyFields(event, ['type', 'time'])
  projected.seq = seq
  projected.data = { turn }
  return projected
}

/** Change summary the phone can draw. Diff hunks and unreadable files stay behind. */
export function projectChangesSummary(value: unknown): Record<string, unknown> | undefined {
  const body = record(value)
  if (body === undefined) return undefined
  const files = Array.isArray(body.files) ? body.files.flatMap(projectChangedFile) : []
  const projected: Record<string, unknown> = { files }
  for (const field of ['turn', 'total', 'added', 'deleted'] as const) {
    const value = body[field]
    if (typeof value === 'number' && Number.isFinite(value)) projected[field] = value
  }
  return projected
}

function projectChangedFile(value: unknown): Record<string, unknown>[] {
  const row = record(value)
  if (row === undefined || typeof row.path !== 'string' || row.path.trim().length === 0) return []
  const file: Record<string, unknown> = { path: row.path }
  if (typeof row.display === 'string') file.display = row.display
  if (typeof row.added === 'number') file.added = row.added
  if (typeof row.deleted === 'number') file.deleted = row.deleted
  if (row.binary === true) file.binary = true
  if (row.oversized === true) file.oversized = true
  return [file]
}

function presentedFiles(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = record(item)
    if (row === undefined || typeof row.path !== 'string' || row.path.trim().length === 0) return []
    const file: Record<string, unknown> = { path: row.path }
    if (typeof row.description === 'string') file.description = row.description
    return [file]
  })
}

const ASK_LIMIT = 8
const ASK_TEXT_CAP = 240

/**
 * Question prompts the desktop draws inside the process group.
 * Option descriptions and every other argument stay on the desktop.
 */
function projectQuestionAsks(name: string, value: unknown): Record<string, unknown>[] {
  if (name !== 'ask_user_question' && name !== 'request_user_input') return []
  const body = argumentsRecord(value)
  const questions = body?.questions
  if (!Array.isArray(questions)) return []
  const asks: Record<string, unknown>[] = []
  for (const item of questions) {
    if (asks.length >= ASK_LIMIT) break
    const row = record(item)
    const question = clipAsk(row?.question)
    if (row === undefined || question.length === 0) continue
    const ask: Record<string, unknown> = { question }
    const id = clipAsk(row.id, 80)
    if (id.length > 0) ask.id = id
    const header = clipAsk(row.header, 80)
    if (header.length > 0 && header !== question) ask.header = header
    asks.push(ask)
  }
  return asks
}

/**
 * Submitted answers for a question call. A skipped question keeps an empty
 * answer so the phone can count it. Any other tool body is left behind.
 */
function projectQuestionAnswers(message: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const payload = answerPayload(message?.content)
  const answers = payload?.answers
  if (!Array.isArray(answers)) return []
  const asks: Record<string, unknown>[] = []
  for (const item of answers) {
    if (asks.length >= ASK_LIMIT) break
    const row = record(item)
    const id = clipAsk(row?.id, 80)
    if (row === undefined || id.length === 0 || !Array.isArray(row.selected)) continue
    const selected = row.selected.flatMap((part) => {
      const text = clipAsk(part)
      return text.length > 0 ? [text] : []
    })
    const custom = clipAsk(row.custom)
    const answer = custom.length > 0 ? custom : selected.join('、')
    asks.push({ id, answer })
  }
  return asks
}

function argumentsRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.startsWith('{')) return undefined
    try {
      return record(JSON.parse(trimmed) as unknown)
    } catch {
      return undefined
    }
  }
  return record(value)
}

function answerPayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') return argumentsRecord(value)
  if (Array.isArray(value)) {
    const text = value.flatMap((item) => {
      const block = record(item)
      return typeof block?.text === 'string' ? [block.text] : []
    }).join('')
    return argumentsRecord(text)
  }
  return record(value)
}

function clipAsk(value: unknown, cap = ASK_TEXT_CAP): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  const chars = [...normalized]
  if (chars.length <= cap) return normalized
  return `${chars.slice(0, cap - 1).join('').trimEnd()}…`
}

function toolActivity(name: string): string {
  if (name === 'read') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (name === 'bash' || name === 'pwsh' || name === 'exec_command' || name === 'write_stdin' || name.startsWith('terminal_')) {
    return 'commands'
  }
  if (name === 'run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (name === 'todo_write' || name === 'create_goal' || name === 'update_goal' || name === 'get_goal') return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  return 'tools'
}

function toolDetail(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        const fromParsed = detailFromValue(parsed)
        if (fromParsed.length > 0) return fromParsed
      } catch {
        return detailFromPartial(trimmed)
      }
    }
    return ''
  }
  return detailFromValue(value)
}

function detailFromValue(value: unknown): string {
  const row = record(value)
  if (row !== undefined) {
    for (const key of TOOL_DETAIL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue
      const text = detailText(row[key])
      if (text.length > 0) return clipDetail(text)
    }
    return ''
  }
  return detailText(value)
}

function detailText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ')
  return ''
}

function detailFromPartial(raw: string): string {
  for (const key of TOOL_DETAIL_KEYS) {
    const marker = `"${key}"`
    const at = raw.indexOf(marker)
    if (at < 0) continue
    let cursor = at + marker.length
    while (cursor < raw.length && raw[cursor] !== undefined && /\s/.test(raw[cursor]!)) cursor += 1
    if (raw[cursor] !== ':') continue
    cursor += 1
    while (cursor < raw.length && raw[cursor] !== undefined && /\s/.test(raw[cursor]!)) cursor += 1
    if (raw[cursor] !== '"') continue
    cursor += 1
    let value = ''
    while (cursor < raw.length) {
      const char = raw[cursor]
      if (char === undefined) break
      if (char === '\\') {
        const next = raw[cursor + 1]
        if (next === undefined) break
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next
        cursor += 2
        continue
      }
      if (char === '"') break
      value += char
      cursor += 1
      if (value.length > 200) break
    }
    const text = clipDetail(value)
    if (text.length > 0) return text
  }
  return ''
}

function clipDetail(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const chars = [...normalized]
  if (chars.length <= 160) return normalized
  return `${chars.slice(0, 159).join('').trimEnd()}…`
}

function safeSeq(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Kind plus the failure text. Request ids and provider status stay on the desktop. */
function projectTurnReason(value: unknown): Record<string, unknown> | string | undefined {
  if (typeof value === 'string') {
    const kind = value.trim()
    return kind.length === 0 ? undefined : kind
  }
  const reason = record(value)
  if (reason === undefined) return undefined
  const next: Record<string, unknown> = {}
  if (typeof reason.kind === 'string' && reason.kind.trim().length > 0) next.kind = reason.kind.trim()
  const error = record(reason.error)
  const message = clipFailure(error?.message ?? reason.message, 300)
  const code = clipFailure(error?.code ?? reason.code, 80)
  if (message !== undefined) next.message = message
  if (code !== undefined) next.code = code
  return Object.keys(next).length === 0 ? undefined : next
}

function clipFailure(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  return text.length <= cap ? text : text.slice(0, cap)
}

function projectUserMessage(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  if (!humanUser(data)) return projectContextStatus(event, data)

  const projected = copyFields(event, ['type', 'time'])
  const next: Record<string, unknown> = {}
  const message = record(data.message)
  const source = record(message?.source) ?? record(data.source)
  if (source !== undefined) {
    if (message !== undefined && record(message.source) !== undefined) {
      next.message = { source, ...textContent(message.content) }
    } else {
      next.source = source
    }
  }
  if (message === undefined || record(message.source) === undefined) {
    Object.assign(next, textContent(message?.content ?? data.content))
  }
  projected.data = next
  return projected
}

function projectAssistantChunk(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  const chunk = record(data?.chunk)
  if (chunk === undefined || (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta')) {
    return undefined
  }
  const projected = copyFields(event, ['type', 'time'])
  const fields = chunk.type === 'reasoning-delta' ? ['type', 'text', 'delta', 'index'] : ['type', 'text', 'delta']
  const next: Record<string, unknown> = {
    chunk: copyFields(chunk, fields)
  }
  copyOwn(next, data, ['turn', 'step'])
  projected.data = next
  return projected
}

function projectAssistantMessage(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  const projected = copyFields(event, ['type', 'time'])
  const next: Record<string, unknown> = {}
  copyOwn(next, data, ['turn', 'step'])
  const message = record(data.message)
  if (message !== undefined) {
    next.message = messageContent(message.content)
  } else if (Object.prototype.hasOwnProperty.call(data, 'content')) {
    Object.assign(next, messageContent(data.content))
  }
  const usage = projectUsage(data.usage)
  if (usage !== undefined) next.usage = usage
  const stream = projectUsageStream(data.stream)
  if (stream !== undefined) next.stream = stream
  projected.data = next
  return projected
}

/**
 * Context the desktop shows as a collapsed row. The body stays on the desktop:
 * the phone only needs the producer kind, or a tool-list change count.
 */
function projectContextStatus(
  event: Record<string, unknown>,
  data: Record<string, unknown>
): Record<string, unknown> | undefined {
  const message = record(data.message)
  const source = record(message?.source) ?? record(data.source)
  const kind = typeof source?.kind === 'string' ? source.kind.trim() : ''
  if (kind.length === 0 || kind === 'user') return undefined
  const projected = copyFields(event, ['type', 'time'])
  projected.type = 'context/status'
  const next: Record<string, unknown> = { kind }
  copyOwn(next, data, ['turn', 'step'])
  projected.data = next
  return projected
}

function projectDeveloperMessage(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  const message = record(data.message) ?? data
  const content = message.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  let added = 0
  let removed = 0
  for (const item of content) {
    const block = record(item)
    if (block?.type === 'tool-addition') added += 1
    else if (block?.type === 'tool-removal') removed += 1
    else return undefined
  }
  if (added === 0 && removed === 0) return undefined
  const projected = copyFields(event, ['type', 'time'])
  projected.type = 'context/status'
  const next: Record<string, unknown> = { kind: 'tools', added, removed }
  copyOwn(next, data, ['turn', 'step'])
  projected.data = next
  return projected
}

function humanUser(data: Record<string, unknown>): boolean {
  const message = record(data.message)
  const source = record(message?.source) ?? record(data.source)
  return source?.kind === 'user'
}

function textContent(content: unknown): Record<string, unknown> {
  return blocksOf(content, ['text'])
}

function messageContent(content: unknown): Record<string, unknown> {
  return blocksOf(content, ['text', 'reasoning'])
}

function blocksOf(content: unknown, types: readonly string[]): Record<string, unknown> {
  if (!Array.isArray(content)) return {}
  const blocks = content.flatMap((item) => {
    const block = record(item)
    if (block === undefined || !types.includes(String(block.type)) || typeof block.text !== 'string') return []
    return [{ type: block.type, text: block.text }]
  })
  return blocks.length === 0 ? {} : { content: blocks }
}

/**
 * A history page is one gateway frame. Reasoning on older turns is what pushes
 * it over the cap, so only the latest turns keep it. The answer text stays.
 */
function keepRecentReasoning(events: unknown[]): unknown[] {
  let turns = 0
  for (const item of events) {
    if (projectedType(item) === 'turn/start') turns += 1
  }
  if (turns <= RECENT_REASONING_TURNS) return events
  const firstKept = turns - RECENT_REASONING_TURNS + 1
  let turn = 0
  const kept: unknown[] = []
  for (const item of events) {
    if (projectedType(item) === 'turn/start') turn += 1
    if (turn >= firstKept) {
      kept.push(item)
      continue
    }
    const stripped = stripReasoning(item)
    if (stripped !== undefined) kept.push(stripped)
  }
  return kept
}

function projectedType(item: unknown): string | undefined {
  const event = projectedEvent(item)
  return typeof event?.type === 'string' ? event.type : undefined
}

function projectedEvent(item: unknown): Record<string, unknown> | undefined {
  const entry = record(item)
  if (entry === undefined) return undefined
  return record(entry.event) ?? entry
}

function stripReasoning(item: unknown): unknown | undefined {
  const entry = record(item)
  const event = projectedEvent(item)
  if (entry === undefined || event === undefined) return item
  if (event.type === 'assistant/chunk') {
    const chunk = record(record(event.data)?.chunk)
    return chunk?.type === 'reasoning-delta' ? undefined : item
  }
  if (event.type !== 'assistant/message') return item
  const data = record(event.data)
  if (data === undefined) return item
  const nextData: Record<string, unknown> = { ...data }
  const message = record(data.message)
  if (message !== undefined) {
    nextData.message = withoutReasoning(message)
  } else if (Array.isArray(data.content)) {
    const blocks = data.content.filter((block) => record(block)?.type !== 'reasoning')
    if (blocks.length === 0) delete nextData.content
    else nextData.content = blocks
  }
  const nextEvent: Record<string, unknown> = { ...event, data: nextData }
  return record(entry.event) !== undefined ? { ...entry, event: nextEvent } : nextEvent
}

function withoutReasoning(message: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(message.content)) return message
  const blocks = message.content.filter((block) => record(block)?.type !== 'reasoning')
  const next: Record<string, unknown> = { ...message }
  if (blocks.length === 0) delete next.content
  else next.content = blocks
  return next
}

function projectUsage(value: unknown): Record<string, unknown> | undefined {
  const usage = record(value)
  if (usage === undefined) return undefined
  const projected: Record<string, unknown> = {}
  for (const field of USAGE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(usage, field)) projected[field] = usage[field]
  }
  return projected
}

function projectUsageStream(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.flatMap((item) => {
    const entry = record(item)
    if (entry?.type !== 'chunk') return []
    const chunk = record(entry.chunk)
    if (chunk?.type !== 'usage') return []
    const usage = projectUsage(chunk.usage)
    if (usage === undefined) return []
    return [{ type: 'chunk', chunk: { type: 'usage', usage } }]
  })
  return kept.length === 0 ? undefined : kept
}

function copyFields(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  copyOwn(projected, source, fields)
  return projected
}

function copyOwn(target: Record<string, unknown>, source: Record<string, unknown> | undefined, fields: string[]): void {
  if (source === undefined) return
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field]
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
