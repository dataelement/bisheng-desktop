// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React, { act } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

// Synchronous observable contract used by the shared model directory.
function createSnapshotStore(value) {
  const listeners = new Set()
  const store = {
    getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of [...listeners]) fn() },
    update(fn) { const next = { ...value }; fn(next); store.set(next) }
  }
  return store
}

const require = createRequire(import.meta.url)
const models = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-model-selection/client'), 'utf8')
const chat = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-chat/client'), 'utf8')
function region(source, name) {
  const start = source.indexOf(`//#region lib/types/client/${name}.js`)
  if (start < 0) throw new Error(`Missing bundle region: ${name}`)
  return source.slice(start, source.indexOf('//#endregion', start))
}
const Catalog = vm.runInNewContext(`${region(models, 'catalog')}; ModelCatalogDirectory`, {
  _deepseek_ai_dsh_client_store: { createSnapshotStore }
})
const { TurnUsagePanel, zh, en } = vm.runInNewContext([
  region(chat, 'locale'), region(chat, 'chat/token-format'), region(chat, 'chat/stat-dialog'),
  region(chat, 'chat/TurnUsagePanel'), '({ TurnUsagePanel, zh, en })'
].join('\n'), {
  react: React, react_jsx_runtime: jsxRuntime, react_dom: ReactDOM, document,
  TurnUsagePanel_module_css_default: {}, stat_dialog_module_css_default: {},
  // Geometry is independent of the label, subscription and dialog behavior under test.
  _deepseek_ai_dsh_client_ui_primitives: {
    IconDatabaseOutlineRegular: () => null,
    useAnchoredPosition: () => ({ left: 0, top: 0 }), useDismissOnOutsidePointer() {}
  }
})
const route = { provider: 'bisheng-enterprise', model: 'bisheng:2' }
const other = { provider: 'bisheng-enterprise', model: 'bisheng:3' }
const group = (provider, entries) => ({ id: provider, name: 'Enterprise', models: entries.map(([id, name]) => ({ id, name })) })
const groups = [group(route.provider, [['bisheng:2', '阿里云百炼 / qwen-max'], ['bisheng:3', 'DeepSeek / V3']])]
const usage = { totalTokens: 9063, uncachedInputTokens: 863, cacheReadTokens: 8192, outputTokens: 8, routes: [route] }
const numberLocale = { 'number.thousand': '{value}K', 'number.million': '{value}M', 'number.groupSeparator': ',' }
const translate = locale => (key, args = {}) => (locale[key] ?? numberLocale[key]).replace(/\{(\w+)\}/g, (_all, name) => args[name])
let root
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  if (root) await act(() => root.unmount())
  root = undefined
  document.body.innerHTML = ''
})
function fixture(initial = groups) {
  let current = initial
  const modelCatalog = vi.fn(async () => ({ ok: true, value: { groups: current, default: route, failures: [] } }))
  const catalog = new Catalog({ remote: { session: { modelCatalog } } })
  return { catalog, modelCatalog, async publish(next) { current = next; catalog.refresh(); await catalog.load() } }
}
async function mount(catalog, buckets = usage, locale = zh) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(() => root.render(React.createElement(TurnUsagePanel, { usage: buckets, modelCatalog: catalog, t: translate(locale) })))
  await act(() => container.querySelector('button').click())
  return () => document.querySelector('[data-turn-usage-details]').textContent
}

it('renders the configured picker label with the original usage amounts', async () => {
  const f = fixture()
  await f.catalog.load()
  const details = await mount(f.catalog)
  expect(details()).toContain('阿里云百炼 / qwen-max')
  expect(details()).not.toContain('bisheng-enterprise/bisheng:2')
  expect(details()).toContain('90.5%')
  expect(details()).toContain('863 tok')
  expect(details()).toContain('8,192 tok')
  expect(document.body.textContent).toContain('9,063 tok')
  expect(f.modelCatalog).toHaveBeenCalledTimes(1)
  await act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('updates an open usage dialog when the shared catalog finishes loading', async () => {
  const f = fixture()
  const details = await mount(f.catalog)
  expect(details()).toContain('模型名称暂不可用')
  await act(() => f.catalog.load())
  expect(details()).toContain('阿里云百炼 / qwen-max')
})

it('retains the used model label after revocation and a replacement selection', async () => {
  const f = fixture()
  await f.catalog.load()
  const details = await mount(f.catalog)
  await act(() => f.publish([group(other.provider, [[other.model, 'DeepSeek / V3']])]))
  expect(details()).toContain('阿里云百炼 / qwen-max')
  expect(details()).not.toContain('DeepSeek / V3')
  expect(f.catalog.store.getSnapshot().value.groups[0].models.map(model => model.id)).toEqual([other.model])
})

it('resolves multiple actual routes by both provider and model', async () => {
  const f = fixture([...groups, group('other-provider', [['bisheng:2', 'Other provider model']])])
  await f.catalog.load()
  const details = await mount(f.catalog, { ...usage, routes: [route, other, { provider: 'other-provider', model: route.model }] })
  expect(details()).toContain('阿里云百炼 / qwen-max, DeepSeek / V3, Other provider model')
})

it('clears retained labels when connecting to a replacement host', async () => {
  const f = fixture()
  await f.catalog.load()
  const details = await mount(f.catalog)
  await act(async () => {
    await f.publish([])
    f.catalog.resetGeneration()
    await f.catalog.load()
  })
  expect(details()).toContain('模型名称暂不可用')
  expect(details()).not.toContain('qwen-max')
})

it.each([['Chinese', zh, '模型名称暂不可用'], ['English', en, 'Model name unavailable']])('shows an honest %s fallback for legacy unavailable routes', async (_name, locale, fallback) => {
  const f = fixture([])
  await f.catalog.load()
  const details = await mount(f.catalog, usage, locale)
  expect(details()).toContain(fallback)
  expect(details()).not.toContain('bisheng:2')
})

it('keeps unattributed usage without a model row', async () => {
  const f = fixture()
  await f.catalog.load()
  const details = await mount(f.catalog, { ...usage, routes: undefined })
  expect(details()).not.toContain('提供方 / 模型')
  expect(details()).toContain('863 tok')
})

it.each(['', '   '])('uses the localized fallback for an empty configured name %j', async name => {
  const f = fixture([group(route.provider, [[route.model, name]])])
  await f.catalog.load()
  expect(await mount(f.catalog).then(details => details())).toContain('模型名称暂不可用')
})

it('discards a late catalog response from the previous connection', async () => {
  let finishOld
  const modelCatalog = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValue({ ok: true, value: { groups: [], default: route, failures: [] } })
  const catalog = new Catalog({ remote: { session: { modelCatalog } } })
  const oldLoad = catalog.load()
  catalog.resetGeneration()
  await catalog.load()
  finishOld({ ok: true, value: { groups, default: route, failures: [] } })
  await oldLoad
  expect(catalog.displayNameFor(route)).toBeUndefined()
})

it('declares the model service in the client loader graph and the turn-tail injection', () => {
  const metadata = require('@deepseek-ai/dsh-client-ui-chat/package.json')
  expect(metadata.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-model-selection')
  const apply = region(chat, 'apply')
  expect(apply.slice(apply.indexOf('const inject ='), apply.indexOf('function apply'))).toContain('"modelDirectories"')
  const registrations = []
  const source = region(chat, 'chat/register-node-renderers')
  const renderers = Object.fromEntries([...source.matchAll(/}, (\w+)\)\)/g)].map(match => [match[1], () => null]))
  const register = vm.runInNewContext(`${source}; registerChatNodeRenderers`, { ...renderers, NS: 'chat' })
  const f = fixture()
  register({ modelDirectories: { catalog: f.catalog }, effect() {}, slots: { inject: (_slot, fn) => fn(), register: config => registrations.push(config) } }, {}, {})
  expect(registrations.find(config => config.key === 'turn-tail').inject().modelCatalog).toBe(f.catalog)
})
