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
async function mount({ accessStatus = 'checked', bundles = {}, bridge, search, installedOnly = false, defaultContent, revoked = [], kind = 'enterprise', cloud = [], market = [], marketFavorites = [], favoritesOnly = false, data = [item], saved = [], installResult = { application: 'restart-required', result: { application: 'restart-required', bundle: 'finance' } } } = {}) {
  dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  if (bridge) dom.window.dshEnterpriseChat = bridge
  let revision = 0
  const calls = []
  const fetcher = vi.fn(async (path, options) => {
    calls.push([path, options?.body])
    if (path.endsWith('/cloud') && JSON.parse(options.body).operation === 'state') return Response.json({ state: {}, connectionKey: key })
    if (path.endsWith('/cloud')) return Response.json({ items: cloud, connectionKey: key })
    if (path.endsWith('/enterprise-access-check')) return Response.json({ status: accessStatus, revoked })
    if (path.endsWith('/catalog')) return Response.json({ data, accountKey: key })
    if (path.endsWith('/favorites')) return Response.json({ items: saved, accountKey: key, revision })
    if (path.endsWith('/write')) { const body = JSON.parse(options.body); saved = body.items; revision++; return Response.json({ items: saved, accountKey: key, revision }) }
    if (path.endsWith('/enterprise-install')) return Response.json(installResult)
    throw new Error(path)
  })
  vi.stubGlobal('fetch', fetcher)
  const native = { native: { bundles }, catalog: market, state: { favorites: marketFavorites } }
  const service = { subscribe: () => () => {}, getSnapshot: () => native, recordApplication: vi.fn(), refreshNative: vi.fn(async () => {}), toggleFavorite: vi.fn(async () => {}) }
  const Component = createCollection(React, { locale: { bind: () => label => copy.zh[label] } }, service)
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Component, { favoritesOnly, kind, search, installedOnly, defaultContent })); await tick() })
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

it('uses the V1.3.1 card regions and places the bookmark in the footer', async () => {
  await mount()
  const card = document.querySelector('article')
  expect(card.querySelector('.bishengWorkbenchMedia button').getAttribute('aria-label')).toContain('Finance')
  expect(card.querySelector('h2').textContent).toBe('Finance')
  expect(card.querySelector('.bishengWorkbenchAuthor').textContent).toContain('v1.0.0')
  expect(card.querySelector('.bishengWorkbenchDescription').textContent).toBe('Reports')
  expect(card.querySelector('.bishengWorkbenchActions [aria-label="收藏工作台"] svg')).not.toBeNull()
  expect(card.textContent).not.toContain('☆')
})
it('filters combined favorites using the host header without a second search input', async () => {
  const view = await mount({ kind: 'all', favoritesOnly: true, search: '', saved: [{ kind: 'enterprise', id, title: 'Finance', at: 1 }] })
  expect(document.querySelectorAll('input')).toHaveLength(0)
  expect(document.querySelectorAll('article')).toHaveLength(1)
  await view.search('missing')
  expect(document.querySelectorAll('article')).toHaveLength(0)
  await view.search('Reports')
  expect(document.querySelectorAll('article')).toHaveLength(1)
})

it('keeps native installed content without adding a second toolbar or empty message', async () => {
  await mount({ kind: 'cloud', installedOnly: true, search: '', defaultContent: React.createElement('div', { 'data-native-installed': true }, 'Native card') })
  expect(document.querySelector('[data-native-installed]').textContent).toBe('Native card')
  expect(document.querySelector('.bishengWorkbenchTools')).toBeNull()
  expect(document.body.textContent).not.toContain('企业暂未提供工作台')
})
it('opens and closes preview details without installing the workbench', async () => {
  dom = undefined
  const { calls } = await mount()
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  await act(async () => { document.querySelector('.bishengWorkbenchMediaOpen').click(); await tick() })
  expect(document.querySelector('dialog').open).toBe(true)
  expect(document.querySelector('dialog').textContent).toContain('Reports')
  expect(calls.some(([path]) => path.endsWith('/enterprise-install'))).toBe(false)
  await act(async () => { document.querySelector('dialog button').click(); await tick() })
  expect(document.querySelector('dialog')).toBeNull()
})

it('does not reset favorites for native focus notifications from the same account', async () => {
  let publish
  const { fetcher } = await mount({ bridge: { subscribe: listener => { publish = listener; return () => {} } } })
  await act(async () => { publish({ connected: true, projectScope: key, phase: 'ready' }); await tick() })
  const reads = fetcher.mock.calls.length
  await act(async () => { publish({ connected: true, projectScope: key, phase: 'loading' }); await tick() })
  expect(fetcher.mock.calls).toHaveLength(reads)
  expect(document.querySelectorAll('article')).toHaveLength(1)
  await act(async () => { publish({ connected: false }); await tick() })
  expect(fetcher.mock.calls.length).toBeGreaterThan(reads)
})

it('does not render a numeric zero for a cloud workbench with no saved sessions', async () => {
  await mount({ kind: 'cloud', cloud: [{ id, name: 'Cloud board', sessions: [] }] })
  const actions = document.querySelector('.bishengWorkbenchActions')
  expect([...actions.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('')).not.toContain('0')
  expect(actions.textContent).toBe('加载到工作台')
})

it('uses the V1.3.1 uninstall title and action footer and cancels without removing data', async () => {
  const { calls } = await mount({ bundles: { finance: { version: '1.0.0', removable: true } } })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  await act(async () => { document.querySelector('.bishengWorkbenchUninstall').click(); await tick() })
  const dialog = document.querySelector('.bishengWorkbenchConfirm')
  expect(dialog.open).toBe(true)
  expect(dialog.querySelector('h2').textContent).toBe('卸载「Finance」？')
  expect(dialog.querySelector('p').textContent).toContain('已有会话、项目文件、工作台笔记和收藏都会保留')
  expect([...dialog.querySelectorAll('.bishengWorkbenchConfirmActions button')].map(button => button.textContent)).toEqual(['取消', '确认卸载'])
  await act(async () => { dialog.querySelector('button').click(); await tick() })
  expect(document.querySelector('.bishengWorkbenchConfirm')).toBeNull()
  expect(calls.some(([path]) => path.includes('remove'))).toBe(false)
})

it.each(['enterprise', 'cloud', 'all'])('keeps %s controls before status and content, with accessible icon refresh', async kind => {
  const { fetcher } = await mount({ kind, search: '', favoritesOnly: kind === 'all', data: [], cloud: [] })
  const collection = document.querySelector('.bishengWorkbenchCollection')
  expect(collection.hasAttribute('data-inline-tools')).toBe(true)
  expect([...collection.children].map(node => node.className)).toEqual(['bishengWorkbenchTools', 'bishengWorkbenchContent'])
  const tools = collection.querySelector('.bishengWorkbenchTools')
  expect(tools.firstElementChild.getAttribute('aria-label')).toBe('刷新')
  expect(tools.firstElementChild.querySelector('svg')).not.toBeNull()
  expect(tools.textContent).toContain(kind === 'all' ? '收藏时间' : '更新时间')
  expect(collection.querySelector('.bishengWorkbenchEmpty strong')).not.toBeNull()
  const reads = fetcher.mock.calls.length
  await act(async () => { tools.firstElementChild.click(); await tick() })
  expect(fetcher.mock.calls.length).toBeGreaterThan(reads)
})

it('keeps authorization checking and cached content without the transient authorization notice', async () => {
  const { calls } = await mount({ accessStatus: 'unknown', search: '' })
  expect(calls.some(([path]) => path.endsWith('/enterprise-access-check'))).toBe(true)
  expect(document.body.textContent).toContain('Finance')
  expect(document.body.textContent).not.toContain('暂时无法确认企业工作台授权')
})

it.each(['enterprise', 'cloud', 'all'])('retains %s cards and their nodes while refreshing', async kind => {
  const { fetcher } = await mount({ kind, search: '', cloud: [{ id, name: 'Finance', description: 'Reports' }], favoritesOnly: kind === 'all', saved: [{ kind: 'enterprise', id, title: 'Finance', at: 1 }] })
  const card = document.querySelector('article')
  expect(card).not.toBeNull()
  const original = fetcher.getMockImplementation()
  let release
  const pending = new Promise(resolve => { release = resolve })
  fetcher.mockImplementationOnce(async (...args) => { await pending; return original(...args) })
  await act(async () => { document.querySelector('.bishengWorkbenchRefresh').click(); await tick() })
  expect(document.querySelector('article')).toBe(card)
  expect(document.querySelector('.bishengWorkbenchRefresh').disabled).toBe(true)
  await act(async () => { release(); await tick(); await tick() })
  expect(document.querySelector('article')).toBe(card)
  expect(document.querySelector('.bishengWorkbenchRefresh').disabled).toBe(false)
})

it('retains the empty-state container and changes its title during refresh', async () => {
  const { fetcher } = await mount({ data: [], search: '' })
  const empty = document.querySelector('.bishengWorkbenchEmpty')
  const original = fetcher.getMockImplementation()
  let release
  const pending = new Promise(resolve => { release = resolve })
  fetcher.mockImplementationOnce(async (...args) => { await pending; return original(...args) })
  await act(async () => { document.querySelector('.bishengWorkbenchRefresh').click(); await tick() })
  expect(document.querySelector('.bishengWorkbenchEmpty')).toBe(empty)
  expect(empty.textContent).toContain('正在读取企业工作台')
  await act(async () => { release(); await tick(); await tick() })
  expect(document.querySelector('.bishengWorkbenchEmpty')).toBe(empty)
  expect(empty.textContent).toContain('企业还没有可展示的工作台')
})

it('keeps previous cards on a transient refresh failure but clears them on account change', async () => {
  const { fetcher } = await mount({ search: '' })
  const card = document.querySelector('article')
  fetcher.mockImplementation(async () => Response.json({ error: 'temporary failure' }, { status: 503 }))
  await act(async () => { document.querySelector('.bishengWorkbenchRefresh').click(); await tick() })
  expect(document.querySelector('article')).toBe(card)
  expect(document.querySelector('[role=alert]').textContent).toContain('temporary failure')
  await act(async () => { window.dispatchEvent(new window.Event('dsh-desktop:enterprise-account-changed')); await tick() })
  expect(document.querySelector('article')).toBeNull()
})
