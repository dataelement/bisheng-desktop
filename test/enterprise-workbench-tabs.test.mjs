import { expect, it } from 'vitest'
import { copy, registerCollectionTabs } from '../packages/dsh-desktop-enterprise/workbench-collection-client.js'
function fixture() {
  const records = new Map(), render = props => props
  const service = { getMarketTabs: () => [], registerMarketCollection: value => { if (records.has(value.id)) throw new Error('duplicate'); records.set(value.id, value); return () => records.delete(value.id) } }
  return { records, service, render }
}
it('registers the V1.3.1 source order and replaces the existing favorites instead of adding more tabs', () => {
  const { records, service, render } = fixture()
  const disposers = registerCollectionTabs(service, key => copy.zh[key], render)
  expect([...records.keys()]).toEqual(['enterprise', 'cloud', 'market', 'favorites', 'mine'])
  expect([...records.values()].map(item => item.label)).toEqual(['来自企业', '云端工作台', '工作台市场', '我的收藏', '已安装'])
  expect(records.get('favorites')).toMatchObject({ replace: true })
  expect(records.get('favorites').render()).toEqual({ kind: 'all', favoritesOnly: true, publicMarket: true })
  expect(records.get('mine').render({ renderDefault: () => 'Native installed cards' })).toEqual({ kind: 'cloud', installedOnly: true, defaultContent: 'Native installed cards' })
  for (const dispose of disposers) dispose()
  expect(records.size).toBe(0)
})
it('omits the public market for deployments that do not allow it', () => {
  const { records, service, render } = fixture()
  registerCollectionTabs(service, key => copy.en[key], render, false)
  expect(records.get('market').visible).toBe(false)
})

it('renders exactly five ordered tabs with the real upstream Market and four when the market is disabled', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { JSDOM } = await import('jsdom')
  const { vi } = await import('vitest')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.localStorage.setItem('dsh-workbench-enabled', 'true')
  let api, root, service, disposers = []
  dom.window.__ModuleLoader__ = { load: ({ factory }) => { api = factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/cordis') return { Service: { tracker: Symbol('tracker') } }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: ({ children, icon, variant, primary, ...props }) => React.createElement('button', props, icon, children), Menu: () => null, Switch: () => null, Toast: () => null, IconDownloadOutlineRegular: () => null }
    throw new Error(name)
  }) } }
  try {
    vm.runInNewContext(await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8'), { window: dom.window, document: dom.window.document, setTimeout, clearTimeout, AbortController, URL, requestAnimationFrame: callback => callback() })
    service = new api.Workbenches({ locale: { bind: () => key => key } })
    root = createRoot(document.getElementById('root'))
    disposers = registerCollectionTabs(service, key => copy.zh[key], () => React.createElement('div', null, 'Collection'))
    await React.act(async () => { root.render(React.createElement(api.Market, { service })) })
    const tabs = () => [...document.querySelectorAll('[role="tab"]')]
    expect(tabs().map(item => item.textContent)).toEqual(['来自企业', '云端工作台', '工作台市场', '我的收藏', '已安装'])
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
    await React.act(async () => { for (const dispose of disposers) dispose(); disposers = registerCollectionTabs(service, key => copy.zh[key], () => null, false) })
    expect(tabs().map(item => item.textContent)).toEqual(['来自企业', '云端工作台', '我的收藏', '已安装'])
    await React.act(async () => { tabs()[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
  } finally {
    if (root) await React.act(async () => root.unmount())
    for (const dispose of disposers) dispose()
    dom.window.close(); vi.unstubAllGlobals()
  }
})

it('opts both source tabs into host search and forwards it only on capable hosts', () => {
  const { records, service, render } = fixture()
  registerCollectionTabs(service, key => copy.zh[key], render)
  for (const id of ['enterprise', 'cloud']) {
    expect(records.get(id)).toMatchObject({ controls: false, search: true })
    expect(records.get(id).render({ search: 'sample' }).search).toBeUndefined()
  }
  service.collectionSearch = true
  for (const id of ['enterprise', 'cloud']) expect(records.get(id).render({ search: 'sample' }).search).toBe('sample')
})
