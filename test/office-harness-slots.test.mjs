// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import React, { act } from 'react'
import * as jsx from 'react/jsx-runtime'
import * as reactDom from 'react-dom'
import * as reactDomClient from 'react-dom/client'
import * as cordis from '@deepseek-ai/cordis'
import * as slotCore from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
const adapterSource = await readFile('packages/dsh-desktop-office/client.js', 'utf8')
// Optionally exercise a target checkout's built registry without installing it.
const harnessRoot = process.env.DSH_OFFICE_HARNESS_ROOT
const rendererSource = await readFile(harnessRoot
  ? resolve(harnessRoot, 'packages/client/ui-renderer/lib/client.js')
  : require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8')
const core = harnessRoot
  ? require(resolve(harnessRoot, 'packages/client/ui-slots/lib/index.js'))
  : slotCore
const modules = {
  react: React, 'react/jsx-runtime': jsx, 'react-dom': reactDom, 'react-dom/client': reactDomClient,
  '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': core,
  '@deepseek-ai/dsh-client-ui-primitives': {}
}
function load(source) {
  let result
  new Function('moduleLoader', source.replace('window.__ModuleLoader__.load(', 'moduleLoader.load('))({ load({ factory }) {
    result = factory(name => {
      if (!(name in modules)) throw new Error('Unexpected client dependency: ' + name)
      return modules[name]
    })
  } })
  return result
}
const { SlotRegistry } = load(rendererSource)
const adapter = load(adapterSource)
const pptAdapter = load((await readFile('packages/ppt-runtime/adapter/lib/client.js', 'utf8')).replace('/* PERSONAL_TEMPLATE_MANAGER */', await readFile('packages/ppt-runtime/client/personal-template-manager.js', 'utf8')))
const modernSlots = ['conversation.hero.options', 'conversation.input.left', 'conversation.input.dock', 'conversation.composer.dock']
const legacyOnlySlots = ['conversation.hero.modeActions', 'conversation.input.accessory',
  'conversation.chat.userMessageFooter', 'conversation.hero.dock']
const legacySlots = [...modernSlots, ...legacyOnlySlots]
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  document.querySelectorAll('style[data-plugin-css]').forEach(node => node.remove())
})

// Use the actual Harness registry and Cordis effects, with contract-sized owner
// declarations. The DOM below renders registered plugin components, not host UI.
async function fixture({ legacy = false, delayed = false, noSpec = false, history = false, withPpt = false } = {}) {
  const ctx = new cordis.Context()
  const registry = ctx.plugin(SlotRegistry)
  cleanups.push(() => registry.dispose())
  await registry
  const slots = ctx.slots
  let owner
  const names = [...(legacy ? legacySlots : modernSlots), ...(history ? ['conversation.chat.user.references'] : []), ...(withPpt ? ['conversation.chat.user.before'] : [])]
  const declare = () => {
    owner = slots.register({ name: 'root', id: 'conversation-test-owner', children: Object.fromEntries(
      names.map(name => [name, { kind: name === 'conversation.chat.user.before' ? 'chain' : 'list', scope: name.startsWith('conversation.hero') ? 'session-maybe' : 'session' }])
    ) }, () => null)
  }
  if (!delayed) declare()
  if (withPpt) cleanups.push(slots.register({ name: 'conversation.chat.user.before', id: 'source-decoration', select: owner => owner.source?.kind === 'user' ? true : null }, () => React.createElement('span', { 'data-source-decoration': '' }, 'source')))
  const sessionStates = new Map()
  const stateOf = id => { if (!sessionStates.has(id)) sessionStates.set(id, { mode: null, selectedTemplateId: null, presentationMode: null, pptId: null }); return sessionStates.get(id) }
  const pptTemplates = [{ id: 'example', name: 'Example template', category: 'business', palette: { background: 'FFFFFF', surface: 'F4F4F4', text: '242424', muted: '666666', accent: '3888FF', secondary: 'E7E7E9' } }]
  const calls = []
  const image = 'data:image/png;base64,iVBORw0KGgo='
  const templates = [
  { id: 'government-notice', title: '公文写作 · 通知', titleEn: 'Official notice', mode: 'word', category: '公文写作', pages: 4, pageAspectRatios: Array(4).fill(0.707), revision: 'a'.repeat(24), thumbnail: image },
  { id: 'coffee-market', title: '中国现制咖啡市场调研报告', titleEn: 'Coffee market research', mode: 'word', category: '调研分析', pages: 2, pageAspectRatios: [0.707, 0.707], revision: 'b'.repeat(24), thumbnail: image },
  { id: 'annual-business', title: '年度经营与客户分析', titleEn: 'Annual business', mode: 'excel', category: '经营分析', pages: 5, pageAspectRatios: [1.6, 0.7, 0.85, 0.8, 0.9], revision: 'c'.repeat(24), thumbnail: image, sheets: [{ name: '经营总览', pages: [1, 2] }, { name: '增长测算', pages: [3] }, { name: '增长质量', pages: [4, 5] }] }
]

  const dictionary = new Map()
  const translator = ns => (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace('{' + name + '}', value), dictionary.get(ns)?.zh[key] ?? key)
  const connection = { rpc: { async call(route, endpoint, payload) {
    const operation = payload.endpoint
    calls.push({ route, endpoint, payload })
    const state = stateOf(payload.sessionId)
    if (!operation) {
      if (endpoint === 'presentation/mode') { state.presentationMode = payload.mode; if (payload.mode) { state.mode = null; state.selectedTemplateId = null } }
      if (endpoint === 'template/select') state.pptId = payload.templateId
      if (endpoint === 'template/deselect') state.pptId = null
      return { ok: true, value: { status: 'ok', data: { templates: pptTemplates, presentationMode: state.presentationMode, selectedTemplateId: state.pptId } } }
    }
    if (operation === 'preview') return { ok: true, value: { page: payload.page, image, pages: templates.find(item => item.id === payload.templateId).pages } }
    if (operation === 'mode') { state.mode = payload.mode; state.selectedTemplateId = null; state.presentationMode = null; state.pptId = null }
    if (operation === 'select') state.selectedTemplateId = payload.templateId
    if (operation === 'deselect') state.selectedTemplateId = null
    return { ok: true, value: { templates, mode: state.mode, selectedTemplateId: state.selectedTemplateId, presentationMode: state.presentationMode } }
  } } }
  let plugin
  const activate = async () => {
    plugin = ctx.plugin({ inject: ['slots'], apply(pluginCtx) {
      const adapterCtx = {
        effect: pluginCtx.effect.bind(pluginCtx), on: pluginCtx.on.bind(pluginCtx), get: () => connection,
        locale: { register(ns, values) { dictionary.set(ns, values); return () => dictionary.delete(ns) } },
        slots: noSpec ? { inject: pluginCtx.slots.inject.bind(pluginCtx.slots), register: pluginCtx.slots.register.bind(pluginCtx.slots) } : pluginCtx.slots
      }
      adapter.apply(adapterCtx)
      if (withPpt) pptAdapter.apply(adapterCtx)
    } })
    await plugin
    const activated = plugin
    cleanups.push(() => activated.dispose())
  }
  await activate()
  const container = document.createElement('div')
  document.body.append(container)
  const root = reactDomClient.createRoot(container)
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove() })
  const propsCache = new Map()
  const entries = name => slots.entries(name).filter(entry => entry.options.id === 'desktop-office' || (withPpt && entry.options.id === 'dsh-ppt'))
  async function render({ sessionId = 'session-a', blank = true, hero = true, rows = [], hasMore = false } = {}) {
    const outlets = legacy ? [
      'conversation.hero.modeActions', 'conversation.input.accessory',
      hero ? 'conversation.hero.dock' : 'conversation.composer.dock'
    ] : modernSlots.filter(name => name !== 'conversation.chat.user.references')
    await act(async () => root.render(React.createElement(React.Fragment, null,
      ...outlets.map(name => React.createElement('div', { key: name, 'data-slot': name },
        ...(sessionId == null && !legacy ? [] : entries(name)).map(entry => {
          const key = name + ':' + entry.options.id + ':' + sessionId
          if (propsCache.get(key)?.entry !== entry) propsCache.set(key, { entry, props: entry.inject(sessionId) })
          return React.createElement(entry.component, {
            ...propsCache.get(key).props, key: entry.options.id, sessionId,
            session: sessionId ? { blank } : undefined, t: translator(entry.options.id)
          })
        }))),
      ...rows.map(row => React.createElement('div', { key: row.key, 'data-history-message': row.data.messageId },
        ...slots.entries('conversation.chat.user.before').filter(entry => entry.select({ source: row.data.source, kind: row.kind }) != null).slice(0, 1).map(entry => React.createElement(entry.component, { key: entry.options.id })),
        ...entries('conversation.chat.user.references').flatMap(entry => {
          const owner = { source: row.data.source, kind: row.kind, messageId: row.data.messageId }
          return [React.createElement(entry.component, { ...entry.inject(sessionId), ...owner, sessionId, t: translator(entry.options.id),
            useChat: selector => selector({ order: rows.map(row => row.key), nodes: { get: key => rows.find(row => row.key === key) } }),
            useSession: selector => selector({ blank, hasMore }) })]
        }))))))
  }
  return {
    container, calls, entries, render, declare, activate,
    collapse: () => owner(), dispose: () => plugin.dispose(),
    registrations: () => names.filter(name => entries(name).length),
    async unmount() { await act(async () => root.render(null)) },
    dictionary,
    async click(label) {
      const scope = container.querySelector('dialog[open]') ?? container
      const button = [...scope.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)
      expect(button, label).toBeDefined()
      await act(async () => button.click())
    }
  }
}

it('uses one modern input dock and keeps Word/Excel selection and preview mutually exclusive', async () => {
  const f = await fixture()
  expect(f.registrations()).toEqual(['conversation.hero.options', 'conversation.input.dock'])
  await f.render()
  expect(f.container.querySelectorAll('[data-office-mode]')).toHaveLength(2)
  expect(f.container.querySelectorAll('[data-slot="conversation.hero.options"] [data-office-mode]')).toHaveLength(2)
  expect(f.container.querySelector('[data-slot="conversation.input.left"] [data-office-mode]')).toBeNull()
  await f.click('Word')
  await f.click('Word')
  expect(f.container.querySelector('[data-office-dock]')).toBeNull()
  expect(f.container.querySelectorAll('[data-office-mode]')).toHaveLength(2)
  await f.click('Word')
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  expect(f.container.querySelector('[data-slot="conversation.composer.dock"]').childElementCount).toBe(0)
  const flow = f.container.querySelector('[data-layout="flow"]')
  expect(flow).not.toBeNull()
  expect(flow.closest('[data-slot]').dataset.slot).toBe('conversation.input.dock')
  // jsdom cannot calculate layout: check the scoped sizing rule in addition to
  // the slot/interaction behavior. Real browser geometry remains a separate gate.
  const style = document.querySelector('style[data-plugin-css="desktop-office/styles"]')
  const rule = [...style.sheet.cssRules].find(rule => rule.selectorText === '.dso-dock-root[data-layout=flow] .dso-dock')
  expect(rule.style.maxWidth).toBe('var(--dsh-composer-card-max-width,100%)')
  expect(rule.style.marginLeft).toBe('auto')
  expect(rule.style.marginRight).toBe('auto')
  await f.click('选用案例 中国现制咖啡市场调研报告')
  expect(f.container.querySelectorAll('[data-office-selected]')).toHaveLength(1)
  expect(f.container.querySelector('[data-office-selected]').dataset.officeSelected).toBe('coffee-market')
  await f.click('查看案例 中国现制咖啡市场调研报告')
  expect(f.container.querySelectorAll('dialog[open]')).toHaveLength(1)
  expect(f.container.querySelector('.dso-use')).toBeNull()
  await f.click('关闭预览')
  await f.click('Excel')
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  expect(f.container.querySelector('[data-office-dock]').dataset.officeDock).toBe('excel')
  expect(f.container.querySelectorAll('[data-office-template]')).toHaveLength(1)
  expect(f.container.querySelector('[data-office-selected]')).toBeNull()
  await f.click('选用案例 年度经营与客户分析')
  expect(f.container.querySelector('[data-office-selected]').dataset.officeSelected).toBe('annual-business')
  await f.click('查看案例 年度经营与客户分析')
  expect(f.container.querySelectorAll('dialog[open]')).toHaveLength(1)
  expect(f.container.querySelector('.dso-sheets').textContent).toContain('经营总览')
  await f.click('关闭预览')
  await f.click('取消选择案例')
  expect(f.container.querySelector('[data-office-selected]')).toBeNull()
  await f.render({ blank: false })
  expect(f.container.querySelector('[data-office-dock]')).toBeNull()
  expect(f.container.querySelector('[data-office-mode]')).toBeNull()
})

it.each([false, true])('retains legacy hero and composer behavior (missing spec: %s)', async noSpec => {
  const f = await fixture({ legacy: true, noSpec })
  expect(f.registrations().sort()).toEqual([...legacyOnlySlots, 'conversation.composer.dock'].sort())
  await f.render()
  await f.click('Word')
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  expect(f.container.querySelector('[data-slot="conversation.hero.dock"] [data-office-dock]')).not.toBeNull()
  expect(f.container.querySelector('[data-layout="flow"]')).toBeNull()
  await f.click('选用案例 中国现制咖啡市场调研报告')
  expect(f.container.querySelector('[data-slot="conversation.input.accessory"] [data-office-selected]')).not.toBeNull()
  await f.render({ hero: false })
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  expect(f.container.querySelector('[data-slot="conversation.composer.dock"] [data-office-dock]')).not.toBeNull()
})

it.each([false, true])('handles delayed declarations, owner remount, disable and reactivation (legacy: %s)', async legacy => {
  const f = await fixture({ legacy, delayed: true })
  expect(f.registrations()).toEqual([])
  f.declare()
  const expected = legacy ? 5 : 2
  expect(f.registrations()).toHaveLength(expected)
  await f.render()
  await f.click('Word')
  await f.unmount()
  f.collapse()
  expect(f.registrations()).toEqual([])
  f.declare()
  expect(f.registrations()).toHaveLength(expected)
  expect(f.registrations().every(name => f.entries(name).length === 1)).toBe(true)
  await f.render()
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  await f.unmount()
  await f.dispose()
  expect(f.registrations()).toEqual([])
  expect(f.dictionary.size).toBe(0)
  expect(document.querySelector('style[data-plugin-css="desktop-office/styles"]')).toBeNull()
  const count = f.calls.length
  window.dispatchEvent(new CustomEvent('dsh-office-mode-change', { detail: { origin: 'ppt', sessionId: 'session-a' } }))
  expect(f.calls).toHaveLength(count)
  await f.activate()
  expect(f.registrations()).toHaveLength(expected)
  await f.render()
  await f.click('Excel')
  expect(f.container.querySelectorAll('[data-office-dock]')).toHaveLength(1)
  expect(document.querySelectorAll('style[data-plugin-css="desktop-office/styles"]')).toHaveLength(1)
})

it('mounts modern controls when the session appears and hides all chooser UI after sending', async () => {
  const f = await fixture()
  await f.render({ sessionId: null })
  expect(f.container.querySelector('[data-office-mode]')).toBeNull()
  await f.render()
  await f.click('Word')
  await f.click('选用案例 中国现制咖啡市场调研报告')
  await f.render({ blank: false })
  expect(f.container.querySelector('[data-office-selected]')).toBeNull()
  expect(f.container.querySelector('[data-office-dock]')).toBeNull()
  expect(f.container.querySelector('[data-office-mode]')).toBeNull()
  // The current modern source seat has no durable message ID. Legacy opening
  // references remain covered by office-templates-ui; do not invent leading here.
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
})
it.each([['Word', 'coffee-market', '中国现制咖啡市场调研报告'], ['Excel', 'annual-business', '年度经营与客户分析']])('decorates only the first durable human message for %s across paging and remount', async (format, id, title) => {
  const f = await fixture({ history: true })
  await f.render()
  await f.click(format)
  await f.click('选用案例 ' + title)
  const source = { kind: 'user' }
  const row = (key, kind = 'user', origin = source) => ({ key, kind, data: { source: origin, messageId: key } })
  const first = row('first-human'), later = row('later-human')
  const rows = [row('notice', 'context', { kind: 'plugin', plugin: 'schedule' }), first, row('steering', 'steering'), later, row('echo')]
  rows.at(-1).data.messageId = undefined
  await f.render({ blank: false, rows, hasMore: true })
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
  await f.render({ blank: false, rows, hasMore: false })
  expect(f.container.querySelectorAll('[data-office-opening-template]')).toHaveLength(1)
  expect(f.container.querySelector('[data-history-message="first-human"] [data-office-opening-template]').dataset.officeOpeningTemplate).toBe(id)
  expect(f.container.querySelector('[data-history-message="later-human"] [data-office-opening-template]')).toBeNull()
  await f.click('查看案例 ' + title)
  expect(f.container.querySelectorAll('dialog[open]')).toHaveLength(1)
  expect(f.container.querySelector('.dso-use')).toBeNull()
  await f.click('关闭预览')
  await f.unmount()
  await f.render({ blank: false, rows, hasMore: false })
  expect(f.container.querySelectorAll('[data-office-opening-template]')).toHaveLength(1)
  await f.render({ blank: false, rows: [later], hasMore: true })
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
})
it('composes Office and PPT references without taking over source decorations or leaking across sessions', async () => {
  const f = await fixture({ history: true, withPpt: true })
  expect(f.entries('conversation.chat.user.references').map(entry => entry.options.id).sort()).toEqual(['desktop-office', 'dsh-ppt'])
  const source = { kind: 'user', rpcId: 'repeated-id' }
  const rows = [{ key: 'first', kind: 'user', data: { source, messageId: 'first' } }, { key: 'later', kind: 'user', data: { source, messageId: 'later' } }]
  await f.render()
  await f.click('Word')
  await f.click('选用案例 中国现制咖啡市场调研报告')
  await f.render({ blank: false, rows })
  expect(f.container.querySelectorAll('[data-office-opening-template]')).toHaveLength(1)
  expect(f.container.querySelector('[data-ppt-opening-template]')).toBeNull()
  expect(f.container.querySelectorAll('[data-source-decoration]')).toHaveLength(2)
  await f.render({ sessionId: 'session-b', blank: false, rows })
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
  expect(f.container.querySelector('[data-ppt-opening-template]')).toBeNull()
  await f.render()
  await f.click('PPT')
  expect(f.container.querySelector('[data-office-dock]')).toBeNull()
  expect(f.container.querySelectorAll('[data-office-mode]')).toHaveLength(2)
  await f.click('Example template')
  expect(f.container.querySelectorAll('[data-placement="flow"]')).toHaveLength(1)
  await f.click('预览模板 Example template')
  expect(f.container.querySelectorAll('dialog[open]')).toHaveLength(1)
  await f.click('关闭预览')
  await f.render({ blank: false, rows, hasMore: true })
  expect(f.container.querySelector('[data-ppt-opening-template]')).toBeNull()
  await f.render({ blank: false, rows })
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
  expect(f.container.querySelectorAll('[data-ppt-opening-template]')).toHaveLength(1)
  expect(f.container.querySelector('[data-history-message="later"] [data-ppt-opening-template]')).toBeNull()
  expect(f.container.querySelectorAll('[data-source-decoration]')).toHaveLength(2)
  await f.render()
  await f.click('取消选择模板')
  await f.render({ blank: false, rows })
  expect(f.container.querySelector('[data-ppt-opening-template]')).toBeNull()
  await f.unmount()
  await f.dispose()
  expect(f.entries('conversation.chat.user.references')).toHaveLength(0)
  await f.activate()
  await f.render({ blank: false, rows })
  expect(f.entries('conversation.chat.user.references')).toHaveLength(2)
  expect(f.container.querySelector('[data-office-opening-template]')).toBeNull()
  expect(f.container.querySelector('[data-ppt-opening-template]')).toBeNull()
})
