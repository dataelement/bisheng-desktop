// One claim splice can remove several messages, but a conversation match
// returns a single id. The view node therefore uses the splice seq and
// renders every recovered user message. The claim event does not carry
// those bodies; they are still on the previous inbox pending chain.
// A later logged user/message with the same id hides the echo.
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
    const id = message.id == null || message.id === '' ? undefined : String(message.id)
    messages.push({ id, text })
  }
  return messages
}

export function loggedUserIds(entries) {
  const ids = new Set()
  if (!Array.isArray(entries)) return ids
  for (const entry of entries) {
    const event = entry?.event ?? entry
    if (event == null || event.type !== 'user/message') continue
    const data = event.data
    if (data == null || typeof data !== 'object') continue
    const message = data.message != null && typeof data.message === 'object' ? data.message : data
    const source = message.source ?? data.source
    if (source?.kind !== 'user') continue
    const id = message.id ?? data.id
    if (id == null || id === '') continue
    ids.add(String(id))
  }
  return ids
}

export function visibleClaimedMessages(messages, entries) {
  if (!Array.isArray(messages)) return []
  const logged = loggedUserIds(entries)
  return messages.filter((message) => {
    if (message == null || typeof message.text !== 'string' || message.text === '') return false
    if (message.id == null || message.id === '') return true
    return !logged.has(String(message.id))
  })
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
