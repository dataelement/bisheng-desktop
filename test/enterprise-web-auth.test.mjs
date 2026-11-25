import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebEnterpriseAuth } from 'dsh-desktop-enterprise/auth-web-host'
import { parseToken } from '../packages/dsh-desktop-enterprise/contract.js'

const mounted = vi.hoisted(() => ({}))
vi.mock('../packages/dsh-desktop-enterprise/market.js', () => ({ applyEnterpriseMarket(ctx, account, options) { Object.assign(mounted, { account, auth: options.auth }); return { stop: vi.fn() } } }))
vi.mock('../packages/dsh-desktop-enterprise/workbench-market.js', () => ({ applyEnterpriseWorkbenchMarket: () => ({ stop: vi.fn() }) }))
vi.mock('../packages/dsh-desktop-enterprise/workbench-access.js', () => ({ applyEnterpriseWorkbenchAccess: () => ({}) }))
vi.mock('../packages/dsh-desktop-enterprise/workbench-install.js', () => ({ applyEnterpriseWorkbenchInstall() {} }))
vi.mock('../packages/dsh-desktop-enterprise/workbench-favorites.js', () => ({ applyWorkbenchFavorites() {} }))
import { apply } from '../packages/dsh-desktop-enterprise/index.js'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
const identity = { pluginId: 'a'.repeat(32), instanceId: 'plugin-one' }
const base = 'https://enterprise.example.test'
const user = { id: 'user-one', username: 'fixture', display_name: 'Fixture user' }, tenant = { id: 'tenant-one', name: 'Fixture tenant' }
function tokenReply() { return { token_type: 'Bearer', access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600, refresh_expires_in: 7200, session_id: 'session-one', session_expires_at: new Date(Date.now() + 7200000).toISOString(), user, tenant } }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function pluginFixture({ expired = false, sessionExpired = false, fetchImpl } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'enterprise-web-auth-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_DESKTOP_ENTERPRISE_BROKER_URL', '')
  vi.stubEnv('DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY', '')
  const tokens = parseToken(tokenReply(), base)
  if (expired) tokens.access_expires_at = new Date(0).toISOString()
  if (sessionExpired) tokens.session_expires_at = new Date(0).toISOString()
  const file = join(home, 'enterprise-session.json')
  await writeFile(file, JSON.stringify({ base, tokens, user, tenant }))
  const routes = new Map(), effects = []
  const fetchMock = vi.fn(fetchImpl ?? (async () => Response.json({ status_code: 200, data: [] })))
  vi.stubGlobal('fetch', fetchMock)
  const ctx = { connection: { fetch: { register(route) { routes.set(route.path, route) } } }, provide() {}, effect(fn) { effects.push(fn()) } }
  apply(ctx, {})
  cleanups.push(() => { for (const dispose of effects) dispose?.() })
  const route = async path => routes.get(path).fetch(new Request('http://host' + path, { method: 'POST', body: '{}' }))
  return { file, fetchMock, route, dispose: () => effects.forEach(dispose => dispose?.()), auth: mounted.auth, account: mounted.account }
}

it('wires standalone Web plugins to the signed-in host without a broker or login', async () => {
  const fixture = await pluginFixture()
  const transport = await fixture.auth.grant(identity)
  const state = await transport.state()
  expect(state).toMatchObject({ connected: true, userId: user.id, enterpriseId: tenant.id })
  const response = await transport.request('/api/plugin/data', { sessionVersion: state.sessionVersion })
  await response.text()
  const call = fixture.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/plugin/data'))
  expect(call[1].headers.get('authorization')).toBe('Bearer renewed-access')
  expect(call[1].headers.get('x-dsh-plugin-id')).toBe(identity.pluginId)
  expect(call[1].redirect).toBe('error')
  expect(fixture.fetchMock.mock.calls.some(([url]) => ['authorizations', 'login', '/v1/auth/'].some(path => String(url).includes(path)))).toBe(false)
  await fixture.auth.revoke(transport)
  await expect(transport.state()).rejects.toMatchObject({ errorCode: 'session_changed' })
})

it.each([['logout', 'headers'], ['dispose', 'headers'], ['logout', 'body'], ['dispose', 'body']])('does not revive a session after %s while awaiting token %s', async (mode, phase) => {
  const gate = deferred(), started = deferred()
  const fixture = await pluginFixture({ expired: true, fetchImpl: async url => {
    if (String(url).endsWith('/api/v1/dsh/token')) {
      if (phase === 'body') return { ok: true, json: () => { started.resolve(); return gate.promise } }
      started.resolve(); return gate.promise
    }
    return Response.json({ status_code: 200, data: [] })
  } })
  await started.promise
  const transport = await fixture.auth.grant(identity)
  const state = await transport.state()
  const pending = transport.request('/api/plugin/data', { sessionVersion: state.sessionVersion })
  const denied = expect(pending).rejects.toMatchObject({ errorCode: 'session_changed' })
  if (mode === 'logout') await fixture.route('/api/enterprise.logout')
  else fixture.dispose()
  gate.resolve(phase === 'body' ? tokenReply() : Response.json(tokenReply()))
  await denied
  await vi.waitFor(() => expect(fixture.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/dsh/token'))).toHaveLength(1))
  // Let the actual response parsing and refresh commit finish before inspecting disk.
  await new Promise(resolve => setImmediate(resolve))
  if (mode === 'logout') await expect(readFile(fixture.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  else expect(JSON.parse(await readFile(fixture.file, 'utf8')).tokens.access_expires_at).toBe(new Date(0).toISOString())
  expect(fixture.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/plugin/data'))).toBe(false)
})

it('does not authorize an expired enterprise session even while its access token is fresh', async () => {
  const fixture = await pluginFixture({ sessionExpired: true })
  await vi.waitFor(() => expect(fixture.account.state()).toMatchObject({ connected: false, phase: 'reauthRequired' }))
  await expect(fixture.auth.grant(identity)).rejects.toMatchObject({ errorCode: 'authorization_denied' })
  expect(fixture.fetchMock).not.toHaveBeenCalled()
})

it('shares proactive refresh across concurrent plugin requests and never replays a business 401', async () => {
  const gate = deferred(), started = deferred()
  const fixture = await pluginFixture({ expired: true, fetchImpl: async url => {
    if (String(url).endsWith('/api/v1/dsh/token')) { started.resolve(); return gate.promise }
    if (String(url).endsWith('/api/plugin/data')) return new Response('denied', { status: 401 })
    return Response.json({ status_code: 200, data: [] })
  } })
  await started.promise
  const transport = await fixture.auth.grant(identity), state = await transport.state()
  const requests = Array.from({ length: 4 }, () => transport.request('/api/plugin/data', { sessionVersion: state.sessionVersion }))
  gate.resolve(Response.json(tokenReply()))
  const responses = await Promise.all(requests)
  expect(responses.map(response => response.status)).toEqual(Array(4).fill(401))
  await Promise.all(responses.map(response => response.text()))
  expect(fixture.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/dsh/token'))).toHaveLength(1)
  expect(fixture.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/plugin/data'))).toHaveLength(4)
})

it.each(['base', 'user', 'tenant', 'session'])('does not adopt another disk %s after a rejected refresh', async field => {
  const gate = deferred(), started = deferred()
  const fixture = await pluginFixture({ expired: true, fetchImpl: async url => {
    if (String(url).endsWith('/api/v1/dsh/token')) { started.resolve(); return gate.promise }
    return Response.json({ status_code: 200, data: [] })
  } })
  await started.promise
  const disk = { base, user, tenant, tokens: parseToken(tokenReply(), base) }
  disk.tokens.refresh_token = 'other-refresh'
  if (field === 'base') disk.base = 'https://other.example.test'
  else if (field === 'session') disk.tokens.session_id = 'other-session'
  else disk[field] = { id: 'other', name: 'Other fixture' }
  await writeFile(fixture.file, JSON.stringify(disk))
  const transport = await fixture.auth.grant(identity), state = await transport.state()
  const pending = transport.request('/api/plugin/data', { sessionVersion: state.sessionVersion })
  const denied = expect(pending).rejects.toMatchObject({ errorCode: 'session_changed' })
  gate.resolve(Response.json({ error: { message: 'expired fixture refresh' } }, { status: 401 }))
  await denied
  expect(fixture.account.state()).toMatchObject({ connected: false, phase: 'reauthRequired' })
  expect(fixture.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/plugin/data'))).toBe(false)
})

it.each(['user', 'tenant'])('invalidates grants when token refresh changes %s identity', async field => {
  const gate = deferred(), started = deferred()
  const fixture = await pluginFixture({ expired: true, fetchImpl: async url => {
    if (String(url).endsWith('/api/v1/dsh/token')) { started.resolve(); return gate.promise }
    return Response.json({ status_code: 200, data: [] })
  } })
  await started.promise
  const transport = await fixture.auth.grant(identity), state = await transport.state()
  const pending = transport.request('/api/plugin/data', { sessionVersion: state.sessionVersion })
  const denied = expect(pending).rejects.toMatchObject({ errorCode: 'session_changed' })
  const reply = tokenReply()
  reply[field] = { ...reply[field], id: 'other' }
  gate.resolve(Response.json(reply))
  await denied
  expect(fixture.account.state()).toMatchObject({ connected: false, phase: 'reauthRequired' })
  expect(JSON.parse(await readFile(fixture.file, 'utf8'))[field].id).not.toBe('other')
  expect(fixture.fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/plugin/data'))).toBe(false)
})

it.each(['revoke', 'invalidate', 'cancel'])('errors an in-flight body and cleans up on %s', async action => {
  let upstreamCancelled = false
  const account = { connected: true, connectionKey: 'one', user, tenant }
  const auth = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: async () => ({ base, user, tenant, tokens: { access_token: 'fixture' } }), fetchImpl: async () => new Response(new ReadableStream({ cancel() { upstreamCancelled = true } })) })
  const transport = await auth.grant(identity)
  const controller = new AbortController()
  const response = await transport.request('/api/stream', { sessionVersion: 'one', signal: controller.signal })
  const body = response.text()
  const denied = expect(body).rejects.toMatchObject({ errorCode: action === 'revoke' ? 'authorization_denied' : action === 'invalidate' ? 'session_changed' : 'request_aborted' })
  if (action === 'revoke') await auth.revoke(transport)
  else if (action === 'invalidate') auth.invalidate()
  else controller.abort()
  await denied
  expect(upstreamCancelled).toBe(true)
  auth.invalidate()
})

it.each(['base', 'user', 'tenant'])('rejects credentials from a different %s despite a stable connection key', async field => {
  const account = { connected: true, connectionKey: 'one', base, user, tenant }
  const session = { base, user, tenant, tokens: { access_token: 'fixture' } }
  session[field] = field === 'base' ? 'https://other.example.test' : { id: 'other' }
  const fetchImpl = vi.fn()
  const auth = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: async () => session, fetchImpl })
  const transport = await auth.grant(identity)
  await expect(transport.request('/api/test', { sessionVersion: 'one' })).rejects.toMatchObject({ errorCode: 'session_changed' })
  expect(fetchImpl).not.toHaveBeenCalled()
  auth.invalidate()
})

it('preserves per-instance and global stream quotas and releases capacity after revocation', async () => {
  const account = { connected: true, connectionKey: 'one', base, user, tenant }
  const auth = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: async () => ({ base, user, tenant, tokens: { access_token: 'fixture' } }), fetchImpl: async () => new Response(new ReadableStream()) })
  const first = await auth.grant(identity)
  const second = await auth.grant({ ...identity, instanceId: 'two' })
  const third = await auth.grant({ ...identity, instanceId: 'three' })
  await expect(auth.grant(identity)).rejects.toMatchObject({ errorCode: 'invalid_request', status: 409 })
  const open = transport => Promise.all(Array.from({ length: 4 }, () => transport.request('/api/stream', { sessionVersion: 'one' })))
  const firstResponses = await open(first)
  await expect(first.request('/api/stream', { sessionVersion: 'one' })).rejects.toMatchObject({ errorCode: 'too_many_requests' })
  const secondResponses = await open(second)
  await expect(third.request('/api/stream', { sessionVersion: 'one' })).rejects.toMatchObject({ errorCode: 'too_many_requests' })
  await auth.revoke(first)
  const replacement = await third.request('/api/stream', { sessionVersion: 'one' })
  auth.invalidate()
  for (const response of [...firstResponses, ...secondResponses, replacement]) await response.text().catch(() => {})
})

it('caps grants and makes revoked slots available again', async () => {
  const account = { connected: true, connectionKey: 'one', base, user, tenant }
  const auth = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: vi.fn() })
  const transports = []
  for (let i = 0; i < 256; i++) transports.push(await auth.grant({ ...identity, instanceId: 'instance-' + i }))
  await expect(auth.grant({ ...identity, instanceId: 'overflow' })).rejects.toMatchObject({ errorCode: 'too_many_requests' })
  await auth.revoke(transports[0])
  await expect(auth.grant({ ...identity, instanceId: 'replacement' })).resolves.toBeDefined()
  auth.invalidate()
})

it('refuses account changes during credential lookup and rejects unsafe targets and headers', async () => {
  const gate = deferred(), fetchImpl = vi.fn()
  let account = { connected: true, connectionKey: 'one', user, tenant }
  const auth = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: () => gate.promise, fetchImpl })
  const transport = await auth.grant(identity)
  for (const path of ['https://attacker.invalid', '//attacker.invalid', '/foo\\bar']) await expect(transport.request(path, { sessionVersion: 'one' })).rejects.toMatchObject({ errorCode: 'invalid_request' })
  await expect(transport.request('/api/test', { sessionVersion: 'one', headers: { authorization: 'forged' } })).rejects.toMatchObject({ errorCode: 'invalid_request' })
  const pending = transport.request('/api/test', { sessionVersion: 'one' })
  account = { ...account, connectionKey: 'two' }
  gate.resolve({ base, tokens: { access_token: 'other-account' } })
  await expect(pending).rejects.toMatchObject({ errorCode: 'session_changed' })
  expect(fetchImpl).not.toHaveBeenCalled()
  auth.invalidate()
})
