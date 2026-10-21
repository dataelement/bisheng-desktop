import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuditTitleSync, parseAuditTitleUpdate } from '../packages/dsh-desktop-enterprise/audit-title.js'
import { parseConfig } from '../packages/dsh-desktop-enterprise/contract.js'

const active = { connected: true, connectionKey: 'test-account', auditTitleEpoch: 1, audit_conversation_title: { version: 1 } }
const update = { conversation_id: 'e2e-title-main', title: 'e2e-title-first', title_event_seq: 10 }
const handles = []
afterEach(() => { for (const handle of handles.splice(0)) handle.dispose(); vi.useRealTimers() })

function setup(send = vi.fn(async body => ({ status: 'UPDATED', title_event_seq: body.update.title_event_seq }))) {
  vi.useFakeTimers()
  let listener
  let snapshot = { title: update.title, eventSeq: update.title_event_seq }
  const session = { header: { id: update.conversation_id } }
  const dispose = vi.fn()
  const get = vi.fn(name => name === 'sessions' ? { get: () => session } : { get: () => snapshot })
  const ctx = { get, on: vi.fn((_event, fn, options) => { expect(options.global).toBe(true); listener = fn; return dispose }) }
  const note = vi.fn()
  const sync = createAuditTitleSync({ ctx, send, note })
  handles.push(sync)
  sync.ingest(active)
  return { sync, ctx, get, send, note, dispose,
    emit(title, seq, id = update.conversation_id) { snapshot = { title, eventSeq: seq }; listener({ header: { id } }, { type: 'session/title', data: { title }, seq }) }
  }
}

describe('bounded audit title synchronization', () => {
  it('AC-T01/AC-T02: reads accepted title outside the model stack and handles rename without another request', async () => {
    const x = setup()
    x.sync.track(update.conversation_id)
    expect(x.get).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send).toHaveBeenCalledWith({ connectionKey: active.connectionKey, auditTitleEpoch: 1, update }, expect.any(AbortSignal))
    x.emit('e2e-title-renamed', 15)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send.mock.calls[1][0].update).toEqual({ ...update, title: 'e2e-title-renamed', title_event_seq: 15 })
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send).toHaveBeenCalledTimes(2)
    x.emit('foreign title', 16, 'not-enterprise-session')
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.send).toHaveBeenCalledTimes(2)
  })

  it('AC-T03: coalesces highest seq and old in-flight response cannot clear a newer rename', async () => {
    let finish
    const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ status: 'UPDATED', title_event_seq: 20 })
    const x = setup(send)
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(500)
    x.emit('newest', 20)
    x.emit('older', 19)
    finish({ status: 'UPDATED', title_event_seq: 10 })
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].update.title).toBe('newest')
  })

  it('AC-T06: retries early titles with bounded backoff and does not retry terminal outcomes', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'NOT_READY' })
    const x = setup(send)
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(300000)
    expect(send).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(300000)
    expect(send).toHaveBeenCalledTimes(7)
    send.mockResolvedValue({ status: 'CONFLICT', title_event_seq: 20 })
    x.emit('conflict', 20)
    await vi.advanceTimersByTimeAsync(300000)
    expect(send).toHaveBeenCalledTimes(8)
  })

  it('AC-T04: disabled is not remembered as a successful acknowledgement', async () => {
    const x = setup(vi.fn().mockResolvedValue({ status: 'DISABLED' }))
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(500)
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send).toHaveBeenCalledTimes(2)
  })

  it('AC-T07: clears pending work on epoch/account/capability loss and disposes listener', async () => {
    const x = setup()
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(0)
    x.sync.ingest({ ...active, auditTitleEpoch: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.send).not.toHaveBeenCalled()
    x.emit('not registered after login', 30)
    x.sync.track(update.conversation_id)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send.mock.calls[0][0].auditTitleEpoch).toBe(2)
    x.sync.ingest({ ...active, audit_conversation_title: undefined })
    x.emit('disabled', 40)
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.send).toHaveBeenCalledTimes(1)
    x.sync.dispose()
    expect(x.dispose).toHaveBeenCalledOnce()
  })

  it('AC-T07: limits pending conversations and aborts in-flight work on logout', async () => {
    const send = vi.fn((_body, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const x = setup(send)
    for (let i = 0; i < 129; i++) {
      const id = 'e2e-title-' + i
      x.sync.track(id)
      x.emit('title', 1, id)
    }
    expect(x.note).toHaveBeenCalledWith('capacity')
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(1)
    const signal = send.mock.calls[0][1]
    x.sync.ingest({ connected: false })
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(300000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

it('AC-T09: rejects invalid wire updates but preserves literal text and exact IDs', () => {
  expect(parseAuditTitleUpdate({ ...update, conversation_id: ' ID ', title: '<script>literal</script>' })).toMatchObject({ conversation_id: ' ID ', title: '<script>literal</script>' })
  for (const change of [{ title: ' ' }, { title: 'x'.repeat(513) }, { title: '\ud800' }, { title: 'line\n' },
    { title_event_seq: true }, { title_event_seq: -1 }, { title_event_seq: 2 ** 53 }, { user_id: 1 }]) {
    expect(() => parseAuditTitleUpdate({ ...update, ...change })).toThrow('Invalid audit title update.')
  }
  const root = { enabled: true, client_id: 'dsh-desktop', contract_version: '0.5.0' }
  expect(parseConfig({ ...root, audit_conversation_title: { version: 1 } })).toHaveProperty('audit_conversation_title.version', 1)
  expect(parseConfig({ ...root, audit_conversation_title: { version: true } })).toEqual(root)
})
