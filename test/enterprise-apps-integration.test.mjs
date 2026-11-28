import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createEnterpriseAuthClient } from 'dsh-desktop-enterprise/auth'
import { createEnterpriseAuthTransport } from 'dsh-desktop-enterprise/auth-host'
import { createWebEnterpriseAuth } from 'dsh-desktop-enterprise/auth-web-host'
import { EnterpriseService } from '../packages/dsh-desktop-enterprise/desktop/enterprise-service'
import { SecureEnterpriseCredentialVault } from '../packages/dsh-desktop-enterprise/desktop/secure-credential-vault'
import { startEnterpriseCredentialBroker } from '../packages/dsh-desktop-enterprise/desktop/credential-broker'

const cleanup = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const base = 'https://enterprise.example.test'
const appBase = 'https://apps.example.test/mounted/xpie'
const opaque = 'synthetic.app.token'
const plugin = { pluginId: 'a'.repeat(32), instanceId: 'test-instance' }
const user = { id: '12', username: 'fixture', display_name: 'Fixture' }, tenant = { id: '34', name: 'Fixture tenant' }
const expiry = () => new Date(Date.now() + 3600000).toISOString()
const envelope = () => ({ issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', access_token: opaque, expires_in: 300, scope: 'openid profile' })

async function fixture(mode) {
  let exchangeStatus = 200, businessStatus = 200, businessStream, exchangeGate
  const calls = []
  const fetchImpl = vi.fn(async (input, init = {}) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/oauth2/token')) {
      calls.push({ kind: 'exchange', url: url.href, init })
      if (exchangeGate) await exchangeGate
      return exchangeStatus === 200 ? Response.json(envelope()) : new Response('private backend error', { status: exchangeStatus })
    }
    if (url.origin === new URL(appBase).origin) {
      calls.push({ kind: 'business', url: url.href, init })
      return new Response(businessStream ?? 'business result', { status: businessStatus, headers: { 'x-request-id': 'public-trace', 'set-cookie': 'not-for-plugins' } })
    }
    if (url.pathname.endsWith('/config')) return Response.json({ enabled: true, client_id: 'dsh-desktop', contract_version: '0.5.0' })
    return Response.json({ models: [], status_code: 200, data: [] })
  })
  let transport, revoke, logout
  if (mode === 'web') {
    const account = { connected: true, connectionKey: 'generation-one', base, user, tenant }
    const host = createWebEnterpriseAuth({ getAccount: () => account, getSessionAuth: async () => ({ base, user, tenant, tokens: { access_token: 'synthetic-host-secret' } }), fetchImpl })
    transport = await host.grant(plugin)
    revoke = () => host.revoke(transport)
    logout = async () => { account.connected = false; host.invalidate() }
    cleanup.push(() => host.invalidate())
  } else {
    const directory = await mkdtemp(join(tmpdir(), 'enterprise-apps-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const vault = new SecureEnterpriseCredentialVault(join(directory, 'vault.json'), {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
      encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString()
    })
    await vault.replace((await vault.read()).generation, { base, access_token: 'synthetic-host-secret', access_expires_at: expiry(), refresh_token: 'synthetic-refresh', refresh_expires_at: expiry(), session_id: 'parent-session', session_expires_at: expiry(), user, tenant })
    const service = new EnterpriseService({ vault, fetchImpl, cloudRoot: join(directory, 'cloud') })
    cleanup.push(() => service.stop())
    await service.restore()
    expect(service.authState().connected).toBe(true)
    const broker = await startEnterpriseCredentialBroker(service)
    cleanup.push(() => broker.stop())
    const grant = await fetch(broker.url + '/v1/auth/grant', { method: 'POST', headers: { authorization: 'Bearer ' + broker.capability, 'content-type': 'application/json' }, body: JSON.stringify(plugin) })
    expect(grant.status).toBe(200)
    const { capability } = await grant.json()
    transport = createEnterpriseAuthTransport(broker.url, capability)
    revoke = async () => { await fetch(broker.url + '/v1/auth/revoke', { method: 'POST', headers: { authorization: 'Bearer ' + broker.capability, 'content-type': 'application/json' }, body: JSON.stringify({ capability }) }) }
    logout = () => service.logout()
  }
  const client = await createEnterpriseAuthClient(transport, { pollIntervalMs: 0 })
  cleanup.push(() => client.dispose())
  return { client, calls, revoke, logout,
    status: (exchange, business) => { exchangeStatus = exchange; businessStatus = business },
    stream: value => { businessStream = value },
    gate: value => { exchangeGate = value }
  }
}

for (const mode of ['desktop', 'web']) describe(mode + ' enterprise application access', () => {
  it('exchanges host credentials and sends only app credentials to a prefix-preserving target', async () => {
    const { client, calls } = await fixture(mode)
    const app = client.app('xpie', { baseUrl: appBase })
    expect(Object.keys(app).sort()).toEqual(['appId', 'request'])
    const response = await app.request('/v1/me?view=full')
    expect(await response.text()).toBe('business result')
    expect(response.headers.get('set-cookie')).toBe(null)
    expect(calls.map(call => call.kind)).toEqual(['exchange', 'business'])
    expect(calls[0].url).toBe(base + '/api/v1/oauth2/token')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(null)
    expect(new URLSearchParams(calls[0].init.body).get('subject_token')).toBe('synthetic-host-secret')
    expect(new URLSearchParams(calls[0].init.body).get('audience')).toBe('xpie')
    expect(calls[1].url).toBe(appBase + '/v1/me?view=full')
    expect(new Headers(calls[1].init.headers).get('authorization')).toBe('Bearer ' + opaque)
    expect(calls[1].init).toMatchObject({ redirect: 'error', credentials: 'omit' })
    expect(JSON.stringify(client.getState())).not.toContain('secret')
  })

  it('keeps binary offsets exact and does not cache app credentials or replay business 401', async () => {
    const f = await fixture(mode)
    f.status(200, 401)
    const data = new Uint8Array([99, 0, 255, 88])
    for (let i = 0; i < 2; i++) {
      const response = await f.client.app('xpie', { baseUrl: appBase }).request('/v1/upload', { method: 'POST', body: data.subarray(1, 3) })
      expect(response.status).toBe(401)
      await response.text()
    }
    expect(f.calls.filter(call => call.kind === 'exchange')).toHaveLength(2)
    const business = f.calls.filter(call => call.kind === 'business')
    expect(business).toHaveLength(2)
    expect([...business[0].init.body]).toEqual([0, 255])
  })

  it('rejects redirects returned by an application without following them', async () => {
    const f = await fixture(mode)
    f.status(200, 302)
    await expect(f.client.app('xpie', { baseUrl: appBase }).request('/v1/redirect')).rejects.toMatchObject({ errorCode: 'redirect_rejected' })
    expect(f.calls.map(call => call.kind)).toEqual(['exchange', 'business'])
  })

  it('fails closed when the backend has not enabled app access', async () => {
    const f = await fixture(mode)
    f.status(403, 200)
    await expect(f.client.app('xpie', { baseUrl: appBase }).request('/v1/me')).rejects.toMatchObject({ errorCode: 'authorization_denied' })
    expect(f.calls.map(call => call.kind)).toEqual(['exchange'])
  })

  it('rejects forged identity headers and absolute targets before exchanging credentials', async () => {
    const f = await fixture(mode)
    await expect(f.client.app('xpie', { baseUrl: appBase }).request('https://other.example.test/v1/me')).rejects.toMatchObject({ errorCode: 'invalid_request' })
    await expect(f.client.app('xpie', { baseUrl: appBase }).request('/v1/me', { headers: { 'x-dsh-plugin-id': 'forged' } })).rejects.toMatchObject({ errorCode: 'invalid_request' })
    expect(f.calls).toEqual([])
  })

  it('does not expose application credentials through ordinary enterprise requests', async () => {
    const f = await fixture(mode)
    for (const path of ['/api/v1/oauth2/token', '/api/v1/oauth2/%74oken', '/api/v1/dsh/integrations/xpie/delegations', '/api/v1/dsh/%69ntegrations/xpie/introspect']) {
      await expect(f.client.request(path, { method: 'POST', body: '{}' })).rejects.toMatchObject({ errorCode: 'authorization_denied', status: 403 })
    }
    expect(f.calls).toEqual([])
  })

  it('aborts app streams when the authorized plugin is revoked', async () => {
    const f = await fixture(mode)
    f.stream(new ReadableStream({ pull() {} }, { highWaterMark: 0 }))
    const response = await f.client.app('xpie', { baseUrl: appBase }).request('/v1/events')
    const body = response.text()
    const rejected = expect(body).rejects.toBeDefined()
    await f.revoke()
    await rejected
    await expect(f.client.app('xpie', { baseUrl: appBase }).request('/v1/me')).rejects.toBeDefined()
  })

  it('does not dispatch a late app exchange after logout', async () => {
    const f = await fixture(mode)
    let release
    f.gate(new Promise(resolve => { release = resolve }))
    const pending = f.client.app('xpie', { baseUrl: appBase }).request('/v1/me')
    const rejected = expect(pending).rejects.toBeDefined()
    await vi.waitFor(() => expect(f.calls.filter(call => call.kind === 'exchange')).toHaveLength(1))
    await f.logout()
    release()
    await rejected
    expect(f.calls.some(call => call.kind === 'business')).toBe(false)
  })
})

it('never falls back to an enterprise-origin request on an older custom transport', async () => {
  const request = vi.fn()
  const client = await createEnterpriseAuthClient({ state: async () => ({ connected: true, sessionVersion: 'one' }), request }, { pollIntervalMs: 0 })
  cleanup.push(() => client.dispose())
  await expect(client.app('xpie', { baseUrl: appBase }).request('/v1/me')).rejects.toMatchObject({ errorCode: 'app_unavailable' })
  expect(request).not.toHaveBeenCalled()
  expect(() => client.app('invalid client')).toThrow()
})
