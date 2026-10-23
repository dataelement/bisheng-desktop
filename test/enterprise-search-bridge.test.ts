import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startEnterpriseCredentialBroker } from '../src/main/enterprise/credential-broker'
import { EnterpriseService } from '../src/main/enterprise/enterprise-service'
import { SecureEnterpriseCredentialVault } from '../src/main/enterprise/secure-credential-vault'

// Historical filename: these are generic broker tests, not a host search service.
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized deferred promise') }
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const unexpected = (): never => { throw new Error('Private platform dependency accessed') }
  const service = new EnterpriseService({
    vault: new SecureEnterpriseCredentialVault(join(tmpdir(), 'broker-' + randomUUID() + '.json'), {
      isEncryptionAvailable: () => false, encryptString: unexpected, decryptString: unexpected
    }), fetchImpl: unexpected, allowInsecureLoopback: false
  })
  cleanups.push(() => service.stop())
  const state = { connected: true, enterpriseId: 'tenant-a', userId: 'user-a', sessionVersion: 'session-a' }
  vi.spyOn(service, 'authState').mockImplementation(() => ({ ...state }))
  const authRequest = vi.spyOn(service, 'authRequest').mockImplementation(async () => Response.json({ result: 'business result' }))
  const broker = await startEnterpriseCredentialBroker(service)
  cleanups.push(() => broker.stop())
  const call = (path: string, capability: string, body?: unknown) => fetch(broker.url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + capability, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const grant = async (instanceId: string, pluginId = 'sample-plugin') => {
    const response = await call('/v1/auth/grant', broker.capability, { pluginId, instanceId })
    expect(response.status).toBe(200)
    return (await response.json() as { capability: string }).capability
  }
  const input = { path: '/business/example', method: 'POST', body: 'example', sessionVersion: state.sessionVersion }
  return { state, authRequest, broker, call, grant, input }
}

describe('generic enterprise auth broker', () => {
  it('binds owner-minted capabilities to distinct plugin instances', async () => {
    const { broker, call, grant, authRequest, input } = await fixture()
    const first = await grant('instance-one'), second = await grant('instance-two')
    expect(first).not.toBe(second)
    expect(first).not.toBe(broker.capability)
    for (const [capability, instanceId] of [[first, 'instance-one'], [second, 'instance-two']] as const) {
      const response = await call('/v1/auth/request', capability, input)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ result: 'business result' })
      expect(authRequest).toHaveBeenLastCalledWith({ pluginId: 'sample-plugin', instanceId }, input, expect.any(AbortSignal))
    }
    expect((await call('/v1/auth/grant', broker.capability, { pluginId: 'other', instanceId: 'instance-one' })).status).toBe(409)
    await call('/v1/auth/revoke', broker.capability, { capability: first })
    expect((await call('/v1/auth/state', first)).status).toBe(403)
    expect((await call('/v1/auth/state', second)).status).toBe(200)
  })

  it('separates owner management from plugin business requests', async () => {
    const { broker, call, grant, authRequest, input } = await fixture()
    const capability = await grant('instance-one')
    for (const response of [
      await call('/v1/auth/request', broker.capability, input),
      await call('/v1/auth/state', broker.capability),
      await call('/v1/auth/grant', capability, { pluginId: 'other', instanceId: 'forged' }),
      await call('/v1/auth/revoke', capability, { capability })
    ]) {
      expect(response.status).toBe(403)
      expect(response.headers.get('x-dsh-enterprise-error')).toBe('authorization_denied')
    }
    expect(authRequest).not.toHaveBeenCalled()
    expect((await call('/v1/auth/state', capability)).status).toBe(200)
  })

  it('returns public auth state without credentials or broker keys', async () => {
    const { state, broker, call, grant } = await fixture()
    const capability = await grant('instance-one')
    const response = await call('/v1/auth/state', capability)
    const publicState: unknown = await response.json()
    expect(publicState).toEqual(state)
    const text = JSON.stringify(publicState)
    expect(text).not.toContain(capability)
    expect(text).not.toContain(broker.capability)
    expect(text).not.toMatch(/access.?token|refresh.?token|authorization|secret|credential/i)
  })

  it('preserves binary HTTP 422 responses and response metadata', async () => {
    const { call, grant, authRequest, input } = await fixture()
    const capability = await grant('instance-one')
    const bytes = Uint8Array.from([0, 255, 128, 13, 10])
    authRequest.mockResolvedValueOnce(new Response(bytes, { status: 422, headers: { 'content-type': 'application/octet-stream', 'x-request-id': 'fixture-422' } }))
    const binaryInput = { ...input, body: Buffer.from(bytes).toString('base64'), bodyEncoding: 'base64' }
    const response = await call('/v1/auth/request', capability, binaryInput)
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('x-request-id')).toBe('fixture-422')
    expect(response.headers.has('x-dsh-enterprise-error')).toBe(false)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(authRequest.mock.calls[0]?.[1]).toEqual(binaryInput)
  })

  it('aborts revoked in-flight requests and drops late responses', async () => {
    const { broker, call, grant, authRequest, input } = await fixture()
    const capability = await grant('instance-one')
    const gate = deferred<Response>()
    authRequest.mockImplementationOnce(async () => gate.promise)
    const pending = call('/v1/auth/request', capability, input)
    await vi.waitFor(() => expect(authRequest).toHaveBeenCalledOnce())
    const signal = authRequest.mock.calls[0]?.[2]
    await call('/v1/auth/revoke', broker.capability, { capability })
    expect(signal?.aborted).toBe(true)
    gate.resolve(Response.json({ privateLateResult: true }))
    const response = await pending
    expect(response.status).toBe(403)
    expect(response.headers.get('x-dsh-enterprise-error')).toBe('authorization_denied')
    expect(await response.text()).not.toContain('privateLateResult')
    expect((await call('/v1/auth/request', capability, input)).status).toBe(403)
    expect(authRequest).toHaveBeenCalledOnce()
  })

  it('drops late stream chunks after revocation', async () => {
    const { broker, call, grant, authRequest, input } = await fixture()
    const capability = await grant('instance-one')
    let source: ReadableStreamDefaultController<Uint8Array> | undefined
    authRequest.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller } })))
    const response = await call('/v1/auth/request', capability, input)
    const outcome = response.text().then(value => ({ value }), () => ({ failed: true }))
    await call('/v1/auth/revoke', broker.capability, { capability })
    source?.enqueue(new TextEncoder().encode('late private chunk'))
    source?.close()
    expect(await outcome).toEqual({ failed: true })
  })

  it('returns 404 for the removed search-specific broker route', async () => {
    const { broker, call, authRequest } = await fixture()
    expect((await call('/v1/search', broker.capability, { query: 'obsolete', model: 'obsolete' })).status).toBe(404)
    expect(authRequest).not.toHaveBeenCalled()
  })
})
