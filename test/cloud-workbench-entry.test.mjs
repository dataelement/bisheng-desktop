import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const code = await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8')
function catalogService(request) {
  let Workbenches
  vm.runInNewContext(code, {
    window: { dshDesktopEnterprise: { cloudRequest: request }, __ModuleLoader__: { load({ factory }) {
      Workbenches = factory(name => name === 'react' ? { Component: class {}, createElement() {} }
        : name === '@deepseek-ai/cordis' ? { Service: { tracker: Symbol() } } : { Switch() {} }).Workbenches
    } } }, setTimeout, clearTimeout, AbortController
  })
  return Object.assign(Object.create(Workbenches.prototype), {
    cloudCatalog: [], cloudCatalogStatus: 'idle', cloudCatalogError: '', cloudAccountKey: '', cloudTicket: 0,
    disposed: false, publish: vi.fn()
  })
}
const account = { connected: true, connectionKey: 'a'.repeat(16) }
const page = items => ({ items, connectionKey: account.connectionKey, next_cursor: null })

it('uses the existing account, paginates and coalesces reads without another sign-in', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ...page([{ id: 'a', name: 'One' }]), next_cursor: 'next' })
    .mockResolvedValueOnce(page([{ id: 'b', name: 'Two' }]))
  const service = catalogService(request)
  await service.refreshCloudCatalog({ connected: false })
  expect(request).not.toHaveBeenCalled()
  const pending = service.refreshCloudCatalog(account)
  expect(service.refreshCloudCatalog(account)).toBe(pending)
  await pending
  expect(request.mock.calls.map(call => call[0])).toEqual([
    { operation: 'list', managed: false, cursor: null }, { operation: 'list', managed: false, cursor: 'next' }
  ])
  expect(service.cloudCatalog.map(item => item.name)).toEqual(['One', 'Two'])
  expect(service.cloudCatalogStatus).toBe('ready')
})

it('discards the previous account response and clears visible rows immediately on sign-out', async () => {
  let resolve
  const service = catalogService(vi.fn(() => new Promise(done => { resolve = done })))
  const pending = service.refreshCloudCatalog(account)
  service.cloudCatalog = [{ id: 'cached' }]
  await service.refreshCloudCatalog({ connected: false })
  expect(service.cloudCatalog).toEqual([])
  resolve(page([{ id: 'stale' }]))
  await pending
  expect(service.cloudCatalog).toEqual([])
  expect(service.cloudCatalogStatus).toBe('idle')
})

it('reports an unsupported cloud API separately and can refresh after recovery', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('enterprise-cloud:request CLOUD_WORKBENCH_API_UNAVAILABLE'))
    .mockResolvedValueOnce(page([]))
  const service = catalogService(request)
  await service.refreshCloudCatalog(account)
  expect(service.cloudCatalogError).toBe('unavailable')
  expect(service.cloudCatalogStatus).toBe('error')
  await service.refreshCloudCatalog(account)
  expect(service.cloudCatalogError).toBe('')
  expect(service.cloudCatalogStatus).toBe('empty')
})

it('refuses mixed-account pages or a repeated cursor without publishing partial data', async () => {
  for (const mode of ['account', 'cursor']) {
    const request = vi.fn().mockResolvedValueOnce({ ...page([{ id: 'first' }]), next_cursor: 'next' })
      .mockResolvedValueOnce({ ...page([{ id: 'second' }]), ...(mode === 'account' ? { connectionKey: 'b'.repeat(16) } : { next_cursor: 'next' }) })
    const service = catalogService(request)
    await service.refreshCloudCatalog(account)
    expect(service.cloudCatalog).toEqual([])
    expect(service.cloudCatalogError).toBe('failed')
  }
})

it('keeps loaded cloud entrances private to the current account without deleting them', () => {
  const service = catalogService(vi.fn())
  service.state = { active: 'cloud:old:one', cloudWorkbenches: {
    'cloud:old:one': { connectionKey: 'a'.repeat(16), appId: 'one', title: 'First account' },
    'cloud:new:two': { connectionKey: 'b'.repeat(16), appId: 'two', title: 'Second account' }
  } }
  service.cloudEntryAccountKey = 'a'.repeat(16)
  service.catalog = new Map(service.cloudEntries().map(item => [item.id, item]))
  service.providers = new Map()
  service.knownProviders = {}
  service.syncCloudIdentity('b'.repeat(16))
  expect(service.cloudEntries().map(item => item.appId)).toEqual(['two'])
  expect(service.state.active).toBeNull()
  expect(Object.keys(service.state.cloudWorkbenches)).toHaveLength(2)
  service.syncCloudIdentity(null)
  expect(service.cloudEntries()).toEqual([])
  service.syncCloudIdentity('a'.repeat(16))
  expect(service.cloudEntries().map(item => item.appId)).toEqual(['one'])
})
