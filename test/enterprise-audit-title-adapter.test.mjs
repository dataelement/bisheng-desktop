import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { createAuditTitleSync } from '../packages/dsh-desktop-enterprise/audit-title.js'

const handles = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose()
  vi.useRealTimers()
})

function modelResponse(native) {
  if (!native) return new Response([
    { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  const message = { id: 'msg_title', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }
  const response = { id: 'resp_title', object: 'response', status: 'completed', model: 'bisheng:42', output: [message], usage: null }
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response }
  ]
  return new Response(events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

function setup(native, hasTitle = true) {
  vi.useFakeTimers()
  const session = { header: { id: 'e2e-title-adapter' } }
  let title = hasTitle ? { title: 'Existing session title', eventSeq: 10 } : undefined
  let listener
  const ctx = {
    get: name => name === 'sessions' ? { get: () => session } : { get: () => title },
    on: (_name, callback) => { listener = callback; return () => {} }
  }
  const send = vi.fn(async body => ({ status: 'UPDATED', title_event_seq: body.update.title_event_seq }))
  const note = vi.fn()
  const sync = createAuditTitleSync({ ctx, send, note })
  handles.push(sync)
  sync.ingest({ connected: true, connectionKey: 'test-account', auditTitleEpoch: 1, audit_conversation_title: { version: 1 } })
  const track = vi.fn(id => { sync.track(id); return { session_origin: 'main' } })
  const request = vi.fn(async () => modelResponse(native))
  const adapter = new EnterpriseLlmAdapter({
    providerName: () => 'Test', connectionKey: () => 'test-account',
    models: () => [{ id: 'bisheng:42', display_name: 'Test', capabilities: { streaming: true, tools: true, responses: native } }],
    auditFields: () => ['conversation_id', 'request_kind', 'session_origin'],
    resolveAuditSession: track, request, requestResponses: request
  })
  return { sync, send, note, track, request, adapter, input: {
    provider: 'enterprise', model: 'bisheng:42', sessionId: session.header.id,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  }, emit(value, seq) {
    title = { title: value, eventSeq: seq }
    listener(session, { type: 'session/title', data: { title: value }, seq })
  } }
}

async function collect(x) {
  const chunks = []
  for await (const chunk of x.adapter.stream(x.input)) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
}

for (const native of [false, true]) describe(native ? 'Responses title synchronization' : 'Chat title synchronization', () => {
  it('registers once before transport and reports the accepted title snapshot', async () => {
    const x = setup(native)
    x.request.mockImplementation(async () => {
      expect(x.track).toHaveBeenCalledExactlyOnceWith(x.input.sessionId)
      return modelResponse(native)
    })
    await collect(x)
    expect(x.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send).toHaveBeenCalledExactlyOnceWith({
      connectionKey: 'test-account', auditTitleEpoch: 1,
      update: { conversation_id: x.input.sessionId, title: 'Existing session title', title_event_seq: 10 }
    }, expect.any(AbortSignal))
  })

  it('reports a title generated after the first model request and later renames', async () => {
    const x = setup(native, false)
    await collect(x)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send).not.toHaveBeenCalled()
    x.emit('Generated session title', 12)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send.mock.calls[0][0].update).toEqual({ conversation_id: x.input.sessionId, title: 'Generated session title', title_event_seq: 12 })
    x.emit('Renamed session', 15)
    await vi.advanceTimersByTimeAsync(500)
    expect(x.send.mock.calls[1][0].update.title).toBe('Renamed session')
    expect(x.request).toHaveBeenCalledTimes(1)
  })

  it('keeps model completion independent of title upload retries', async () => {
    const x = setup(native)
    x.send.mockRejectedValue(Object.assign(new Error('Private upstream error'), { status: 503 }))
    await collect(x)
    await vi.advanceTimersByTimeAsync(1500)
    expect(x.send).toHaveBeenCalledTimes(2)
    expect(x.request).toHaveBeenCalledTimes(1)
  })

  it('does not fail model execution when optional title tracking throws', async () => {
    const x = setup(native)
    x.track.mockImplementation(() => { throw new Error('Optional session unavailable') })
    await collect(x)
    expect(x.request).toHaveBeenCalledTimes(1)
  })
})
