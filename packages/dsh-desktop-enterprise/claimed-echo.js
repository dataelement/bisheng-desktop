// One claim splice can remove several messages, but a conversation match
// returns a single id. The view node therefore uses the splice seq and
// renders every recovered user message. The claim event does not carry
// those bodies; they are still on the previous inbox pending chain.
// A later logged user/message with the same id or rpcId hides the echo.
// A desktop composer submission already paints its own bubble, so an echo
// whose rpcId is one of those request ids stays hidden.
// This module never writes the session log.

export function materializePending(pending) {
  if (pending == null || typeof pending !== 'object') return []
  const splices = []
  let current = pending
  while (current && current.kind === 'splice') {
    splices.push(current)
    current = current.previous
  }
  const messages = Array.isArray(current?.ids) ? [...current.ids] : []
  for (const splice of splices.reverse()) {
    const start = Number.isInteger(splice.start) ? splice.start : 0
    const removed = Number.isInteger(splice.removedCount) ? splice.removedCount : 0
    const inserted = Array.isArray(splice.inserted) ? splice.inserted : []
    messages.splice(start, removed, ...inserted)
  }
  return messages
}

export function claimedUserMessages(priorPending, splice) {
  if (splice == null || typeof splice !== 'object') return []
  const removed = splice.removedCount ?? 0
  if (!(removed > 0) || splice.outcome === 'canceled') return []
  const start = Number.isInteger(splice.start) ? splice.start : 0
  const pending = materializePending(priorPending)
  const taken = pending.slice(start, start + removed)
  const messages = []
  for (const message of taken) {
    if (message == null || typeof message !== 'object') continue
    if (message.source?.kind !== 'user') continue
    const text = messageText(message.content)
    if (text === '') continue
    messages.push(claimedEchoRow(message.id, message.source?.rpcId, text))
  }
  return messages
}

export function loggedUserIds(entries) {
  const ids = new Set()
  for (const logged of loggedUserMessages(entries)) {
    if (logged.id !== undefined) ids.add(logged.id)
  }
  return ids
}

export function visibleClaimedMessages(messages, entries, options) {
  if (!Array.isArray(messages)) return []
  const loggedIds = new Set()
  const loggedRpcIds = new Set()
  for (const logged of loggedUserMessages(entries)) {
    if (logged.id !== undefined) loggedIds.add(logged.id)
    if (logged.rpcId !== undefined) loggedRpcIds.add(logged.rpcId)
  }
  const extra = options?.matches
  if (Array.isArray(extra)) {
    for (const match of extra) {
      if (match == null || typeof match !== 'object') continue
      const id = presentId(match.id)
      const rpcId = presentId(match.rpcId)
      if (id !== undefined) loggedIds.add(id)
      if (rpcId !== undefined) loggedRpcIds.add(rpcId)
    }
  }
  const localRequestIds = new Set()
  collectRequestIds(localRequestIds, options?.localRequestIds)
  return messages.filter((message) => {
    if (message == null || typeof message.text !== 'string' || message.text === '') return false
    const id = presentId(message.id)
    const rpcId = presentId(message.rpcId)
    if (id === undefined && rpcId === undefined) return false
    if (rpcId !== undefined && localRequestIds.has(rpcId)) return false
    if (id !== undefined && loggedIds.has(id)) return false
    if (rpcId !== undefined && loggedRpcIds.has(rpcId)) return false
    return true
  })
}

function claimedEchoRow(id, rpcId, text) {
  const row = { text }
  const present = presentId(id)
  const requestId = presentId(rpcId)
  if (present !== undefined) row.id = present
  if (requestId !== undefined) row.rpcId = requestId
  return row
}

function loggedUserMessages(entries) {
  if (!Array.isArray(entries)) return []
  const logged = []
  for (const entry of entries) {
    const event = entry?.event ?? entry
    if (event == null || event.type !== 'user/message') continue
    const data = event.data
    if (data == null || typeof data !== 'object') continue
    const message = data.message != null && typeof data.message === 'object' ? data.message : data
    const source = message.source ?? data.source
    if (source?.kind !== 'user') continue
    logged.push({ id: presentId(message.id ?? data.id), rpcId: presentId(source.rpcId) })
  }
  return logged
}

function collectRequestIds(target, values) {
  if (values == null || typeof values === 'string' || typeof values[Symbol.iterator] !== 'function') return
  for (const id of values) {
    const requestId = presentId(id)
    if (requestId !== undefined) target.add(requestId)
  }
}

function presentId(value) {
  if (value == null || value === '') return undefined
  const id = String(value)
  return id === '' ? undefined : id
}

function messageText(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block === 'string') text += block
    else if (block != null && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text.trim()
}
