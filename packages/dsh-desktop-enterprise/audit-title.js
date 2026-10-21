/** Validate the shared bounded wire update without normalizing its identity or text. */
export function parseAuditTitleUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'conversation_id,title,title_event_seq') throw new Error('Invalid audit title update.')
  const { conversation_id: id, title, title_event_seq: seq } = value
  const validUnicode = (text) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)
  if (typeof id !== 'string' || [...id].length < 1 || [...id].length > 256 || !validUnicode(id) ||
      typeof title !== 'string' || !title.trim() || [...title].length > 512 || Buffer.byteLength(title, 'utf8') > 2048 ||
      !validUnicode(title) || /[\u0000-\u001f\u007f]/u.test(title) || !Number.isSafeInteger(seq) || seq < 0 ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) throw new Error('Invalid audit title update.')
  return { conversation_id: id, title, title_event_seq: seq }
}

/** Bounded best-effort synchronizer. Only sessions actually using the enterprise adapter are registered. */
export function createAuditTitleSync({ ctx, send, note = () => {} }) {
  const pending = new Map()
  const registered = new Map()
  const acknowledged = new Map()
  const reads = new Map()
  const delays = [1000, 3000, 10000, 30000, 60000, 120000]
  let identity = ''
  let state
  let generation = 0
  let timer
  let running
  let disposed = false

  const touch = (map, key, value) => {
    map.delete(key)
    map.set(key, value)
    if (map.size > 512) map.delete(map.keys().next().value)
  }
  const reset = () => {
    generation++
    clearTimeout(timer)
    timer = undefined
    running?.abort()
    pending.clear()
    for (const timer of reads.values()) clearTimeout(timer)
    reads.clear()
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
    try { update = parseAuditTitleUpdate(update) } catch { note('invalid_update'); return }
    const id = update.conversation_id
    const old = pending.get(id)
    const ack = acknowledged.get(id)
    if ((ack && ack.title_event_seq >= update.title_event_seq) ||
        (old && old.update.title_event_seq >= update.title_event_seq)) return
    const cost = Buffer.byteLength(JSON.stringify(update), 'utf8')
    const bytes = [...pending.values()].reduce((sum, item) => sum + item.cost, 0) - (old?.cost ?? 0)
    if ((!old && pending.size >= 128) || bytes + cost > 512 * 1024) { note('capacity'); return }
    pending.set(id, { update, cost, attempts: 0, created: Date.now(), due: Date.now() + 500 })
    schedule()
  }
  const drain = async () => {
    const current = generation
    const item = [...pending.values()].find(value => value.due <= Date.now())
    if (!item || !identity || disposed) { schedule(); return }
    if (Date.now() - item.created >= 300000) {
      pending.delete(item.update.conversation_id)
      note('expired')
      schedule()
      return
    }
    const controller = new AbortController()
    running = controller
    const timeout = setTimeout(() => controller.abort(), 5000)
    let retry = false
    try {
      const result = await send({ connectionKey: state.connectionKey, auditTitleEpoch: state.auditTitleEpoch, update: item.update }, controller.signal)
      if (current !== generation) return
      retry = result?.status === 'NOT_READY'
      if (['UPDATED', 'UNCHANGED'].includes(result?.status) && result.title_event_seq === item.update.title_event_seq) {
        touch(acknowledged, item.update.conversation_id, item.update)
      } else if (!['STALE', 'CONFLICT', 'DISABLED', 'NOT_READY'].includes(result?.status)) {
        note('invalid_response')
      }
    } catch (error) {
      if (current !== generation) return
      const status = error?.status
      retry = !status || status === 429 || status >= 500
      note(retry ? 'retry' : 'rejected')
    } finally {
      clearTimeout(timeout)
      if (running === controller) running = undefined
      if (current === generation && pending.get(item.update.conversation_id) === item) {
        if (retry && item.attempts < delays.length && Date.now() - item.created < 300000) {
          item.due = Date.now() + delays[item.attempts++]
        } else pending.delete(item.update.conversation_id)
      }
      schedule()
    }
  }
  const disposeListener = ctx.on?.('session/event', (session, event) => {
    const id = session?.header?.id
    if (identity && registered.has(id) && event?.type === 'session/title') {
      enqueue({ conversation_id: id, title: event.data?.title, title_event_seq: event.seq })
    }
  }, { global: true })
  return {
    ingest(next) {
      const key = next?.connected && next.audit_conversation_title?.version === 1 &&
        typeof next.connectionKey === 'string' && Number.isSafeInteger(next.auditTitleEpoch)
        ? `${next.connectionKey}:${next.auditTitleEpoch}` : ''
      if (key !== identity) { reset(); identity = key }
      state = next
      schedule()
    },
    track(id) {
      if (!identity || disposed || typeof id !== 'string' || [...id].length > 256) return
      // No session fold, event replay or asynchronous I/O runs in the model await chain.
      const current = generation
      touch(registered, id, true)
      if (reads.has(id)) return
      if (reads.size >= 512) { note('snapshot_capacity'); return }
      const readTimer = setTimeout(() => {
        reads.delete(id)
        if (current !== generation || disposed || !registered.has(id)) return
        try {
          const session = ctx.get?.('sessions')?.get(id)
          const title = session?.header?.id === id && ctx.get?.('sessionTitle')?.get(session)
          if (title) enqueue({ conversation_id: id, title: title.title, title_event_seq: title.eventSeq })
        } catch { note('snapshot_unavailable') }
      }, 0)
      reads.set(id, readTimer)
      readTimer.unref?.()
    },
    dispose() {
      disposed = true
      reset()
      if (typeof disposeListener === 'function') disposeListener()
    }
  }
}
