const CATEGORIES = Object.freeze([
  'task-result',
  'instruction-following',
  'product-interaction',
  'service-stability',
  'resource-cost',
  'security-privacy-permission',
  'other'
])
const RETRY_DELAYS = [1000, 3000, 10000, 30000, 60000, 120000]
const PENDING_TTL_MS = 300000
const INITIAL_DELAY_MS = 500

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

/** Copy the fields an upload is allowed to carry. Callers must not keep the log object. */
function feedbackUpdateFromEvent(conversationId, event) {
  if (!event || event.data?.sessionId !== conversationId || !Number.isSafeInteger(event.seq)) return undefined
  if (event.type === 'feedback/message-delete') {
    return {
      conversation_id: conversationId,
      message_id: event.data?.messageId,
      event_seq: event.seq,
      op: 'delete'
    }
  }
  if (event.type !== 'feedback/message-put') return undefined
  const item = event.data?.item
  return {
    conversation_id: conversationId,
    message_id: item?.messageId,
    event_seq: event.seq,
    op: 'put',
    rating: item?.rating,
    ...(item?.category === undefined ? {} : { category: item.category }),
    ...(item?.note === undefined ? {} : { note: item.note })
  }
}

/**
 * Best-effort, in-memory forwarder for ratings on sessions that called the enterprise model adapter.
 * Connection identity and send capability are separate: a missing capability pauses uploads,
 * and only a real connection or epoch change drops queued ratings. A delete is a tombstone,
 * not an empty current list. Restart recovery and per-message account attribution are out of scope.
 */
export function createAuditFeedbackSync({ ctx, send, note = () => {}, reread }) {
  const pending = new Map()
  const registered = new Map()
  const acknowledged = new Map()
  const blocked = new Map()
  const reads = new Map()
  let connectionKey = ''
  let verifiedEpoch
  let sendable = false
  let awaitingVerification = false
  let epochInvalid = false
  let generation = 0
  let timer
  let running
  let rereadFlight
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
  const canSend = () => Boolean(connectionKey) && verifiedEpoch !== undefined && sendable && !awaitingVerification && !disposed
  const reset = () => {
    generation++
    clearTimeout(timer)
    timer = undefined
    running?.abort()
    for (const readTimer of reads.values()) clearTimeout(readTimer)
    reads.clear()
    pending.clear()
    registered.clear()
    acknowledged.clear()
    blocked.clear()
    verifiedEpoch = undefined
    sendable = false
    awaitingVerification = false
    epochInvalid = false
  }
  const schedule = () => {
    clearTimeout(timer)
    if (running || !pending.size || !canSend()) return
    const next = Math.min(...[...pending.values()].map(item => item.due))
    timer = setTimeout(() => { void drain() }, Math.max(0, next - Date.now()))
    timer.unref?.()
  }
  const requestReread = () => {
    if (typeof reread !== 'function' || rereadFlight) return rereadFlight
    rereadFlight = Promise.resolve().then(() => reread()).catch(() => {
      note('reread_failed', {})
    }).finally(() => { rereadFlight = undefined })
    return rereadFlight
  }
  const enqueue = (update) => {
    if (!connectionKey || disposed) return
    try { update = parseAuditFeedbackUpdate(update) } catch { note('invalid_update'); return }
    if (!registered.has(update.conversation_id)) return
    const key = keyOf(update)
    const old = pending.get(key)
    const ack = acknowledged.get(key)
    const rejectedSeq = blocked.get(key)
    // Same or older seq is a duplicate or a rejected attempt. A higher seq is a new lifetime.
    if ((rejectedSeq !== undefined && rejectedSeq >= update.event_seq) ||
        (ack && ack.event_seq >= update.event_seq) ||
        (old && old.update.event_seq >= update.event_seq)) return
    const cost = Buffer.byteLength(JSON.stringify(update), 'utf8')
    const bytes = [...pending.values()].reduce((sum, item) => sum + item.cost, 0) - (old?.cost ?? 0)
    if ((!old && pending.size >= 128) || bytes + cost > 512 * 1024) { diagnose('capacity', update); return }
    pending.set(key, { update, cost, attempts: 0, created: Date.now(), due: Date.now() + INITIAL_DELAY_MS })
    schedule()
  }
  const finishItem = (current, key, item, action, failure, attempt) => {
    if (current !== generation || pending.get(key) !== item) return
    if (action === 'ack') {
      touch(acknowledged, key, item.update)
      pending.delete(key)
      return
    }
    const alive = Date.now() - item.created < PENDING_TTL_MS
    if ((action === 'retry' || action === 'verify') && item.attempts < RETRY_DELAYS.length && alive) {
      const delay = RETRY_DELAYS[item.attempts++]
      // A verifying snapshot must not pull due forward to now; the backoff still applies.
      item.due = Date.now() + delay
      diagnose('retry', item.update, { attempt, ...failure, retry_in_ms: delay })
      if (action === 'verify') {
        awaitingVerification = true
        void requestReread()
      }
      return
    }
    pending.delete(key)
    if (action === 'verify') awaitingVerification = false
    if (action === 'retry' || action === 'verify') {
      diagnose('exhausted', item.update, { attempt, ...failure })
    }
  }
  const drain = async () => {
    const current = generation
    const keyAtStart = connectionKey
    const epochAtStart = verifiedEpoch
    const item = [...pending.values()].find(value => value.due <= Date.now())
    if (!item || !canSend()) { schedule(); return }
    const key = keyOf(item.update)
    if (Date.now() - item.created >= PENDING_TTL_MS) {
      pending.delete(key)
      diagnose('expired', item.update, { attempts: item.attempts })
      schedule()
      return
    }
    const controller = new AbortController()
    running = controller
    const timeout = setTimeout(() => controller.abort(), 5000)
    let action = 'drop'
    let failure
    const attempt = item.attempts + 1
    try {
      const result = await send({
        connectionKey: keyAtStart,
        auditFeedbackEpoch: epochAtStart,
        update: item.update
      }, controller.signal)
      if (current !== generation || connectionKey !== keyAtStart || verifiedEpoch !== epochAtStart) return
      if (result?.status === 'NOT_READY') {
        action = 'retry'
        failure = { result: 'NOT_READY' }
      } else if (['UPDATED', 'UNCHANGED'].includes(result?.status) && result.event_seq === item.update.event_seq) {
        action = 'ack'
      } else if (result?.status === 'STALE') {
        // Do not resend this seq. A newer log event, if one is already queued or snapshotted, replaces it.
        touch(blocked, key, item.update.event_seq)
        diagnose('not_applied', item.update, { attempt, result: 'STALE' })
        scheduleSnapshot(item.update.conversation_id)
      } else if (result?.status === 'CONFLICT' || result?.status === 'DISABLED') {
        touch(blocked, key, item.update.event_seq)
        diagnose('not_applied', item.update, { attempt, result: result.status })
      } else {
        diagnose('invalid_response', item.update, { attempt })
      }
    } catch (error) {
      if (current !== generation || connectionKey !== keyAtStart) return
      const status = error?.status
      failure = {
        failure_kind: controller.signal.aborted ? 'timeout' : 'request_failed',
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { http_status: status } : {})
      }
      if (status === 409 && verifiedEpoch === epochAtStart) {
        // The snapshot may still say the capability is on. Wait for a reread, then the existing due time.
        action = 'verify'
      } else if (!status || status === 429 || status >= 500) {
        action = 'retry'
      } else {
        touch(blocked, key, item.update.event_seq)
        diagnose('rejected', item.update, { attempt, ...failure })
      }
    } finally {
      clearTimeout(timeout)
      if (running === controller) running = undefined
      finishItem(current, key, item, action, failure, attempt)
      schedule()
    }
  }
  const scheduleSnapshot = (id) => {
    if (reads.has(id)) return
    if (reads.size >= 512) { diagnose('snapshot_capacity', { conversation_id: id }); return }
    const current = generation
    const keyAtStart = connectionKey
    const epochAtStart = verifiedEpoch
    const readTimer = setTimeout(() => {
      reads.delete(id)
      // First-time epoch verification does not bump generation. An epoch change does, via reset().
      if (current !== generation || disposed || connectionKey !== keyAtStart || !registered.has(id)) return
      if (epochAtStart !== undefined && verifiedEpoch !== epochAtStart) return
      try {
        const session = ctx.get?.('sessions')?.get(id)
        const events = session?.header?.id === id && typeof session.snapshotEvents === 'function'
          ? session.snapshotEvents() : undefined
        if (!Array.isArray(events)) return
        const latest = new Map()
        for (const event of events) {
          if (event?.type !== 'feedback/message-put' && event?.type !== 'feedback/message-delete') continue
          const messageId = event.type === 'feedback/message-delete'
            ? event.data?.messageId
            : event.data?.item?.messageId
          if (typeof messageId === 'string') latest.set(messageId, event)
        }
        for (const event of latest.values()) {
          const update = feedbackUpdateFromEvent(id, event)
          if (update) enqueue(update)
        }
      } catch {
        diagnose('snapshot_unavailable', { conversation_id: id })
      }
    }, 0)
    reads.set(id, readTimer)
    readTimer.unref?.()
  }
  const acceptLiveEvent = (id, event) => {
    if (!connectionKey || !registered.has(id) || event?.data?.sessionId !== id) return
    const update = feedbackUpdateFromEvent(id, event)
    if (update) enqueue(update)
  }
  const disposeSessionListener = ctx.on?.('session/event', (session, event) => {
    acceptLiveEvent(session?.header?.id, event)
  }, { global: true })
  const disposeCommittedListener = ctx.on?.('feedback/committed', (inspection) => {
    const id = inspection?.meta?.id
    const event = inspection?.events?.at?.(-1)
    if (typeof id !== 'string' || !event) return
    acceptLiveEvent(id, event)
  })
  return {
    ingest(next) {
      if (disposed) return
      const connected = next?.connected === true
      const key = connected && typeof next?.connectionKey === 'string' && next.connectionKey.length > 0
        ? next.connectionKey : ''
      if (!key) {
        connectionKey = ''
        reset()
        return
      }
      if (key !== connectionKey) {
        reset()
        connectionKey = key
      }
      const capabilityOn = next?.audit_message_feedback?.version === 1
      const epoch = next?.auditFeedbackEpoch
      const epochValid = Number.isSafeInteger(epoch) && epoch >= 0
      if (!capabilityOn) {
        sendable = false
        return
      }
      if (!epochValid) {
        sendable = false
        if (!epochInvalid) {
          epochInvalid = true
          note('invalid_epoch', {})
        }
        return
      }
      epochInvalid = false
      if (verifiedEpoch === undefined) {
        // Binding the first epoch keeps ratings queued while the capability was absent.
        verifiedEpoch = epoch
      } else if (verifiedEpoch !== epoch) {
        reset()
        connectionKey = key
        verifiedEpoch = epoch
      }
      awaitingVerification = false
      sendable = true
      schedule()
    },
    track(id) {
      // Registration is synchronous. The log fold waits so it never sits on the model-call path.
      if (!connectionKey || disposed || typeof id !== 'string' || [...id].length > 256) return
      touch(registered, id, true)
      scheduleSnapshot(id)
    },
    dispose() {
      disposed = true
      reset()
      connectionKey = ''
      if (typeof disposeSessionListener === 'function') disposeSessionListener()
      if (typeof disposeCommittedListener === 'function') disposeCommittedListener()
    }
  }
}
