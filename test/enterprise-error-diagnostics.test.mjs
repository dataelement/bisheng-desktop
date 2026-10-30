import { describe, expect, it, vi } from 'vitest'
import { logEnterpriseFailure, serializeEnterpriseFailure } from '../packages/dsh-desktop-enterprise/error-diagnostics.js'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'

const model = { id: 'synthetic', capabilities: { streaming: true, tools: true } }
const options = { model: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'private-prompt' }] }] }
const sse = data => new Response(data, { headers: { 'content-type': 'text/event-stream' } })
async function collect(adapter, extra = {}) {
  const chunks = []
  for await (const chunk of adapter.stream({ ...options, ...extra })) chunks.push(chunk)
  return chunks
}
function fixture(request, logger = { debug: vi.fn() }) {
  return { logger, adapter: new EnterpriseLlmAdapter({ models: () => [model], request, logger }) }
}
function logged(logger) { return JSON.parse(logger.debug.mock.calls[0][1]) }

describe('enterprise bounded failure diagnostics', () => {
  it('keeps network causes and frames while filtering credentials and payload fields', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED https://user:password@synthetic.example/v1?api_key=query-secret#fragment-secret'), { code: 'ECONNREFUSED' })
    const error = Object.assign(new TypeError('fetch failed Bearer bearer-secret api_key=key-secret'), {
      cause, headers: { authorization: 'header-secret' }, body: 'body-secret', prompt: 'prompt-secret', tokens: 'token-secret'
    })
    const logger = { debug: vi.fn() }
    logEnterpriseFailure(logger, 'chat.request', error, { path: '/v1/chat?token=path-secret', headers: 'context-secret' })
    const serialized = logger.debug.mock.calls[0][1]
    const result = logged(logger)
    expect(result.error).toMatchObject({ name: 'TypeError', cause: { code: 'ECONNREFUSED' } })
    expect(result.error.cause.message).toContain('https://synthetic.example/v1?[redacted]')
    expect(result.error.stack).toContain('at ')
    expect(result.path).toBe('/v1/chat')
    for (const secret of ['password@', 'query-secret', 'fragment-secret', 'bearer-secret', 'key-secret', 'header-secret', 'body-secret', 'prompt-secret', 'token-secret', 'path-secret', 'context-secret']) expect(serialized).not.toContain(secret)
    expect(logger.debug.mock.calls[0][0]).toBe('[enterprise-failure] %s')
  })

  it('redacts broker credentials and JSON payloads while preserving request IDs and error codes', () => {
    const result = JSON.parse(serializeEnterpriseFailure('broker', {
      message: 'fetch failed capability=cap-secret identityTicket=ticket-secret {"messages":[{"content":"json-secret"}]}',
      errorCode: 'enterprise_unavailable', requestId: 'synthetic-request'
    }, { requestId: 'synthetic-context' }))
    expect(result.error).toMatchObject({ errorCode: 'enterprise_unavailable', requestId: 'synthetic-request' })
    expect(result.requestId).toBe('synthetic-context')
    expect(JSON.stringify(result)).not.toMatch(/cap-secret|ticket-secret|json-secret/u)
    const body = serializeEnterpriseFailure('broker', { message: '{"messages":[{"content":"nested-secret"}]}' })
    expect(body).not.toContain('nested-secret')
  })

  it('bounds long fields, aggregate causes and cyclic values without inspecting arbitrary objects', () => {
    const error = { name: 'Error', message: 'x'.repeat(100000), stack: Array(100).fill('    at synthetic (' + 'y'.repeat(4000) + ')').join('\n') }
    error.cause = error
    error.errors = Array(100).fill({ message: 'z'.repeat(100000), cause: error })
    error.body = { toString() { throw new Error('must not stringify body') } }
    const result = JSON.parse(serializeEnterpriseFailure('stage', error))
    expect(result.error.message.length).toBeLessThanOrEqual(768)
    expect(result.error.stack.length).toBeLessThanOrEqual(2048)
    expect(result.error.errors).toHaveLength(4)
    expect(result.error.cause.message).toBe('[circular cause]')
    expect(JSON.stringify(result).length).toBeLessThan(20000)
  })

  it('supports Cordis logger namespace and tolerates absent or throwing loggers and getters', () => {
    const target = { debug: vi.fn() }
    const logger = vi.fn(() => target)
    logEnterpriseFailure(logger, 'transport', new Error('fetch failed'))
    expect(logger).toHaveBeenCalledWith('enterprise-failure')
    expect(target.debug).toHaveBeenCalledOnce()
    expect(() => logEnterpriseFailure(undefined, 'x', null)).not.toThrow()
    expect(() => logEnterpriseFailure({ debug() { throw new Error('log failed') } }, 'x', new Error('failure'))).not.toThrow()
    const error = Object.defineProperty({}, 'message', { get() { throw new Error('getter failed') } })
    expect(() => serializeEnterpriseFailure('x', error)).not.toThrow()
  })
})

describe('enterprise adapter failure diagnostics behavior', () => {
  it('logs transport cause and rethrows the identical error without request content', async () => {
    const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) })
    const { adapter, logger } = fixture(async () => { throw failure })
    await expect(collect(adapter)).rejects.toBe(failure)
    expect(logger.debug).toHaveBeenCalledOnce()
    expect(logged(logger)).toMatchObject({ stage: 'chat.request', error: { cause: { code: 'ECONNRESET' } } })
    expect(logger.debug.mock.calls[0][1]).not.toContain('private-prompt')
  })

  it('logs HTTP failure while preserving public code, status and request ID', async () => {
    const { adapter, logger } = fixture(async () => new Response(JSON.stringify({ error: { code: 'upstream_error', message: 'upstream failed' }, request_id: 'synthetic-request' }), { status: 502 }))
    await expect(collect(adapter)).rejects.toMatchObject({ failure: { code: 'upstream_error', status: 502, requestId: 'synthetic-request' } })
    expect(logged(logger)).toMatchObject({ stage: 'chat.http', error: { code: 'upstream_error', status: '502' } })
  })

  it.each([
    ['non-SSE', () => new Response('private-body'), 'INVALID_RESPONSE'],
    ['JSON', () => sse('data: private-invalid-json\n\n'), 'INVALID_RESPONSE'],
    ['EOF', () => sse(''), 'STREAM_CLOSED'],
    ['body read', () => sse(new ReadableStream({ start(controller) { controller.error(Object.assign(new Error('socket failed'), { code: 'ECONNRESET' })) } })), undefined]
  ])('logs %s failures without raw response data', async (_name, response, code) => {
    const { adapter, logger } = fixture(async () => response())
    await expect(collect(adapter)).rejects.toBeDefined()
    expect(logger.debug).toHaveBeenCalledOnce()
    if (code) expect(logged(logger).error.code).toBe(code)
    expect(logger.debug.mock.calls[0][1]).not.toContain('private-')
  })

  it.each(['http', 'sse'])('retains raw %s reason before public context-limit copy is normalized', async protocol => {
    const payload = { error: { code: 'context_length_exceeded', message: 'Synthetic provider maximum context length is 128000 tokens.' } }
    const { adapter, logger } = fixture(async () => protocol === 'http'
      ? new Response(JSON.stringify(payload), { status: 400 })
      : sse('event: error\ndata: ' + JSON.stringify(payload) + '\n\n'))
    if (protocol === 'http') await expect(collect(adapter)).rejects.toMatchObject({ failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'Model context length exceeded' } })
    else expect((await collect(adapter)).at(-1).reason.failure.message).toBe('Model context length exceeded')
    expect(logger.debug).toHaveBeenCalledOnce()
    expect(logged(logger).error.message).toBe(payload.error.message)
    expect(logged(logger).error.code).toBe('context_length_exceeded')
  })

  it('logs SSE errors and preserves partial output and terminal failure', async () => {
    const { adapter, logger } = fixture(async () => sse('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\nevent: error\ndata: {"error":{"code":"upstream_error","message":"failure"},"request_id":"synthetic"}\n\n'))
    const chunks = await collect(adapter)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'partial')).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'upstream_error', requestId: 'synthetic' } } })
    expect(logger.debug).toHaveBeenCalledOnce()
    expect(logged(logger).error.code).toBe('upstream_error')
  })

  it('does not log successful completion, early consumer return or cancellation', async () => {
    const success = 'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    const { adapter, logger } = fixture(async () => sse(success))
    expect((await collect(adapter)).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    for await (const chunk of adapter.stream(options)) { void chunk; break }
    const controller = new AbortController()
    const reason = new Error('synthetic cancellation')
    const cancelled = fixture(async () => { controller.abort(reason); throw reason })
    await expect(collect(cancelled.adapter, { signal: controller.signal })).rejects.toBe(reason)
    expect(logger.debug).not.toHaveBeenCalled()
    expect(cancelled.logger.debug).not.toHaveBeenCalled()
  })
})
