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
 * later chunk does not repeat it. Tool deltas stay out.
 */
export function projectLiveAssistantFrame(
  frame: unknown,
  turn: { turn?: number; step?: number }
): Record<string, unknown> | undefined {
  const body = record(frame)
  if (body === undefined) return undefined
  if (body.type === 'start') {
    if (typeof body.turn === 'number') turn.turn = body.turn
    if (typeof body.step === 'number') turn.step = body.step
    return undefined
  }
  if (body.type !== 'chunk') return undefined
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
    if (data !== undefined && Object.prototype.hasOwnProperty.call(data, 'reason')) {
      projected.data = { reason: data.reason }
    }
    return projected
  }
  if (type === 'user/message') return projectUserMessage(event)
  if (type === 'assistant/chunk') return projectAssistantChunk(event)
  if (type === 'assistant/message') return projectAssistantMessage(event)
  return undefined
}

function projectUserMessage(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = record(event.data)
  if (data === undefined || !humanUser(data)) return undefined
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
