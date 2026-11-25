import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnterpriseAuthClient, EnterpriseAuthError } from 'dsh-desktop-enterprise/auth'

const disposers = []
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); vi.useRealTimers() })
const connected = { connected: true, enterpriseId: 'tenant', userId: 'employee', sessionVersion: 'session-1' }
async function fixture(options = {}) {
  const transport = {
    state: vi.fn(async () => connected),
    request: vi.fn(async () => new Response('result'))
  }
  const client = await createEnterpriseAuthClient(transport, { pollIntervalMs: 0, ...options })
  disposers.push(() => client.dispose())
  return { client, transport }
}

describe('portable enterprise session reuse', () => {
  it('uses the host session for multiple plugins without starting SSO or exposing credentials', async () => {
    const first = await fixture(), second = await fixture()
    expect(first.client.getState()).toEqual(connected)
    first.transport.state.mockResolvedValue({ ...connected, access_token: 'private', refresh_token: 'private' })
    expect(await first.client.refresh()).toEqual(connected)
    const copy = first.client.getState(); copy.userId = 'forged'
    expect(first.client.getState().userId).toBe('employee')
    expect(await (await first.client.request('/api/business', { method: 'POST', body: 'input' })).text()).toBe('result')
    expect(first.transport.request).toHaveBeenCalledOnce()
    expect(first.transport.request).toHaveBeenCalledWith('/api/business', expect.objectContaining({ sessionVersion: 'session-1' }))
    expect(second.transport.request).not.toHaveBeenCalled()
    first.client.dispose()
    await expect(first.client.request('/api/business')).rejects.toMatchObject({ errorCode: 'authorization_denied' })
    expect(second.client.getState()).toEqual(connected)
  })

  it('shares concurrent state reads, notifies changes, and removes subscriptions', async () => {
    const { client, transport } = await fixture()
    const listener = vi.fn(), other = vi.fn()
    const unsubscribe = client.subscribe(listener)
    client.subscribe(other)
    let complete
    transport.state.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const a = client.refresh(), b = client.refresh()
    await Promise.resolve()
    expect(transport.state).toHaveBeenCalledTimes(2)
    complete({ ...connected, sessionVersion: 'session-2' })
    expect(await a).toEqual(await b)
    expect(listener).toHaveBeenCalledOnce()
    listener.mock.calls[0][0].userId = 'forged'
    expect(client.getState().userId).toBe('employee')
    unsubscribe()
    await client.refresh()
    expect(listener).toHaveBeenCalledOnce()
    expect(other).toHaveBeenCalledTimes(2)
  })

  it('fails closed on state errors and silently recovers from the host session', async () => {
    const { client, transport } = await fixture()
    const listener = vi.fn(); client.subscribe(listener)
    transport.state.mockRejectedValueOnce(new Error('host unavailable'))
    await expect(client.refresh()).rejects.toThrow('host unavailable')
    expect(client.getState()).toEqual({ connected: false, sessionVersion: 'session-1' })
    expect(await client.refresh()).toEqual(connected)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('aborts pending requests on an account change and never returns their late results', async () => {
    const { client, transport } = await fixture()
    let complete
    transport.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = client.request('/api/private')
    const signal = transport.request.mock.calls[0][1].signal
    transport.state.mockResolvedValue({ ...connected, userId: 'another', sessionVersion: 'session-2' })
    await client.refresh()
    expect(signal.aborted).toBe(true)
    complete(new Response('old account data'))
    await expect(pending).rejects.toMatchObject({ errorCode: 'session_changed' })
  })

  it('does not replay a business 401 or turn it into a login flow', async () => {
    const { client, transport } = await fixture()
    transport.request.mockResolvedValueOnce(new Response('denied', { status: 401 }))
    const response = await client.request('/api/mutation', { method: 'POST', body: 'once' })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('denied')
    expect(transport.request).toHaveBeenCalledOnce()
  })

  it('cleans up polling and ignores late state reads after disposal', async () => {
    vi.useFakeTimers()
    const { client, transport } = await fixture({ pollIntervalMs: 1000 })
    const listener = vi.fn(); client.subscribe(listener)
    let complete
    transport.state.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = client.refresh()
    await Promise.resolve()
    client.dispose(); client.dispose()
    complete({ ...connected, sessionVersion: 'late' })
    await expect(pending).rejects.toMatchObject({ errorCode: 'authorization_denied' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.state).toHaveBeenCalledTimes(2)
    expect(listener).not.toHaveBeenCalled()
    expect(() => client.getState()).toThrow(EnterpriseAuthError)
    await expect(client.refresh()).rejects.toMatchObject({ errorCode: 'authorization_denied' })
  })

  it('recovers when a host state adapter throws synchronously', async () => {
    const { client, transport } = await fixture()
    transport.state.mockImplementationOnce(() => { throw new Error('host restarting') })
    await expect(client.refresh()).rejects.toThrow('host restarting')
    expect(await client.refresh()).toEqual(connected)
  })

  it('rejects invalid host snapshots and polling configuration', async () => {
    const transport = { state: async () => ({ connected: true }), request: vi.fn() }
    await expect(createEnterpriseAuthClient(transport)).rejects.toMatchObject({ errorCode: 'request_failed' })
    await expect(createEnterpriseAuthClient(transport, { pollIntervalMs: -1 })).rejects.toMatchObject({ errorCode: 'invalid_request' })
  })
})
