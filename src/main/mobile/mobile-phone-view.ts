/**
 * Fields the phone actually renders. The full PPT state and session page carry
 * preview images, tool results, and reasoning that a single gateway frame cannot
 * hold and that the phone parser ignores.
 */

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
  return {
    events: raw === undefined ? [] : raw.flatMap(projectRecord),
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
      records: records.flatMap(projectRecord),
      hasMore: body.hasMore === true
    }
  }
  if (body.type !== 'event') return undefined
  const projected = projectRecord(body.event)
  const event = projected[0]
  if (event === undefined) return undefined
  return { type: 'event', event }
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
  if (chunk?.type !== 'text-delta') return undefined
  const projected = copyFields(event, ['type', 'time'])
  const next: Record<string, unknown> = {
    chunk: copyFields(chunk, ['type', 'text', 'delta'])
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
    next.message = textContent(message.content)
  } else if (Object.prototype.hasOwnProperty.call(data, 'content')) {
    Object.assign(next, textContent(data.content))
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
  if (!Array.isArray(content)) return {}
  const blocks = content.flatMap((item) => {
    const block = record(item)
    if (block?.type !== 'text' || typeof block.text !== 'string') return []
    return [{ type: 'text', text: block.text }]
  })
  return blocks.length === 0 ? {} : { content: blocks }
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
