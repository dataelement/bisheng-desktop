import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { createCollection, copy } from '../packages/dsh-desktop-enterprise/workbench-collection-client.js'
let root, dom
const key = 'a'.repeat(16), id = '1'.repeat(32)
const item = { id, displayName: 'Finance', packageName: 'finance', description: 'Reports', currentVersion: { version: '1.0.0' } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
afterEach(async () => { if (root) await act(async () => root.unmount()); dom?.window.close(); vi.unstubAllGlobals() })
async function mount({ search, revoked = [], kind = 'enterprise', cloud = [], market = [], marketFavorites = [], favoritesOnly = false, data = [item], saved = [], installResult = { application: 'restart-required', result: { application: 'restart-required', bundle: 'finance' } } } = {}) {
  dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let revision = 0
  const calls = []
  const fetcher = vi.fn(async (path, options) => {
    calls.push([path, options?.body])
    if (path.endsWith('/cloud') && JSON.parse(options.body).operation === 'state') return Response.json({ state: {}, connectionKey: key })
    if (path.endsWith('/cloud')) return Response.json({ items: cloud, connectionKey: key })
    if (path.endsWith('/enterprise-access-check')) return Response.json({ status: 'checked', revoked })
    if (path.endsWith('/catalog')) return Response.json({ data, accountKey: key })
    if (path.endsWith('/favorites')) return Response.json({ items: saved, accountKey: key, revision })
    if (path.endsWith('/write')) { const body = JSON.parse(options.body); saved = body.items; revision++; return Response.json({ items: saved, accountKey: key, revision }) }
    if (path.endsWith('/enterprise-install')) return Response.json(installResult)
    throw new Error(path)
  })
  vi.stubGlobal('fetch', fetcher)
  const native = { native: { bundles: {} }, catalog: market, state: { favorites: marketFavorites } }
  const service = { subscribe: () => () => {}, getSnapshot: () => native, recordApplication: vi.fn(), refreshNative: vi.fn(async () => {}), toggleFavorite: vi.fn(async () => {}) }
  const Component = createCollection(React, { locale: { bind: () => label => copy.zh[label] } }, service)
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Component, { favoritesOnly, kind, search })); await tick() })
  return { calls, service, fetcher, search: async value => act(async () => { root.render(React.createElement(Component, { favoritesOnly, kind, search: value })); await tick() }) }
}
it('removes a revoked favorite using the persisted revision and account, without requiring catalog membership', async () => {
  const { calls } = await mount({ favoritesOnly: true, data: [], saved: [{ kind: 'enterprise', id, title: 'Retired', at: 1 }] })
  expect(document.body.textContent).toContain('已下架或你没有使用权限')
  await act(async () => { document.querySelector('[aria-label="取消收藏"]').click(); await tick() })
  const write = calls.find(([path]) => path.endsWith('/write'))
  expect(JSON.parse(write[1])).toEqual({ accountKey: key, revision: 0, items: [] })
  expect(document.body.textContent).toContain('还没有收藏工作台')
})
it('reports restart-required distinctly and forwards the outcome to the host', async () => {
  const { service } = await mount()
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '安装').click(); await tick() })
  expect(document.body.textContent).toContain('重启 Harness 后生效')
  expect(service.recordApplication).toHaveBeenCalledWith('finance', expect.objectContaining({ application: 'restart-required' }), undefined, 'install')
})
it('clears the previous account immediately when logout refresh fails', async () => {
  const { fetcher } = await mount()
  expect(document.body.textContent).toContain('Finance')
  fetcher.mockImplementation(async () => Response.json({ error: 'signed out' }, { status: 401 }))
  await act(async () => { window.dispatchEvent(new window.Event('dsh-desktop:enterprise-account-changed')); await tick() })
  expect(document.body.textContent).not.toContain('Finance')
  expect(document.body.textContent).toContain('请先登录企业账号')
})

it('combines three favorite sources and filters without changing another source', async () => {
  const cloudId = '2'.repeat(32)
  const { service } = await mount({ kind: 'all', favoritesOnly: true, cloud: [{ id: cloudId, name: 'Cloud board' }], market: [{ id: 'team/market', title: 'Market board' }], marketFavorites: ['team/market'], saved: [{ kind: 'enterprise', id, title: 'Finance', at: 1 }, { kind: 'cloud', id: cloudId, title: 'Cloud board', at: 2 }] })
  expect(document.querySelectorAll('article')).toHaveLength(3)
  const filter = document.querySelector('[aria-label="全部来源"]')
  await act(async () => { filter.value = 'market'; filter.dispatchEvent(new window.Event('change', { bubbles: true })); await tick() })
  expect(document.querySelectorAll('article')).toHaveLength(1)
  expect(document.querySelector('article').textContent).toContain('Market board')
  await act(async () => { document.querySelector('[aria-label="取消收藏"]').click(); await tick() })
  expect(service.toggleFavorite).toHaveBeenCalledWith('team/market')
})


it('explains revoked installed workbenches while retaining their content', async () => {
  await mount({ revoked: ['finance'] })
  expect(document.body.textContent).toContain('已被收回授权并停用')
  expect(document.body.textContent).toContain('文件和会话仍保留')
  expect(document.body.textContent).toContain('finance')
})

for (const kind of ['enterprise', 'cloud']) it(`filters ${kind} with the header query and restores rows when cleared`, async () => {
  const view = await mount({ kind, search: '', cloud: [{ id, name: 'Finance', description: 'Reports' }] })
  expect(document.querySelector('[aria-label="搜索工作台"]')).toBeNull()
  expect(document.querySelectorAll('article')).toHaveLength(1)
  await view.search(' Finance ')
  expect(document.querySelectorAll('article')).toHaveLength(1)
  await view.search('does-not-exist')
  expect(document.querySelectorAll('article')).toHaveLength(0)
  expect(document.body.textContent).toContain('没有找到匹配的工作台')
  await view.search('')
  expect(document.querySelectorAll('article')).toHaveLength(1)
})
