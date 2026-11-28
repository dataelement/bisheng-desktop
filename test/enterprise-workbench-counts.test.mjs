import { expect, it, vi } from 'vitest'
import { createCollectionCounts } from '../packages/dsh-desktop-enterprise/workbench-counts-client.js'

it('counts saved favorites and installed cloud entries and refreshes after changes', async () => {
  let items = [{ id: 'a' }, { id: 'b' }]
  const store = createCollectionCounts(async path => path.endsWith('/favorites')
    ? { accountKey: 'account', items }
    : { connectionKey: 'account', state: { added: ['a', 'a', 'missing'], cloudWorkbenches: { a: {} } } })
  const listener = vi.fn(), stop = store.subscribe(listener)
  await store.refresh()
  expect(store.getSnapshot()).toEqual({ favorites: 2, installed: 1 })
  items = []
  await store.refresh()
  expect(store.getSnapshot().favorites).toBe(0)
  expect(listener).toHaveBeenCalledTimes(2)
  stop(); store.dispose()
})

it('discards stale account responses and clears unavailable account counts', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let mode = 'ready'
  const store = createCollectionCounts(async path => {
    if (mode === 'denied') throw Object.assign(new Error('signed out'), { status: 401 })
    return path.endsWith('/favorites') ? { accountKey: 'a', items: [1] } : { connectionKey: mode === 'mismatch' ? 'b' : 'a', state: {} }
  })
  await store.refresh()
  mode = 'mismatch'; await store.refresh()
  expect(store.getSnapshot()).toEqual({ favorites: null, installed: null })
  mode = 'denied'; await store.refresh({ reset: true })
  expect(store.getSnapshot()).toEqual({ favorites: 0, installed: 0 })
  store.dispose(); warn.mockRestore()
})

it('does not publish an obsolete refresh or results after disposal', async () => {
  const pending = []
  const store = createCollectionCounts(() => new Promise(resolve => pending.push(resolve)))
  const first = store.refresh(), second = store.refresh()
  pending[2]({ accountKey: 'b', items: [1, 2] }); pending[3]({ connectionKey: 'b', state: {} })
  await second
  pending[0]({ accountKey: 'a', items: [1] }); pending[1]({ connectionKey: 'a', state: {} })
  await first
  expect(store.getSnapshot().favorites).toBe(2)
  const last = store.refresh(); store.dispose()
  pending[4]({ accountKey: 'c', items: [] }); pending[5]({ connectionKey: 'c', state: {} })
  await last
  expect(store.getSnapshot().favorites).toBe(2)
})
