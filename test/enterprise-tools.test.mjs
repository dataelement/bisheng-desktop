import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEnterpriseAuth, bindEnterpriseAuth, createEnterpriseAuthTransport } from '../packages/dsh-desktop-enterprise/enterprise-auth.js'
import { EnterpriseToolError, invokeEnterpriseTool } from '../packages/dsh-desktop-enterprise/enterprise-tools.js'

const state = { connected: true, sessionVersion: '1', enterpriseId: 'enterprise', userId: 'user' }
const response = (result = { answer: 42 }, tool = 'example') => Response.json({ tool, result })
const cleanup = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.useRealTimers() })
function channel() {
  return { getState: vi.fn(() => ({ ...state })), request: vi.fn(async () => response()) }
}
const call = (auth, args = {}, options) => invokeEnterpriseTool(auth, 'example', args, options)
async function bound(ctx, value = state) {
  const transport = { state: vi.fn(async () => value), request: vi.fn(async () => response()) }
  const dispose = await bindEnterpriseAuth(ctx, transport)
  cleanup.push(dispose)
  return { transport, dispose }
}

 describe('generic enterprise tool invocation', () => {
  it('posts generic arguments once and returns the result', async () => {
    const auth = channel()
    await expect(call(auth, { nested: ['value'] })).resolves.toEqual({ answer: 42 })
    expect(auth.request).toHaveBeenCalledTimes(1)
    const [path, init] = auth.request.mock.calls[0]
    expect(path).toBe('/api/v1/dsh/tools/example/invoke')
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"arguments":{"nested":["value"]}}' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(auth.getState).toHaveBeenCalledTimes(3)
  })
  it.each([null, false, 0, 'text', ['array']])('accepts JSON result %j', async result => {
    const auth = channel()
    auth.request.mockResolvedValue(response(result))
    await expect(call(auth)).resolves.toEqual(result)
  })
  it.each([{ tool: 'wrong', result: {} }, { tool: 'example' }, [], null, { tool: 'example', result: {}, error: { message: 'secret' } }, { tool: 'example', error: { message: 'secret' } }])('rejects bad envelope %j', async envelope => {
    const auth = channel()
    auth.request.mockResolvedValue(Response.json(envelope))
    await expect(call(auth)).rejects.toMatchObject({ errorCode: envelope?.error ? 'request_failed' : 'invalid_response' })
  })
  it.each(['', '../escape', 'white space', 'a'.repeat(126)])('rejects tool name %j before dispatch', async name => {
    const auth = channel()
    await expect(invokeEnterpriseTool(auth, name, {})).rejects.toMatchObject({ errorCode: 'invalid_request' })
    expect(auth.request).not.toHaveBeenCalled()
  })
  it.each(['timeoutMs', 'maxInputBytes', 'maxResponseBytes'])('validates %s as positive safe integer', async key => {
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) {
      await expect(call(channel(), {}, { [key]: value })).rejects.toMatchObject({ errorCode: 'invalid_request' })
    }
    await expect(call(channel(), {}, { [key]: Number.MAX_SAFE_INTEGER })).resolves.toEqual({ answer: 42 })
  })
  it('rejects invalid options, unserializable or absent arguments', async () => {
    for (const options of [null, [], { signal: {} }]) await expect(call(channel(), {}, options)).rejects.toMatchObject({ errorCode: 'invalid_request' })
    for (const args of [undefined, () => {}, 1n]) await expect(invokeEnterpriseTool(channel(), 'example', args)).rejects.toMatchObject({ errorCode: 'invalid_request' })
    const cyclic = {}; cyclic.self = cyclic
    await expect(call(channel(), cyclic)).rejects.toMatchObject({ errorCode: 'invalid_request' })
  })
  it('enforces serialized input bytes including envelope and UTF-8', async () => {
    const auth = channel()
    const args = { text: 'é' }
    const size = Buffer.byteLength(JSON.stringify({ arguments: args }))
    await expect(call(auth, args, { maxInputBytes: size })).resolves.toEqual({ answer: 42 })
    await expect(call(auth, args, { maxInputBytes: size - 1 })).rejects.toMatchObject({ errorCode: 'invalid_request' })
    await expect(call(auth, { text: 'x'.repeat(65536) })).rejects.toMatchObject({ errorCode: 'invalid_request' })
    expect(auth.request).toHaveBeenCalledTimes(1)
  })
  it('bounds response bytes without trusting content-length', async () => {
    const auth = channel()
    const text = JSON.stringify({ tool: 'example', result: 'é' })
    const size = Buffer.byteLength(text)
    auth.request.mockImplementation(async () => new Response(text, { headers: { 'content-length': '1' } }))
    await expect(call(auth, {}, { maxResponseBytes: size })).resolves.toBe('é')
    await expect(call(auth, {}, { maxResponseBytes: size - 1 })).rejects.toMatchObject({ errorCode: 'invalid_response' })
    auth.request.mockResolvedValue(response('x'.repeat(4 * 1024 * 1024)))
    await expect(call(auth)).rejects.toMatchObject({ errorCode: 'invalid_response' })
  })
  it.each([null, {}, { status: 800, ok: true }])('rejects invalid Response %j', async value => {
    const auth = channel(); auth.request.mockResolvedValue(value)
    await expect(call(auth)).rejects.toMatchObject({ errorCode: 'invalid_response' })
  })
  it('rejects absent body and invalid JSON', async () => {
    const auth = channel()
    for (const value of [new Response(null), new Response('not json')]) {
      auth.request.mockResolvedValue(value)
      await expect(call(auth)).rejects.toMatchObject({ errorCode: 'invalid_response' })
    }
  })
  it('validates public session identity and disconnected state', async () => {
    const auth = channel()
    for (const value of [null, {}, { ...state, connected: 1 }, { ...state, sessionVersion: '' }, { ...state, enterpriseId: '' }, { ...state, userId: 2 }]) {
      auth.getState.mockReturnValue(value)
      await expect(call(auth)).rejects.toMatchObject({ errorCode: 'invalid_response' })
    }
    auth.getState.mockReturnValue({ ...state, connected: false })
    await expect(call(auth)).rejects.toMatchObject({ errorCode: 'not_connected' })
    expect(auth.request).not.toHaveBeenCalled()
  })
  it('checks fresh identity immediately before dispatch', async () => {
    const auth = channel()
    auth.getState.mockReturnValueOnce(state).mockReturnValue({ ...state, userId: 'different' })
    await expect(call(auth)).rejects.toMatchObject({ errorCode: 'session_changed' })
    expect(auth.request).not.toHaveBeenCalled()
  })
  it.each(['sessionVersion', 'enterpriseId', 'userId', 'connected'])('rejects %s switch after body consumption', async key => {
    const auth = channel()
    auth.request.mockImplementation(async () => {
      auth.getState.mockReturnValue({ ...state, [key]: key === 'connected' ? false : 'different' })
      return response()
    })
    await expect(call(auth)).rejects.toMatchObject({ errorCode: 'session_changed' })
  })
  it.each([400, 401, 403, 404, 429, 500])('sanitizes HTTP %s with safe diagnostics and never retries', async status => {
    const auth = channel()
    const requestId = '12345678-1234-1234-1234-123456789abc'
    auth.request.mockResolvedValue(Response.json({ error: { code: 'tool_upstream_failed', message: 'SECRET' }, request_id: requestId }, { status }))
    const error = await call(auth).catch(error => error)
    expect(error).toBeInstanceOf(EnterpriseToolError)
    expect(error).toMatchObject({ errorCode: ({ 400: 'invalid_request', 401: 'not_connected', 403: 'authorization_denied', 404: 'tool_not_found' })[status] ?? 'request_failed', status, backendCode: 'tool_upstream_failed', requestId })
    expect(error.message).not.toContain('SECRET')
    expect(auth.request).toHaveBeenCalledTimes(1)
  })
  it('drops unsafe diagnostics and sanitizes SDK host failures', async () => {
    const auth = channel()
    auth.request.mockResolvedValue(Response.json({ error: { code: 'SECRET' }, request_id: 'SECRET' }, { status: 500 }))
    const error = await call(auth).catch(error => error)
    expect(error.backendCode).toBeUndefined(); expect(error.requestId).toBeUndefined()
    expect(error.message).not.toContain('SECRET')
    for (const errorCode of ['invalid_request', 'invalid_response', 'not_connected', 'authorization_denied', 'session_changed', 'request_aborted', 'request_timeout', 'request_failed', 'tool_not_found', 'request_too_large', 'response_too_large', 'too_many_requests', 'UNKNOWN']) {
      auth.request.mockRejectedValue({ errorCode, message: 'SECRET', status: 403, backendCode: 'SECRET', requestId: 'SECRET' })
      const failure = await call(auth).catch(error => error)
      const expected = ({ UNKNOWN: 'request_failed', too_many_requests: 'request_failed', request_too_large: 'invalid_request', response_too_large: 'invalid_response' })[errorCode] ?? errorCode
      expect(failure).toMatchObject({ errorCode: expected })
      expect(failure.status).toBeUndefined()
      expect(failure.backendCode).toBeUndefined()
      expect(failure.requestId).toBeUndefined()
      expect(failure.message).not.toContain('SECRET')
    }
  })
  it('bounds stalled diagnostics at one second even when cancel stalls', async () => {
    vi.useFakeTimers()
    const auth = channel(), cancel = vi.fn(() => new Promise(() => {}))
    auth.request.mockResolvedValue(new Response(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel }), { status: 403 }))
    const pending = call(auth)
    const assertion = expect(pending).rejects.toMatchObject({ errorCode: 'authorization_denied', status: 403 })
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('preserves HTTP error for broken, malformed and oversized diagnostics', async () => {
    const auth = channel()
    for (const body of [new ReadableStream({ start(controller) { controller.error(new Error('SECRET')) } }), 'bad json', 'x'.repeat(16 * 1024 + 1)]) {
      auth.request.mockResolvedValue(new Response(body, { status: 404 }))
      await expect(call(auth)).rejects.toMatchObject({ errorCode: 'tool_not_found', status: 404 })
    }
  })
  it('times out stalled headers and stalled success body', async () => {
    vi.useFakeTimers()
    const auth = channel()
    for (const request of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}) } }))]) {
      auth.request.mockImplementation(request)
      const assertion = expect(call(auth, {}, { timeoutMs: 20 })).rejects.toMatchObject({ errorCode: 'request_timeout' })
      await vi.advanceTimersByTimeAsync(21)
      await assertion
    }
  })
  it('defaults to 60 seconds and cancels a late header response', async () => {
    vi.useFakeTimers()
    const auth = channel(), cancel = vi.fn()
    let resolve
    auth.request.mockImplementation(() => new Promise(done => { resolve = done }))
    const assertion = expect(call(auth)).rejects.toMatchObject({ errorCode: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(60000)
    await assertion
    resolve(new Response(new ReadableStream({ cancel })))
    await Promise.resolve(); await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('caller abort covers body reads and takes priority over HTTP diagnostics', async () => {
    const auth = channel()
    for (const status of [200, 403]) {
      const controller = new AbortController()
      let started
      const ready = new Promise(resolve => { started = resolve })
      const cancel = vi.fn(() => new Promise(() => {}))
      auth.request.mockResolvedValue(new Response(new ReadableStream({ pull() { started(); return new Promise(() => {}) }, cancel }), { status }))
      const assertion = expect(call(auth, {}, { signal: controller.signal })).rejects.toMatchObject({ errorCode: 'request_aborted' })
      await ready; controller.abort(new Error('SECRET'))
      await assertion
      expect(cancel).toHaveBeenCalledTimes(1)
    }
    const controller = new AbortController(); controller.abort()
    auth.request.mockClear()
    await expect(call(auth, {}, { signal: controller.signal })).rejects.toMatchObject({ errorCode: 'request_aborted' })
    expect(auth.request).not.toHaveBeenCalled()
  })
})

describe('real Cordis invocation authorization', () => {
  it('invokes a tool through the real HTTP broker transport with caller identity', async () => {
    const requests = []
    let fail = false
    const server = createServer(async (req, res) => {
      try {
        if (req.url === '/v1/auth/state') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(state))
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        requests.push({ authorization: req.headers.authorization, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        res.setHeader('content-type', 'application/json')
        res.statusCode = fail ? 403 : 200
        res.end(JSON.stringify(fail ? { error: { code: 'tool_permission_denied', message: 'SECRET' } } : { tool: 'example', result: ['real HTTP'] }))
      } catch { res.statusCode = 500; res.end('{}') }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
    const ctx = new Context(); applyEnterpriseAuth(ctx)
    cleanup.push(() => ctx.fiber.dispose())
    const child = ctx.extend()
    cleanup.push(await bindEnterpriseAuth(child, createEnterpriseAuthTransport('http://127.0.0.1:' + server.address().port, 'fixture-capability')))
    await expect(child.enterpriseAuth.invokeTool('example', { query: 'hello' })).resolves.toEqual(['real HTTP'])
    expect(requests[0]).toMatchObject({ authorization: 'Bearer fixture-capability', path: '/api/v1/dsh/tools/example/invoke', method: 'POST', sessionVersion: '1', body: '{"arguments":{"query":"hello"}}' })
    fail = true
    const error = await child.enterpriseAuth.invokeTool('example', {}).catch(error => error)
    expect(error).toMatchObject({ errorCode: 'authorization_denied', status: 403, backendCode: 'tool_permission_denied' })
    expect(error.message).not.toContain('SECRET')
    expect(requests).toHaveLength(2)
  })
  it('uses caller binding, denies root/forged siblings and retains child context after await', async () => {
    const ctx = new Context(); applyEnterpriseAuth(ctx)
    cleanup.push(() => ctx.fiber.dispose())
    const first = ctx.extend(), second = ctx.extend()
    const a = await bound(first), b = await bound(second, { ...state, userId: 'second', sessionVersion: '2' })
    let pluginCtx
    await first.plugin({ inject: ['enterpriseAuth'], apply(scoped) { pluginCtx = scoped } })
    await expect(pluginCtx.enterpriseAuth.invokeTool('example', {})).resolves.toEqual({ answer: 42 })
    expect(a.transport.request).toHaveBeenCalledTimes(1)
    expect(b.transport.request).not.toHaveBeenCalled()
    await expect(second.enterpriseAuth.invokeTool('example', {})).resolves.toEqual({ answer: 42 })
    expect(b.transport.request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ sessionVersion: '2' }))
    for (const unauthorized of [ctx, ctx.extend(), ctx.intercept('enterpriseAuth', { pluginId: 'authorized', instanceId: 'known' })]) {
      await expect(unauthorized.enterpriseAuth.invokeTool('example', {})).rejects.toMatchObject({ errorCode: 'authorization_denied' })
    }
    a.dispose()
    await expect(pluginCtx.enterpriseAuth.invokeTool('example', {})).rejects.toMatchObject({ errorCode: 'authorization_denied' })
    await expect(second.enterpriseAuth.invokeTool('example', {})).resolves.toEqual({ answer: 42 })
  })
  it('rechecks real caller authorization after consumption and during stalled reads', async () => {
    const ctx = new Context(); applyEnterpriseAuth(ctx)
    cleanup.push(() => ctx.fiber.dispose())
    const child = ctx.extend(), binding = await bound(child)
    binding.transport.request.mockImplementation(async () => { binding.dispose(); return response() })
    await expect(child.enterpriseAuth.invokeTool('example', {})).rejects.toMatchObject({ errorCode: 'authorization_denied' })
  })
})
