const CATEGORIES = Object.freeze([
  'task-result',
  'instruction-following',
  'product-interaction',
  'service-stability',
  'resource-cost',
  'security-privacy-permission',
  'other'
])

/** Validate one current rating. The conversation log is intentionally not part of this payload. */
export function parseAuditFeedbackUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audit feedback update.')
  const allowed = ['category', 'conversation_id', 'event_seq', 'message_id', 'note', 'op', 'rating']
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid audit feedback update.')
  const { conversation_id: id, message_id: messageId, event_seq: seq, op, rating, category, note } = value
  const validUnicode = (text) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)
  const plainId = (text) => typeof text === 'string' && [...text].length >= 1 && [...text].length <= 256 &&
    validUnicode(text) && !/[\u0000-\u001f\u007f]/u.test(text)
  if (!plainId(id) || !plainId(messageId) || !Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('Invalid audit feedback update.')
  }
  const update = { conversation_id: id, message_id: messageId, event_seq: seq, op }
  if (op === 'delete') {
    if (rating !== undefined || category !== undefined || note !== undefined) throw new Error('Invalid audit feedback update.')
  } else if (op === 'put') {
    if (rating !== 'positive' && rating !== 'negative') throw new Error('Invalid audit feedback update.')
    update.rating = rating
    if (category !== undefined) {
      if (!CATEGORIES.includes(category)) throw new Error('Invalid audit feedback update.')
      update.category = category
    }
    if (note !== undefined) {
      if (typeof note !== 'string' || !note.trim() || !validUnicode(note) ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note) || Buffer.byteLength(note, 'utf8') > 8192) {
        throw new Error('Invalid audit feedback update.')
      }
      update.note = note
    }
  } else {
    throw new Error('Invalid audit feedback update.')
  }
  if (Buffer.byteLength(JSON.stringify(update), 'utf8') > 16384) throw new Error('Invalid audit feedback update.')
  return update
}

/** Best-effort forwarder for ratings on sessions that already called the enterprise model adapter. */
export function createAuditFeedbackSync({ ctx, send, note = () => {} }) {
  const pending = new Map()
  const registered = new Map()
  const acknowledged = new Map()
  const delays = [1000, 3000, 10000, 30000, 60000, 120000]
  let identity = ''
  let state
  let generation = 0
  let timer
  let running
  let disposed = false

  // Routing metadata only. Notes, ratings text and credentials stay out of diagnostics.
  const diagnose = (reason, update, details = {}) => note(reason, {
    conversation_id: update.conversation_id,
    ...(update.message_id === undefined ? {} : { message_id: update.message_id }),
    ...(update.event_seq === undefined ? {} : { event_seq: update.event_seq }),
    ...details
  })
  const touch = (map, key, value) => {
    map.delete(key)
    map.set(key, value)
    if (map.size > 512) map.delete(map.keys().next().value)
  }
  const keyOf = (update) => `${update.conversation_id}\u0000${update.message_id}`
  const reset = () => {
    generation++
    clearTimeout(timer)
    timer = undefined
    running?.abort()
    pending.clear()
    registered.clear()
    acknowledged.clear()
  }
  const schedule = () => {
    clearTimeout(timer)
    if (running || !pending.size || disposed || !identity) return
    const next = Math.min(...[...pending.values()].map(item => item.due))
    timer = setTimeout(() => { void drain() }, Math.max(0, next - Date.now()))
    timer.unref?.()
  }
  const enqueue = (update) => {
    if (!identity || disposed) return
    try { update = parseAuditFeedbackUpdate(update) } catch { note('invalid_update'); return }
    const key = keyOf(update)
    const old = pending.get(key)
    const ack = acknowledged.get(key)
    if ((ack && ack.event_seq >= update.event_seq) || (old && old.update.event_seq >= update.event_seq)) return
    const cost = Buffer.byteLength(JSON.stringify(update), 'utf8')
    const bytes = [...pending.values()].reduce((sum, item) => sum + item.cost, 0) - (old?.cost ?? 0)
    if ((!old && pending.size >= 128) || bytes + cost > 512 * 1024) { diagnose('capacity', update); return }
    pending.set(key, { update, cost, attempts: 0, created: Date.now(), due: Date.now() + 500 })
    schedule()
  }
  const drain = async () => {
    const current = generation
    const item = [...pending.values()].find(value => value.due <= Date.now())
    if (!item || !identity || disposed) { schedule(); return }
    const key = keyOf(item.update)
    if (Date.now() - item.created >= 300000) {
      pending.delete(key)
      diagnose('expired', item.update, { attempts: item.attempts })
      schedule()
      return
    }
    const controller = new AbortController()
    running = controller
    const timeout = setTimeout(() => controller.abort(), 5000)
    let retry = false
    let failure
    const attempt = item.attempts + 1
    try {
      const result = await send({
        connectionKey: state.connectionKey,
        auditFeedbackEpoch: state.auditFeedbackEpoch,
        update: item.update
      }, controller.signal)
      if (current !== generation) return
      retry = result?.status === 'NOT_READY'
      if (retry) failure = { result: 'NOT_READY' }
      if (['UPDATED', 'UNCHANGED'].includes(result?.status) && result.event_seq === item.update.event_seq) {
        touch(acknowledged, key, item.update)
      } else if (['STALE', 'CONFLICT', 'DISABLED'].includes(result?.status)) {
        diagnose('not_applied', item.update, { attempt, result: result.status })
      } else if (!retry) {
        diagnose('invalid_response', item.update, { attempt })
      }
    } catch (error) {
      if (current !== generation) return
      const status = error?.status
      retry = !status || status === 429 || status >= 500
      failure = {
        failure_kind: controller.signal.aborted ? 'timeout' : 'request_failed',
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { http_status: status } : {})
      }
      if (!retry) diagnose('rejected', item.update, { attempt, ...failure })
    } finally {
      clearTimeout(timeout)
      if (running === controller) running = undefined
      if (current === generation && pending.get(key) === item) {
        if (retry && item.attempts < delays.length && Date.now() - item.created < 300000) {
          const delay = delays[item.attempts++]
          item.due = Date.now() + delay
          diagnose('retry', item.update, { attempt, ...failure, retry_in_ms: delay })
        } else {
          pending.delete(key)
          if (retry) diagnose('exhausted', item.update, { attempt, ...failure })
        }
      }
      schedule()
    }
  }
  const disposeListener = ctx.on?.('session/event', (session, event) => {
    const id = session?.header?.id
    if (!identity || !registered.has(id) || event?.data?.sessionId !== id) return
    if (event.type === 'feedback/message-put') {
      const item = event.data?.item
      enqueue({
        conversation_id: id,
        message_id: item?.messageId,
        event_seq: event.seq,
        op: 'put',
        rating: item?.rating,
        ...(item?.category === undefined ? {} : { category: item.category }),
        ...(item?.note === undefined ? {} : { note: item.note })
      })
    } else if (event.type === 'feedback/message-delete') {
      enqueue({ conversation_id: id, message_id: event.data?.messageId, event_seq: event.seq, op: 'delete' })
    }
  }, { global: true })
  return {
    ingest(next) {
      const key = next?.connected && next.audit_message_feedback?.version === 1 &&
        typeof next.connectionKey === 'string' && Number.isSafeInteger(next.auditFeedbackEpoch)
        ? `${next.connectionKey}:${next.auditFeedbackEpoch}` : ''
      if (key !== identity) { reset(); identity = key }
      state = next
      schedule()
    },
    track(id) {
      // Ratings are observed after the model call starts, so no historical snapshot is required.
      if (!identity || disposed || typeof id !== 'string' || [...id].length > 256) return
      touch(registered, id, true)
    },
    dispose() {
      disposed = true
      reset()
      if (typeof disposeListener === 'function') disposeListener()
    }
  }
}
