import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_HEADER_TIMEOUT_MS, AUTH_IDLE_TIMEOUT_MS, AUTH_MAX_REQUEST_BYTES, AUTH_MAX_RESPONSE_BYTES,
  AUTH_TOTAL_TIMEOUT_MS, EnterpriseAuthError, EnterpriseAuthTransport, parseEnterpriseAuthRequest
} from '../src/main/enterprise/enterprise-auth'
import type { EnterpriseFetch } from '../src/main/enterprise/platform-fetch'

const plugin = { pluginId: 'example-plugin', instanceId: 'instance-a' }
const wire = { path: '/business/action?q=private', sessionVersion: 'session-1' }
const transports: EnterpriseAuthTransport[] = []
afterEach(() => {
  for (const transport of transports.splice(0)) transport.invalidate()
  vi.useRealTimers()
})

function fixture(fetchImpl: EnterpriseFetch = async () => new Response('ok')) {
  const transport = new EnterpriseAuthTransport()
  transports.push(transport)
  let version = 'session-1'
  const audit = vi.fn()
  const fetch = vi.fn(fetchImpl)
  const access = vi.fn(async () => ({ endpoint: 'https://enterprise.example/business/action?q=private', accessToken: 'host-only-secret' }))
  const options = {
    assertSession: (candidate: string) => { if (candidate !== version) throw new EnterpriseAuthError('session_changed', 409) },
    access, fetch, audit
  }
  const request = (input: unknown = wire, signal = new AbortController().signal, identity = plugin) => transport.request(identity, input, signal, options)
  return { transport, audit, fetch, access, request, change: () => { version = 'session-2'; transport.invalidate() } }
}

describe('enterprise generic auth wire', () => {
  it.each([
    null, [], {}, { ...wire, path: 'https://other.example' }, { ...wire, path: '//other.example/path' },
    { ...wire, path: '/\\other.example' }, { ...wire, path: '/hello#fragment' }, { ...wire, path: '/a%5cb' },
    { ...wire, path: '/hello\nworld' }, { ...wire, method: 'CONNECT' }, { ...wire, method: 'TRACE' },
    { ...wire, body: 'get-body' }, { ...wire, bodyEncoding: 'base64' },
    { ...wire, method: 'POST', body: '!!', bodyEncoding: 'base64' }, { ...wire, accessToken: 'secret' },
    { ...wire, headers: { Authorization: 'injected' } }, { ...wire, headers: { Cookie: 'injected' } },
    { ...wire, headers: { 'X-Dsh-Plugin-Id': 'spoof' } }, { ...wire, headers: { Host: 'other.example' } }, { ...wire, headers: { 'X-API-Key': 'key' } },
    { ...wire, headers: { 'X-Forwarded-Host': 'other' } }, { ...wire, headers: { 'Sec-Fetch-Site': 'same-origin' } },
    { ...wire, headers: { 'Content-Length': '999' } }, { ...wire, headers: { Accept: 'ok\r\nInjected: bad' } },
    { ...wire, headers: { accept: 'a', Accept: 'b' } }, { ...wire, headers: { Accept: 3 } }
  ])('rejects invalid or privileged wire input: %j', input => {
    expect(() => parseEnterpriseAuthRequest(input)).toThrow(EnterpriseAuthError)
  })

  it('accepts generic methods, headers and binary bodies without changing their bytes', () => {
    const parsed = parseEnterpriseAuthRequest({ ...wire, method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: 'AP9h', bodyEncoding: 'base64' })
    expect(parsed.method).toBe('PATCH')
    expect(parsed.headers).toEqual({ 'content-type': 'application/octet-stream' })
    expect([...parsed.body ?? []]).toEqual([0, 255, 97])
    expect(() => parseEnterpriseAuthRequest({ ...wire, method: 'POST', body: 'x'.repeat(AUTH_MAX_REQUEST_BYTES + 1) })).toThrow(expect.objectContaining({ status: 413 }))
  })
})

describe('enterprise auth streaming transport', () => {
  it('injects only host auth, never replays business 401, filters headers and audits without query', async () => {
    const f = fixture(async () => new Response('denied', { status: 401, headers: {
      'content-type': 'text/plain', 'x-request-id': 'id-1', 'set-cookie': 'secret', authorization: 'secret', location: 'secret', 'x-upstream-private': 'secret'
    } }))
    const response = await f.request({ ...wire, method: 'POST', body: 'payload' })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('denied')
    expect(f.fetch).toHaveBeenCalledOnce()
    expect(f.access).toHaveBeenCalledOnce()
    expect(f.fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', headers: { authorization: 'Bearer host-only-secret', 'x-dsh-plugin-id': plugin.pluginId, 'x-dsh-plugin-instance-id': plugin.instanceId } })
    expect([...response.headers.keys()]).toEqual(['content-type', 'x-request-id'])
    expect(f.audit).toHaveBeenCalledExactlyOnceWith({ pluginId: plugin.pluginId, path: '/business/action', status: 401, duration: expect.any(Number) })
    expect(JSON.stringify(f.audit.mock.calls)).not.toMatch(/private|secret/)
  })

  it('does not prefetch response chunks and holds concurrency slots until consumption or cancellation', async () => {
    const pull = vi.fn((stream: ReadableStreamDefaultController<Uint8Array>) => stream.enqueue(new Uint8Array([1])))
    const f = fixture(async () => new Response(new ReadableStream({ pull }, { highWaterMark: 0 })))
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.request()))
    expect(pull).not.toHaveBeenCalled()
    await expect(f.request()).rejects.toMatchObject({ status: 429 })
    const reader = responses[0]?.body?.getReader()
    expect(await reader?.read()).toMatchObject({ value: new Uint8Array([1]), done: false })
    expect(pull).toHaveBeenCalledOnce()
    await reader?.cancel()
    const replacement = await f.request()
    await replacement.body?.cancel()
    for (const response of responses.slice(1)) await response.body?.cancel()
    expect(f.audit).toHaveBeenCalledTimes(6)
  })

  it('enforces the global concurrency cap across plugin instances', async () => {
    const f = fixture(async () => new Response(new ReadableStream({}, { highWaterMark: 0 })))
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => f.request(wire, undefined, { ...plugin, instanceId: 'instance-' + index })))
    await expect(f.request()).rejects.toMatchObject({ code: 'too_many_requests' })
    for (const response of responses) await response.body?.cancel()
  })

  it('aborts pending reads on session changes and never delivers a late chunk', async () => {
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const cancel = vi.fn()
    const f = fixture(async () => new Response(new ReadableStream({ start: stream => { upstream = stream }, cancel }, { highWaterMark: 0 })))
    const response = await f.request()
    const reading = response.body?.getReader().read()
    const rejected = expect(reading).rejects.toMatchObject({ code: 'session_changed', status: 409 })
    f.change()
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(() => upstream?.enqueue(new Uint8Array([99]))).toThrow()
    await expect(f.request()).rejects.toMatchObject({ code: 'session_changed' })
    expect(f.audit).toHaveBeenCalledTimes(2)
  })

  it('guards delivery even if the session changes without aborting a pending read', async () => {
    let valid = true
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const f = fixture(async () => new Response(new ReadableStream({ start: stream => { upstream = stream } }, { highWaterMark: 0 })))
    const response = await f.transport.request(plugin, wire, new AbortController().signal, {
      assertSession: () => { if (!valid) throw new EnterpriseAuthError('session_changed', 409) },
      access: f.access, fetch: f.fetch, audit: f.audit
    })
    const reading = response.body?.getReader().read()
    valid = false
    upstream?.enqueue(new Uint8Array([1]))
    await expect(reading).rejects.toMatchObject({ code: 'session_changed' })
  })

  it('propagates caller cancellation for already-returned streams and frees their slot', async () => {
    const controller = new AbortController()
    const f = fixture(async () => new Response(new ReadableStream({}, { highWaterMark: 0 })))
    const response = await f.request(wire, controller.signal)
    controller.abort(new Error('untrusted reason with host-only-secret'))
    await expect(response.text()).rejects.toMatchObject({ code: 'request_aborted', status: 499 })
    expect(f.audit.mock.calls[0]?.[0]).toMatchObject({ status: 499 })
  })

  it('never starts credential acquisition for an already-aborted request', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort(new Error('private reason'))
    await expect(f.request(wire, controller.signal)).rejects.toMatchObject({ code: 'request_aborted' })
    expect(f.access).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.audit).toHaveBeenCalledOnce()
  })

  it('sanitizes fetch and stream errors instead of exposing upstream diagnostics', async () => {
    const f = fixture(async () => { throw new Error('https://private?token=host-only-secret') })
    await expect(f.request()).rejects.toMatchObject({ code: 'request_failed', status: 502, message: 'Enterprise auth request failed (request_failed).' })
    const g = fixture(async () => new Response(new ReadableStream({ pull: stream => stream.error(new Error('host-only-secret')) }, { highWaterMark: 0 })))
    await expect((await g.request()).text()).rejects.toMatchObject({ code: 'request_failed', message: 'Enterprise auth request failed (request_failed).' })
  })

  it('rejects redirects and cancels their bodies', async () => {
    const cancel = vi.fn()
    const f = fixture(async () => new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: 'https://other.example' } }))
    await expect(f.request()).rejects.toMatchObject({ code: 'redirect_rejected' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not let a stalled upstream cancellation block redirect rejection', async () => {
    const f = fixture(async () => new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { status: 302 }))
    await expect(f.request()).rejects.toMatchObject({ code: 'redirect_rejected' })
  })

  it.each([204, 205, 304])('preserves null-body status %s and releases its slot', async status => {
    const f = fixture(async () => new Response(null, { status, headers: { etag: 'cache-key' } }))
    const response = await f.request()
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
    expect(response.headers.get('etag')).toBe('cache-key')
    expect(f.audit).toHaveBeenCalledOnce()
  })

  it('enforces a streaming response byte cap', async () => {
    const f = fixture(async () => new Response(new ReadableStream({ start: stream => stream.enqueue(new Uint8Array(AUTH_MAX_RESPONSE_BYTES + 1)) })))
    await expect((await f.request()).arrayBuffer()).rejects.toMatchObject({ code: 'response_too_large', status: 413 })
  })

  it('times out pending headers even if the adapter ignores abort, then cancels a late response', async () => {
    vi.useFakeTimers()
    let resolve: ((response: Response) => void) | undefined
    const f = fixture(() => new Promise<Response>(done => { resolve = done }))
    const request = f.request()
    const rejected = expect(request).rejects.toMatchObject({ code: 'request_timeout', status: 504 })
    await vi.advanceTimersByTimeAsync(AUTH_HEADER_TIMEOUT_MS)
    await rejected
    const cancel = vi.fn()
    resolve?.(new Response(new ReadableStream({ cancel })))
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds idle stream lifetime, including bodies nobody consumes', async () => {
    vi.useFakeTimers()
    const f = fixture(async () => new Response(new ReadableStream({}, { highWaterMark: 0 })))
    const response = await f.request()
    await vi.advanceTimersByTimeAsync(AUTH_IDLE_TIMEOUT_MS)
    await expect(response.text()).rejects.toMatchObject({ code: 'request_timeout' })
    expect(f.audit).toHaveBeenCalledOnce()
  })

  it('bounds total stream lifetime even while chunks keep arriving', async () => {
    vi.useFakeTimers()
    const f = fixture(async () => new Response(new ReadableStream({ pull: stream => stream.enqueue(new Uint8Array([1])) }, { highWaterMark: 0 })))
    const reader = (await f.request()).body?.getReader()
    for (let elapsed = 0; elapsed < AUTH_TOTAL_TIMEOUT_MS - 30_000; elapsed += 30_000) {
      await reader?.read()
      await vi.advanceTimersByTimeAsync(30_000)
    }
    await reader?.read()
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(reader?.read()).rejects.toMatchObject({ code: 'request_timeout' })
  })
})
