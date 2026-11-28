import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuditFeedbackSync } from '../packages/dsh-desktop-enterprise/audit-feedback.js'

interface FeedbackEvent {
  type: string
  seq: number
  data: Record<string, unknown>
}

function harness() {
  const uploads: Array<Record<string, unknown>> = []
  const notes: Array<Record<string, unknown>> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const sessions = new Map<string, { header: { id: string }, snapshotEvents: () => FeedbackEvent[] }>()
  let sendImpl = async (body: { update: Record<string, unknown> }) => {
    uploads.push(body.update)
    return { status: 'UPDATED', event_seq: body.update.event_seq as number }
  }
  let rereadImpl = async () => {}
  let rereadCalls = 0
  const ctx = {
    on(name: string, listener: (...args: unknown[]) => void) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== listener))
    },
    get(name: string) {
      if (name !== 'sessions') return undefined
      return { get: (id: string) => sessions.get(id) }
    }
  }
  const sync = createAuditFeedbackSync({
    ctx,
    send: (body) => sendImpl(body as { update: Record<string, unknown> }),
    note: (reason, details) => { notes.push({ reason, ...details }) },
    reread: () => { rereadCalls += 1; return rereadImpl() }
  })
  const state = (overrides: Record<string, unknown> = {}) => ({
    connected: true,
    connectionKey: 'conn-a',
    audit_message_feedback: { version: 1 },
    auditFeedbackEpoch: 1,
    ...overrides
  })
  const emit = (event: FeedbackEvent) => {
    for (const listener of listeners.get('session/event') ?? []) {
      listener({ header: { id: event.data.sessionId } }, event)
    }
  }
  const commit = (inspection: { meta?: { id?: string }, events?: FeedbackEvent[] }) => {
    for (const listener of listeners.get('feedback/committed') ?? []) listener(inspection)
  }
  return {
    uploads, notes, sessions, sync, state, emit, commit,
    rereadCalls: () => rereadCalls,
    setSend(impl: typeof sendImpl) { sendImpl = impl },
    setReread(impl: typeof rereadImpl) { rereadImpl = impl }
  }
}

const put = (seq: number, rating: 'positive' | 'negative', sessionId = 'session-1') => ({
  type: 'feedback/message-put', seq,
  data: { sessionId, item: { messageId: 'msg-1', rating } }
})
const deletion = (seq: number, sessionId = 'session-1') => ({
  type: 'feedback/message-delete', seq,
  data: { sessionId, messageId: 'msg-1' }
})

describe('audit feedback synchronization', () => {
  afterEach(() => { vi.useRealTimers() })

  it('keeps ratings queued before the first epoch and uploads them when that epoch is bound', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state({ audit_message_feedback: undefined, auditFeedbackEpoch: undefined }))
    h.sync.track('session-1')
    h.emit(put(12, 'negative'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([])
    h.sync.ingest(h.state())
    await vi.advanceTimersByTimeAsync(0)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 12, op: 'put', rating: 'negative' }
    ])
  })

  it('clears queued ratings only when a verified epoch changes', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.emit(put(12, 'positive'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toHaveLength(1)
    h.sync.ingest(h.state({ auditFeedbackEpoch: 2 }))
    h.emit(deletion(13))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toHaveLength(1)
    h.sync.track('session-1')
    h.emit(deletion(13))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads[1]).toMatchObject({ op: 'delete', event_seq: 13 })
  })

  it('resumes a 409 after the same snapshot without skipping the backoff', async () => {
    vi.useFakeTimers()
    const h = harness()
    let calls = 0
    h.setSend(async (body) => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('not ready'), { status: 409 })
      h.uploads.push(body.update)
      return { status: 'UPDATED', event_seq: body.update.event_seq as number }
    })
    h.setReread(async () => { h.sync.ingest(h.state()) })
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.emit(put(12, 'negative'))
    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toBe(1)
    expect(h.uploads).toEqual([])
    expect(h.rereadCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(h.uploads).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 12, op: 'put', rating: 'negative' }
    ])
  })

  it('expires a paused rating from its original created time', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state({ audit_message_feedback: undefined, auditFeedbackEpoch: undefined }))
    h.sync.track('session-1')
    h.emit(put(12, 'negative'))
    await vi.advanceTimersByTimeAsync(300000)
    h.sync.ingest(h.state())
    await vi.advanceTimersByTimeAsync(0)
    expect(h.uploads).toEqual([])
    expect(h.notes.some(note => note.reason === 'expired' && note.event_seq === 12)).toBe(true)
  })

  it('gives a replacement rating its own lifetime', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state({ audit_message_feedback: undefined, auditFeedbackEpoch: undefined }))
    h.sync.track('session-1')
    h.emit(put(12, 'positive'))
    await vi.advanceTimersByTimeAsync(299000)
    h.emit(deletion(13))
    await vi.advanceTimersByTimeAsync(2000)
    h.sync.ingest(h.state())
    await vi.advanceTimersByTimeAsync(0)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 13, op: 'delete' }
    ])
  })

  it('uploads only the latest unsent rating, and still sends a delete that replaced an in-flight put', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.emit(put(12, 'positive'))
    h.emit(put(13, 'negative'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 13, op: 'put', rating: 'negative' }
    ])

    let release: (value: { status: string, event_seq: number }) => void = () => undefined
    h.setSend((body) => {
      h.uploads.push(body.update)
      if (body.update.event_seq === 15) return Promise.resolve({ status: 'UPDATED', event_seq: 15 })
      return new Promise((resolve) => { release = resolve })
    })
    h.emit(put(14, 'positive'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toHaveLength(2)
    h.emit(deletion(15))
    release({ status: 'UPDATED', event_seq: 14 })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads[2]).toMatchObject({ op: 'delete', event_seq: 15 })
  })

  it('snapshots a trailing delete instead of treating the current list as empty', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sessions.set('session-1', {
      header: { id: 'session-1' },
      snapshotEvents: () => [put(12, 'negative'), deletion(13)]
    })
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 13, op: 'delete' }
    ])
  })

  it('does not let an older snapshot replace a newer live rating', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sessions.set('session-1', {
      header: { id: 'session-1' },
      snapshotEvents: () => [put(12, 'negative')]
    })
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.emit(put(14, 'positive'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 14, op: 'put', rating: 'positive' }
    ])
  })

  it('does not upload a cold rating for a session that was not tracked on the new connection', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.sync.ingest(h.state({ connectionKey: 'conn-b', auditFeedbackEpoch: 4 }))
    h.commit({ meta: { id: 'session-1' }, events: [deletion(13)] })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([])
    h.sync.track('session-1')
    h.commit({ meta: { id: 'session-1' }, events: [deletion(13)] })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 13, op: 'delete' }
    ])
  })

  it('uploads one rating when the live and cold notifications carry the same seq', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    const event = put(12, 'negative')
    h.emit(event)
    h.commit({ meta: { id: 'session-1' }, events: [event] })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toHaveLength(1)
  })

  it('stops delivering cold notifications after dispose', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.sync.dispose()
    h.commit({ meta: { id: 'session-1' }, events: [deletion(13)] })
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([])
  })

  it('does not resend a stale seq, and does send a newer one', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.setSend(async (body) => {
      if (body.update.event_seq === 12) return { status: 'STALE', event_seq: 12 }
      h.uploads.push(body.update)
      return { status: 'UPDATED', event_seq: body.update.event_seq as number }
    })
    h.sync.ingest(h.state())
    h.sync.track('session-1')
    h.emit(put(12, 'negative'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([])
    h.emit(put(12, 'negative'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([])
    h.emit(deletion(13))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.uploads).toEqual([
      { conversation_id: 'session-1', message_id: 'msg-1', event_seq: 13, op: 'delete' }
    ])
  })
})
