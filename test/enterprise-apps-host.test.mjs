import { afterEach, expect, it, vi } from 'vitest'
import { resolveEnterpriseAppAccess, validateEnterpriseAppId, assertEnterprisePublicRequestPath } from '../packages/dsh-desktop-enterprise/enterprise-apps-host.js'
import { EnterpriseAuthError } from '../packages/dsh-desktop-enterprise/enterprise-auth-client.js'

const HOST_TOKEN = 'synthetic-host-secret'
const APP_TOKEN = 'synthetic.app.token'
const plugin = { pluginId: '1'.repeat(32), instanceId: 'plugin-instance-1' }
const tokenType = 'urn:ietf:params:oauth:token-type:access_token'
const context = { base: 'https://enterprise.example.test/company', userId: '12', tenantId: '34', sessionVersion: 'one' }
const appBaseUrl = 'https://apps.example.test/tenant/project-hub/'
const envelope = () => ({ issued_token_type: tokenType, token_type: 'Bearer', access_token: APP_TOKEN,
  expires_in: 300, scope: 'openid profile' })
function fixture(overrides = {}) {
  return { appId: 'project-hub', path: '/v1/me?view=summary', plugin, base: context.base, context,
    appBaseUrl, accessToken: HOST_TOKEN, assertCurrent: vi.fn(),
    fetchImpl: vi.fn(async () => Response.json(envelope())), ...overrides }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it.each([
  '/api/v1/oauth2/token', '/api/v1/oauth2/%74oken', '/api/v1/oauth2/./token',
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
it('exchanges only at the OAuth token endpoint and returns an app token with the path prefix intact', async () => {
  const options = fixture()
  const result = await resolveEnterpriseAppAccess(options)
  expect(result).toEqual({ endpoint: 'https://apps.example.test/tenant/project-hub/v1/me?view=summary', accessToken: APP_TOKEN })
  expect(JSON.stringify(result)).not.toContain(HOST_TOKEN)
  expect(options.fetchImpl).toHaveBeenCalledOnce()
  const [url, init] = options.fetchImpl.mock.calls[0]
  expect(url).toBe('https://enterprise.example.test/company/api/v1/oauth2/token')
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } })
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: HOST_TOKEN,
    subject_token_type: 'urn:bisheng:params:oauth:token-type:platform-session',
    requested_token_type: tokenType, audience: 'project-hub', scope: 'openid profile'
  })
  expect(options.assertCurrent.mock.calls.length).toBeGreaterThan(3)
})
it('has no cache and never dispatches application business requests itself', async () => {
  const options = fixture()
  await resolveEnterpriseAppAccess(options)
  await resolveEnterpriseAppAccess(options)
  expect(options.fetchImpl).toHaveBeenCalledTimes(2)
  expect(options.fetchImpl.mock.calls.every(([url]) => url.startsWith(options.base))).toBe(true)
})
it.each(['xpie', 'a', 'app-2', 'UPPER', 'a_b', 'a.b', 'urn:app:client', 'a'.repeat(128)])('accepts registry app identifier %s', value => {
  expect(validateEnterpriseAppId(value)).toBe(value)
})
it.each(['', 'with space', 'bad\nclient', '客户', 'a'.repeat(129), null, 1])('rejects invalid app identifier %s', async appId => {
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
it.each(['https:apps.example.test', 'https:///apps.example.test', 'https://@apps.example.test', 'https://user:pass@apps.example.test', 'https://apps.example.test/p?x=1',
  'https://apps.example.test/p#x', 'https://apps.example.test/a/../b', 'https://apps.example.test/%2e%2e/b',
  'https://apps.example.test/%252e%252e/b', 'https://apps.example.test/a%2fb', 'https://127.0.0.1', 'https://127.1',
  'https://2130706433', 'https://0x7f000001', 'https://0.0.0.0', 'https://169.254.169.254', 'https://100.100.100.200',
  'https://localhost', 'https://localhost.', 'https://service.localhost', 'https://metadata.google.internal',
  'https://[::]', 'https://[::1]', 'https://[fe80::1]', 'https://[::ffff:127.0.0.1]', 'https://[::127.0.0.1]', 'https://[64:ff9b::7f00:1]'])('rejects unsafe registry URL %s', async base_url => {
  const options = fixture({ appBaseUrl: base_url })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'request_failed', status: 502 })
  expect(options.fetchImpl).not.toHaveBeenCalled()
})
it.each(['https://10.0.0.2/apps/hub', 'https://[fd00::2]/apps/hub', 'https://apps.example.test:8443/apps/hub'])('accepts registered HTTPS URL %s', async base_url => {
  const options = fixture({ appBaseUrl: base_url })
  expect((await resolveEnterpriseAppAccess(options)).endpoint).toBe(base_url + options.path)
})
it.each([
  { issued_token_type: 'wrong' }, { token_type: 'MAC' }, { access_token: HOST_TOKEN }, { access_token: '' },
  { access_token: 'contains spaces' }, { expires_in: 0 }, { expires_in: 301 }, { expires_in: 1.5 }, { expires_in: '60' },
  { scope: '' }, { scope: 'openid' }, { scope: 'openid profile email admin' }, { scope: 'openid openid email' },
  { refresh_token: 'unexpected' }, { id_token: 'unexpected' }
])('rejects malformed envelope %j', async patch => {
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => Response.json({ ...envelope(), ...patch }) })))
    .rejects.toMatchObject({ errorCode: 'request_failed', status: 502 })
})
it.each([null, [], {}, { ...envelope(), scope: undefined }])('rejects absent envelope fields %j', async value => {
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => Response.json(value) }))).rejects.toMatchObject({ errorCode: 'request_failed' })
})
it.each([[400, 'authorization_denied', 400], [401, 'authorization_denied', 401], [403, 'authorization_denied', 403],
  [404, 'authorization_denied', 404], [429, 'authorization_denied', 429], [500, 'request_failed', 502], [503, 'request_failed', 502],
  [302, 'request_failed', 502]])('sanitizes HTTP %i and never replays', async (status, code, mappedStatus) => {
  const options = fixture({ fetchImpl: vi.fn(async () => new Response(HOST_TOKEN, { status })) })
  const error = await resolveEnterpriseAppAccess(options).catch(error => error)
  expect(error).toBeInstanceOf(EnterpriseAuthError)
  expect(error).toMatchObject({ errorCode: code, status: mappedStatus })
  expect(error.message).not.toContain(HOST_TOKEN)
  expect(options.fetchImpl).toHaveBeenCalledOnce()
})
it.each([400, 401, 403])('preserves an empty HTTP %i denial for host refresh handling', async status => {
  await expect(resolveEnterpriseAppAccess(fixture({ fetchImpl: async () => new Response(null, { status }) })))
    .rejects.toMatchObject({ errorCode: 'authorization_denied', status })
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
  Object.defineProperty(parsed, 'scope', { enumerable: true, get() { changed = true; return 'openid profile' } })
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
  Object.defineProperty(parsed, 'scope', { enumerable: true, get() { controller.abort(); return 'openid profile' } })
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


it('does not consult a local client list or environment registration', async () => {
  vi.stubEnv('BISHENG_ENTERPRISE_APPS', 'obsolete malformed configuration')
  const options = fixture({ appId: 'new-client' })
  await expect(resolveEnterpriseAppAccess(options)).resolves.toMatchObject({ accessToken: APP_TOKEN })
  expect(new URLSearchParams(options.fetchImpl.mock.calls[0][1].body).get('audience')).toBe('new-client')
})

it.each(['invalid_target', 'unauthorized_client', 'consent_required'])('preserves server authorization denial %s', async code => {
  const options = fixture({ appId: 'new-client', fetchImpl: vi.fn(async () => Response.json({ error: code, error_description: HOST_TOKEN }, { status: 400 })) })
  const error = await resolveEnterpriseAppAccess(options).catch(error => error)
  expect(error).toMatchObject({ errorCode: code, status: 400 })
  expect(error.message).not.toContain(HOST_TOKEN)
  expect(options.fetchImpl).toHaveBeenCalledOnce()
})

it.each(['http://192.168.10.20:3001', 'https://enterprise.example.test'])('accepts enterprise base %s without local registration', async base => {
  const options = fixture({ base, context: { ...context, base } })
  await expect(resolveEnterpriseAppAccess(options)).resolves.toMatchObject({ accessToken: APP_TOKEN })
  expect(options.fetchImpl.mock.calls[0][0]).toBe(base + '/api/v1/oauth2/token')
})

it.each(['http://192.168.10.21:8000/team', 'https://apps.example.test/team'])('routes to supplied service %s without a target registry', async appBaseUrl => {
  const options = fixture({ appBaseUrl })
  await expect(resolveEnterpriseAppAccess(options)).resolves.toMatchObject({ endpoint: appBaseUrl + options.path })
})

it('rejects missing routing data rather than sending a business path to BiSheng', async () => {
  const options = fixture({ appBaseUrl: undefined })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'invalid_request', status: 400 })
  expect(options.fetchImpl).not.toHaveBeenCalled()
})

it('reuses existing profile consent without implicitly requesting email', async () => {
  const fetchImpl = vi.fn(async (_url, init) => {
    const scope = new URLSearchParams(init.body).get('scope')
    return scope.split(' ').includes('email')
      ? Response.json({ error: 'consent_required' }, { status: 400 })
      : Response.json(envelope())
  })
  const options = fixture({ fetchImpl })
  await expect(resolveEnterpriseAppAccess(options)).resolves.toMatchObject({ accessToken: APP_TOKEN })
  expect(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get('scope')).toBe('openid profile')
  await expect(resolveEnterpriseAppAccess({ ...options, appScopes: ['openid', 'profile', 'email'] }))
    .rejects.toMatchObject({ errorCode: 'consent_required', status: 400 })
})

it('accepts email only when the application explicitly requests and receives it', async () => {
  const options = fixture({ appScopes: ['openid', 'profile', 'email'],
    fetchImpl: vi.fn(async () => Response.json({ ...envelope(), scope: 'openid profile email' })) })
  await expect(resolveEnterpriseAppAccess(options)).resolves.toMatchObject({ accessToken: APP_TOKEN })
  expect(new URLSearchParams(options.fetchImpl.mock.calls[0][1].body).get('scope')).toBe('openid profile email')
})

it('rejects an unsolicited email scope in a default identity response', async () => {
  const options = fixture({ fetchImpl: vi.fn(async () => Response.json({ ...envelope(), scope: 'openid profile email' })) })
  await expect(resolveEnterpriseAppAccess(options)).rejects.toMatchObject({ errorCode: 'request_failed' })
})
