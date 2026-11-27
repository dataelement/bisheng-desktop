import { afterEach, expect, it, vi } from 'vitest'
import { resolveEnterpriseAppAccess, validateEnterpriseAppId, assertEnterprisePublicRequestPath } from '../packages/dsh-desktop-enterprise/enterprise-apps-host.js'
import { EnterpriseAuthError } from '../packages/dsh-desktop-enterprise/enterprise-auth-client.js'

const HOST_TOKEN = 'synthetic-host-secret'
const APP_TOKEN = 'bapp_v1_' + 'a'.repeat(43)
const plugin = { pluginId: '1'.repeat(32), instanceId: 'plugin-instance-1' }
const envelope = () => ({ protocol_version: 1, app_id: 'project-hub', audience: 'urn:project-service',
  base_url: 'https://apps.example.test/tenant/project-hub/', token_type: 'Bearer', access_token: APP_TOKEN,
  expires_in: 60, scope: 'projects:read projects:write' })
function fixture(overrides = {}) {
  return { appId: 'project-hub', path: '/v1/me?view=summary', plugin, base: 'https://enterprise.example.test/company',
    accessToken: HOST_TOKEN, assertCurrent: vi.fn(), fetchImpl: vi.fn(async () => Response.json(envelope())), ...overrides }
}
afterEach(() => vi.useRealTimers())

it.each([
  '/api/v1/dsh/integrations', '/api/v1/dsh/integrations/', '/api/v1/dsh/integrations/app/delegations',
  '/api/v1/dsh/integrations/app/introspect?view=1', '/API/V1/DSH/INTEGRATIONS/app/delegations',
  '/api/v1/dsh/./integrations/app/delegations', '/api/v1/dsh/other/../integrations/app/delegations',
  '/api/v1/dsh/%69ntegrations/app/delegations', '/api/v1/dsh/%2569ntegrations/app/delegations',
  '/api%2fv1%2fdsh%2fintegrations%2fapp%2fdelegations', '/api%252fv1/dsh/integrations/app/delegations',
  '/api//v1///dsh/integrations/app/delegations', '/api/v1/dsh/integrations;ignored/app/delegations',
  '/api/v1/dsh/old/%252e%252e/integrations/app/delegations', '/api/v1/dsh/integrations%3fignored',
  '/api/v1/dsh/integrations%2523ignored', '/api/v1/dsh%5cintegrations/app/delegations'
])('blocks ordinary requests to host-only credential route %s', path => {
  expect(() => assertEnterprisePublicRequestPath(path)).toThrowError(expect.objectContaining({ errorCode: 'authorization_denied', status: 403 }))
})
it.each(['/api/v1/dsh/config', '/api/v1/dsh/xpie/delegations', '/api/v1/dsh/xpie/introspect',
  '/api/v1/dsh/integrations-extra', '/api/business?next=/api/v1/dsh/integrations/app/delegations', '/v1/me'])
  ('retains ordinary business and legacy Xpie request path %s', path => {
    expect(assertEnterprisePublicRequestPath(path)).toBeUndefined()
  })
it.each([null, 1, '', 'https://enterprise.example/api/v1/dsh/integrations/a/delegations', '//enterprise.example/path', '/%GG', '/api/%00'])
  ('fails closed on malformed public path %s', path => {
    expect(() => assertEnterprisePublicRequestPath(path)).toThrowError(expect.objectContaining({ errorCode: 'invalid_request', status: 400 }))
  })
it('exchanges only at the enterprise registry and returns an app token with the path prefix intact', async () => {
  const options = fixture()
  const result = await resolveEnterpriseAppAccess(options)
  expect(result).toEqual({ endpoint: 'https://apps.example.test/tenant/project-hub/v1/me?view=summary', accessToken: APP_TOKEN })
  expect(JSON.stringify(result)).not.toContain(HOST_TOKEN)
  expect(options.fetchImpl).toHaveBeenCalledOnce()
  const [url, init] = options.fetchImpl.mock.calls[0]
  expect(url).toBe('https://enterprise.example.test/company/api/v1/dsh/integrations/project-hub/delegations')
  expect(init).toMatchObject({ method: 'POST', body: '{}', redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { authorization: 'Bearer ' + HOST_TOKEN, 'x-dsh-plugin-id': plugin.pluginId, 'x-dsh-plugin-instance-id': plugin.instanceId } })
  expect(JSON.parse(init.body)).toEqual({})
  expect(options.assertCurrent.mock.calls.length).toBeGreaterThan(3)
})
it('has no cache and never dispatches application business requests itself', async () => {
  const options = fixture()
  await resolveEnterpriseAppAccess(options)
  await resolveEnterpriseAppAccess(options)
  expect(options.fetchImpl).toHaveBeenCalledTimes(2)
  expect(options.fetchImpl.mock.calls.every(([url]) => url.startsWith(options.base))).toBe(true)
})
it.each(['xpie', 'a', 'app-2', 'a'.repeat(64)])('accepts registry app identifier %s', value => {
  expect(validateEnterpriseAppId(value)).toBe(value)
})
it.each(['', 'UPPER', '-app', 'app-', 'a--b', 'app/id', 'https://a', 'a.b', 'a_b', 'a'.repeat(65), null, 1])('rejects invalid app identifier %s', async appId => {
  const options = fixture({ appId })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'invalid_request', status: 400 })
  expect(options.fetchImpl).not.toHaveBeenCalled()
})
it.each(['/../admin', '/a/./b', '/a/%2e%2e/b', '/%252e%252e/admin', '/a%2fb', '/a%5cb', '/%00', '//evil.test/a',
  'https://evil.test', '/a#fragment', '/a\\b', '/a?x=%0d%0aInjected', '/%GG'])('rejects traversal or nonrelative path %s', async path => {
  const options = fixture({ path })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'invalid_request' })
  expect(options.fetchImpl).not.toHaveBeenCalled()
})
it.each(['https:apps.example.test', 'https:///apps.example.test', 'https://@apps.example.test', 'http://apps.example.test/prefix', 'https://user:pass@apps.example.test', 'https://apps.example.test/p?x=1',
  'https://apps.example.test/p#x', 'https://apps.example.test/a/../b', 'https://apps.example.test/%2e%2e/b',
  'https://apps.example.test/%252e%252e/b', 'https://apps.example.test/a%2fb', 'https://127.0.0.1', 'https://127.1',
  'https://2130706433', 'https://0x7f000001', 'https://0.0.0.0', 'https://169.254.169.254', 'https://100.100.100.200',
  'https://localhost', 'https://localhost.', 'https://service.localhost', 'https://metadata.google.internal',
  'https://[::]', 'https://[::1]', 'https://[fe80::1]', 'https://[::ffff:127.0.0.1]', 'https://[::127.0.0.1]', 'https://[64:ff9b::7f00:1]'])('rejects unsafe registry URL %s', async base_url => {
  const options = fixture({ fetchImpl: vi.fn(async () => Response.json({ ...envelope(), base_url })) })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'request_failed', status: 502 })
  expect(options.fetchImpl).toHaveBeenCalledOnce()
})
it.each(['https://10.0.0.2/apps/hub', 'https://[fd00::2]/apps/hub', 'https://apps.example.test:8443/apps/hub'])('accepts registered HTTPS URL %s', async base_url => {
  const options = fixture({ fetchImpl: vi.fn(async () => Response.json({ ...envelope(), base_url })) })
  expect((await resolveEnterpriseAppAccess(options)).endpoint).toBe(base_url + options.path)
})
it.each([
  { protocol_version: 2 }, { protocol_version: '1' }, { app_id: 'other' }, { audience: '' }, { audience: 'a b' },
  { audience: 'a'.repeat(257) }, { token_type: 'bearer' }, { access_token: HOST_TOKEN }, { access_token: 'jwt.value.value' },
  { access_token: 'bapp_v1_' + 'a'.repeat(42) }, { expires_in: 0 }, { expires_in: 61 }, { expires_in: 1.5 }, { expires_in: '60' },
  { scope: '' }, { scope: ' one' }, { scope: 'one  two' }, { scope: 'one\ntwo' }, { scope: 'a'.repeat(2049) }, { secret: HOST_TOKEN }
])('rejects malformed envelope %j', async patch => {
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => Response.json({ ...envelope(), ...patch }) })))
    .rejects.toMatchObject({ errorCode: 'request_failed', status: 502 })
})
it.each([null, [], {}, { ...envelope(), scope: undefined }])('rejects absent envelope fields %j', async value => {
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => Response.json(value) }))).rejects.toMatchObject({ errorCode: 'request_failed' })
})
it.each([[400, 'authorization_denied', 400], [401, 'authorization_denied', 401], [403, 'authorization_denied', 403],
  [404, 'app_unavailable', 404], [429, 'authorization_denied', 429], [500, 'request_failed', 502], [503, 'request_failed', 502],
  [302, 'request_failed', 502]])('sanitizes HTTP %i and never replays', async (status, code, mappedStatus) => {
  const options = fixture({ fetchImpl: vi.fn(async () => new Response(HOST_TOKEN, { status })) })
  const error = await resolveEnterpriseAppAccess(options).catch(error => error)
  expect(error).toBeInstanceOf(EnterpriseAuthError)
  expect(error).toMatchObject({ errorCode: code, status: mappedStatus })
  expect(error.message).not.toContain(HOST_TOKEN)
  expect(options.fetchImpl).toHaveBeenCalledOnce()
})
it('sanitizes upstream parse and network failures', async () => {
  for (const fetchImpl of [async () => { throw Error(HOST_TOKEN) }, async () => new Response(HOST_TOKEN),
    async () => new Response(new Uint8Array([0xff]))]) {
    const error = await resolveEnterpriseAppAccess(fixture({ fetchImpl })).catch(error => error)
    expect(error).toMatchObject({ errorCode: 'request_failed' })
    expect(error.message).not.toContain(HOST_TOKEN)
  }
})
it('rejects oversized declared and chunked bodies', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': '65537' } }), new Response('x'.repeat(65537))]) {
    await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => response })))
      .rejects.toMatchObject({ errorCode: 'response_too_large', status: 413 })
  }
})
it('refuses session changes during reads and after envelope validation', async () => {
  let changed = false
  const response = Response.json(envelope())
  const getReader = response.body.getReader.bind(response.body)
  response.body.getReader = () => {
    const reader = getReader(), read = reader.read.bind(reader)
    reader.read = async () => { const result = await read(); if (result.done) changed = true; return result }
    return reader
  }
  const error = await resolveEnterpriseAppAccess(fixture({
    assertCurrent: () => { if (changed) throw new EnterpriseAuthError('session_changed', HOST_TOKEN, 409) },
    fetchImpl: async () => response
  })).catch(error => error)
  expect(error).toMatchObject({ errorCode: 'session_changed', status: 409 })
  expect(error.message).not.toContain(HOST_TOKEN)
  // Validate the final check without relying on an internal check count.
  const parsed = envelope()
  Object.defineProperty(parsed, 'base_url', { enumerable: true, get() { changed = true; return 'https://apps.example.test/prefix' } })
  changed = false
  const parse = vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed)
  try {
    await expect(resolveEnterpriseAppAccess(fixture({ assertCurrent: () => {
      if (changed) throw new EnterpriseAuthError('session_changed', HOST_TOKEN, 409)
    } }))).rejects.toMatchObject({ errorCode: 'session_changed' })
  } finally { parse.mockRestore() }
})
it('cancels before dispatch, during fetch and during body reads', async () => {
  const before = new AbortController(); before.abort()
  const options = fixture({ signal: before.signal })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'request_aborted' })
  expect(options.fetchImpl).not.toHaveBeenCalled()
  for (const stage of ['fetch', 'body']) {
    const controller = new AbortController()
    const fetchImpl = stage === 'fetch' ? () => { queueMicrotask(() => controller.abort()); return new Promise(() => {}) }
      : async () => new Response(new ReadableStream({ pull() { controller.abort(); return new Promise(() => {}) } }))
    await expect(resolveEnterpriseAppAccess(fixture({ signal: controller.signal, fetchImpl }))).rejects.toMatchObject({ errorCode: 'request_aborted', status: 499 })
  }
})
it('cancels unused bodies after a session switch or late fetch completion', async () => {
  const cancel = vi.fn()
  const response = new Response(new ReadableStream({ cancel }))
  let changed = false
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => { changed = true; return response },
    assertCurrent: () => { if (changed) throw new EnterpriseAuthError('session_changed', 'changed', 409) }
  }))).rejects.toMatchObject({ errorCode: 'session_changed' })
  expect(cancel).toHaveBeenCalledOnce()
  const controller = new AbortController()
  let finish
  const lateCancel = vi.fn()
  const pending = resolveEnterpriseAppAccess(fixture({ signal: controller.signal, fetchImpl: () => new Promise(resolve => { finish = resolve }) }))
  controller.abort()
  await expect(pending).rejects.toMatchObject({ errorCode: 'request_aborted' })
  finish(new Response(new ReadableStream({ cancel: lateCancel })))
  await Promise.resolve()
  expect(lateCancel).toHaveBeenCalledOnce()
})
it('cancels after parsing even when the session remains current', async () => {
  const controller = new AbortController(), parsed = envelope()
  Object.defineProperty(parsed, 'base_url', { enumerable: true, get() { controller.abort(); return 'https://apps.example.test/prefix' } })
  const parse = vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed)
  try {
    await expect(resolveEnterpriseAppAccess(fixture({ signal: controller.signal })))
      .rejects.toMatchObject({ errorCode: 'request_aborted' })
  } finally { parse.mockRestore() }
})
it('enforces a total deadline for fetch and stalled body reads', async () => {
  vi.useFakeTimers()
  // Node's AbortSignal.timeout uses native timers; drive the same deadline via this factory.
  const factory = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  })
  try {
    for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
      const pending = expect(resolveEnterpriseAppAccess(fixture({ fetchImpl }))).rejects.toMatchObject({ errorCode: 'request_timeout', status: 504 })
      await vi.advanceTimersByTimeAsync(15000)
      await pending
    }
  } finally { factory.mockRestore() }
})
