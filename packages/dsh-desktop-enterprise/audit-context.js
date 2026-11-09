// Only producer identifiers are retained; provenance never changes model business data.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9]/u.test(value) && !/[^A-Za-z0-9._:/-]/u.test(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && [...value].length <= 256 && Buffer.from(value).toString('utf8') === value

export function normalizeMessageSources(raw, messageCount) {
  if (!object(raw) || !Array.isArray(raw.items) || typeof raw.truncated !== 'boolean') return undefined
  let truncated = raw.truncated || raw.items.length > 128
  const items = [], seen = new Set(), duplicates = new Set()
  for (const item of raw.items.slice(0, 128)) {
    const index = item?.message_index
    if (!object(item) || !Number.isSafeInteger(index) || index < 0 || (messageCount !== undefined && index >= messageCount)) { truncated = true; continue }
    if (seen.has(index)) { duplicates.add(index); truncated = true; continue }
    seen.add(index)
    if (!Array.isArray(item.sources) || !item.sources.length) { truncated = true; continue }
    truncated ||= item.sources.length > 4
    const sources = []
    for (const source of item.sources.slice(0, 4)) {
      if (!object(source) || !identifier(source.kind, 64)) { truncated = true; continue }
      const value = { kind: source.kind }
      if ('form' in source) {
        if (identifier(source.form, 32)) value.form = source.form
        else truncated = true
      }
      if (!sources.some(existing => existing.kind === value.kind && existing.form === value.form)) sources.push(value)
    }
    if (sources.length) items.push({ message_index: index, sources })
  }
  const accepted = []
  for (const item of items.filter(item => !duplicates.has(item.message_index)).sort((a, b) => a.message_index - b.message_index)) {
    if (Buffer.byteLength(JSON.stringify({ items: [...accepted, item], truncated: true }), 'utf8') > 12288) { truncated = true; break }
    accepted.push(item)
  }
  if (!accepted.length && raw.items.length && !raw.truncated) return undefined
  return { items: accepted, truncated }
}

export function normalizeAuditContext(value, allowedFields = [], messageCount) {
  if (!object(value)) return undefined
  const context = {}
  for (const key of ['conversation_id', 'parent_conversation_id']) {
    if (allowedFields.includes(key) && validId(value[key])) context[key] = value[key]
  }
  if (allowedFields.includes('request_kind') && ['chat', 'compaction', 'session-title'].includes(value.request_kind)) context.request_kind = value.request_kind
  if (allowedFields.includes('session_origin') && ['main', 'subagent'].includes(value.session_origin)) context.session_origin = value.session_origin
  if (!context.conversation_id || context.session_origin !== 'subagent' || context.parent_conversation_id === context.conversation_id) delete context.parent_conversation_id
  if (allowedFields.includes('message_sources')) {
    const sources = normalizeMessageSources(value.message_sources, messageCount)
    if (sources) context.message_sources = sources
  }
  return Object.keys(context).length ? context : undefined
}
