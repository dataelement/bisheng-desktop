import { expect, it, vi } from 'vitest'
import { applyCloudBrowse, cloudLaunch, parseCloudBrowse } from '../packages/dsh-desktop-enterprise/cloud-browse.js'
import { readCloudCatalog } from '../packages/dsh-desktop-enterprise/cloud-collection-client.js'
const id = 'a'.repeat(32)
it('validates launch paths and retains the configured reverse proxy prefix', () => {
  const payload = { slug: 'board', ticket: 'a'.repeat(43), launch_path: '/apps/board/_desktop', entry_path: '/apps/board/' }
  expect(cloudLaunch(payload, 'https://enterprise.test/private/', id, 'account').launchUrl).toBe('https://enterprise.test/private/apps/board/_desktop')
  expect(() => cloudLaunch({ ...payload, launch_path: 'https://other.test' }, 'https://enterprise.test', id, 'account')).toThrow()
  expect(() => parseCloudBrowse({ operation: 'launch', appId: id, workspaceRoot: '/tmp' })).toThrow()
})
it('rejects a launch result after the account changes', async () => {
  let route, key = 'first'
  applyCloudBrowse({ connection: { fetch: { register: value => { route = value } } } }, { state: () => ({ connected: true, connectionKey: key }) }, async () => { key = 'second'; return { ticket: 'secret' } })
  const response = await route.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ operation: 'launch', appId: id }) }))
  expect(response.status).toBe(409)
  expect(await response.text()).not.toContain('secret')
})
it('paginates and deduplicates cloud apps without dropping later pages', async () => {
  const request = vi.fn().mockResolvedValueOnce({ connectionKey: 'key', items: [{ id, name: 'Board' }], next_cursor: id }).mockResolvedValueOnce({ connectionKey: 'key', items: [{ id, name: 'Updated board' }] })
  expect(await readCloudCatalog(request)).toEqual({ data: [{ id, name: 'Updated board', displayName: 'Updated board' }], accountKey: 'key' })
  expect(request.mock.calls[1][1]).toEqual({ operation: 'list', cursor: id })
})
it('refuses catalog pagination across accounts and repeating cursors', async () => {
  const request = vi.fn().mockResolvedValueOnce({ connectionKey: 'a', items: [], next_cursor: id }).mockResolvedValueOnce({ connectionKey: 'b', items: [] })
  await expect(readCloudCatalog(request)).rejects.toThrow('account changed')
  await expect(readCloudCatalog(async () => ({ connectionKey: 'a', items: [], next_cursor: id }))).rejects.toThrow('Repeated')
})

it('retains enterprise favorites when the cloud source is unavailable but fails closed on identity changes', async () => {
  const { readCombinedCatalog } = await import('../packages/dsh-desktop-enterprise/cloud-collection-client.js')
  const request = vi.fn(async path => {
    if (path.endsWith('/catalog')) return { accountKey: 'account', data: [{ id, displayName: 'Board' }] }
    throw Object.assign(new Error('unavailable'), { status: 503 })
  })
  expect(await readCombinedCatalog(request, 'account')).toEqual({ accountKey: 'account', data: [{ id, displayName: 'Board', kind: 'enterprise' }], failedSources: ['cloud'] })
  await expect(readCombinedCatalog(request, 'other')).rejects.toThrow('account changed')
})
it('imports prototype favorites without overwriting durable records or removing the source on failure', async () => {
  const { importLegacyFavorites } = await import('../packages/dsh-desktop-enterprise/cloud-collection-client.js')
  const values = new Map([['bisheng.enterprise-workbench-favorites:account', JSON.stringify([id])]])
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) }
  const saved = { accountKey: 'account', revision: 4, items: [] }
  const request = vi.fn(async (_path, body) => ({ ...body, revision: 5 }))
  const failed = vi.fn(async () => { throw new Error('conflict') })
  await expect(importLegacyFavorites(storage, saved, [], failed)).rejects.toThrow('conflict')
  expect(values.size).toBe(1)
  const result = await importLegacyFavorites(storage, saved, [{ id, displayName: 'Board' }], request)
  expect(result.items).toEqual([{ kind: 'enterprise', id, title: 'Board', at: 0 }])
  expect(values.size).toBe(0)
})
it('timestamps public market favorite additions and serializes removals without losing account records', async () => {
  const { watchMarketFavoriteTimes } = await import('../packages/dsh-desktop-enterprise/cloud-collection-client.js')
  let listener, snapshot = { state: { favorites: [] }, catalog: [{ id: 'team/board', title: 'Board' }] }
  const saved = { accountKey: 'account', revision: 1, items: [{ kind: 'cloud', id, title: 'Cloud', at: 1 }], market: {} }
  const request = vi.fn(async (path, body) => { if (body) { Object.assign(saved, body, { revision: saved.revision + 1 }); return saved }; return structuredClone(saved) })
  const watcher = watchMarketFavoriteTimes({ getSnapshot: () => snapshot, subscribe: callback => { listener = callback; return () => {} } }, request, () => 123)
  snapshot = { ...snapshot, state: { favorites: ['team/board'] } }; listener(); await watcher.settled()
  expect(saved.market).toEqual({ 'team/board': { title: 'Board', at: 123 } })
  expect(saved.items[0].kind).toBe('cloud')
  snapshot = { ...snapshot, state: { favorites: [] } }; listener(); await watcher.settled()
  expect(saved.market).toEqual({})
  watcher.dispose()
})
