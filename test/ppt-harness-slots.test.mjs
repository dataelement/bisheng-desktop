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
const adapterSource = (await readFile('packages/ppt-runtime/adapter/lib/client.js', 'utf8'))
  .replace('/* PERSONAL_TEMPLATE_MANAGER */', await readFile('packages/ppt-runtime/client/personal-template-manager.js', 'utf8'))
// Optionally exercise a target checkout's built registry without installing it.
const harnessRoot = process.env.DSH_PPT_HARNESS_ROOT
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
const modernSlots = ['conversation.hero.options', 'conversation.input.dock', 'conversation.composer.dock', 'conversation.input.after', 'conversation.input.inside']
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
async function fixture({ legacy = false, delayed = false, noSpec = false, missing = [] } = {}) {
  const ctx = new cordis.Context()
  const registry = ctx.plugin(SlotRegistry)
  cleanups.push(() => registry.dispose())
  await registry
  const slots = ctx.slots
  let owner
  const names = (legacy ? legacySlots : modernSlots).filter(name => !missing.includes(name))
  const declare = () => {
    owner = slots.register({ name: 'root', id: 'conversation-test-owner', children: Object.fromEntries(
      names.map(name => [name, { kind: 'list', scope: name.startsWith('conversation.hero') ? 'session-maybe' : 'session' }])
    ) }, () => null)
  }
  if (!delayed) declare()
  let presentationMode = null, selectedTemplateId = null
  const calls = []
  const templates = [{ id: 'example', name: 'Example template', category: 'business', palette: {
    background: 'FFFFFF', surface: 'F4F4F4', text: '242424', muted: '666666', accent: '3888FF', secondary: 'E7E7E9'
  } }]
  const dictionary = new Map()
  const translate = key => dictionary.get('dsh-ppt')?.zh[key] ?? key
  const connection = { rpc: { async call(route, endpoint, payload) {
    calls.push({ route, endpoint, payload })
    if (endpoint === 'presentation/mode') presentationMode = payload.mode
    if (endpoint === 'template/select') selectedTemplateId = payload.templateId
    return { ok: true, value: { status: 'ok', data: { templates, presentationMode, selectedTemplateId } } }
  } } }
  let plugin
  const activate = async () => {
    plugin = ctx.plugin({ inject: ['slots'], apply(pluginCtx) {
      const adapterCtx = {
        effect: pluginCtx.effect.bind(pluginCtx), get: () => connection,
        locale: { register(ns, values) { dictionary.set(ns, values); return () => dictionary.delete(ns) } },
        slots: noSpec ? { inject: pluginCtx.slots.inject.bind(pluginCtx.slots), register: pluginCtx.slots.register.bind(pluginCtx.slots) } : pluginCtx.slots
      }
      adapter.apply(adapterCtx)
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
  const entries = name => slots.entries(name).filter(entry => entry.options.id === 'dsh-ppt')
  async function render({ sessionId = 'session-a', blank = true, hero = true } = {}) {
    const outlets = legacy ? [
      'conversation.hero.modeActions', 'conversation.input.accessory',
      hero ? 'conversation.hero.dock' : 'conversation.composer.dock'
    ] : modernSlots
    await act(async () => root.render(React.createElement(React.Fragment, null,
      ...outlets.map(name => React.createElement('div', { key: name, 'data-slot': name },
        ...(sessionId == null && !legacy ? [] : entries(name)).map(entry => {
          const key = name + ':' + sessionId
          if (propsCache.get(key)?.entry !== entry) propsCache.set(key, { entry, props: entry.inject(sessionId) })
          return React.createElement(entry.component, {
            ...propsCache.get(key).props, key: entry.options.id, sessionId,
            session: sessionId ? { blank } : undefined, t: translate
          })
        }))))))
  }
  return {
    container, calls, entries, render, declare, activate, slots,
    collapse: () => owner(), dispose: () => plugin.dispose(),
    registrations: () => names.filter(name => entries(name).length),
    async clickPpt() { await act(async () => container.querySelector('button[data-desktop-ppt]').click()) },
    async choose() { await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Example template').click()) }
  }
}

it('renders the modern PPT control and a single input dock, despite composer.dock also existing', async () => {
  const f = await fixture()
  expect(f.registrations()).toEqual(['conversation.hero.options', 'conversation.input.after', 'conversation.input.inside'])
  await f.render()
  expect(f.container.querySelectorAll('button[data-desktop-ppt]')).toHaveLength(1)
  expect(f.container.querySelector('[data-slot="conversation.hero.options"] button')?.textContent).toBe('PPT')
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(0)
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  expect(f.container.querySelector('[data-slot="conversation.input.after"] [data-office-ppt-template-panel]')).not.toBeNull()
  expect(f.container.querySelector('[data-slot="conversation.composer.dock"]')?.childElementCount).toBe(0)
  // jsdom checks declared layout and interactions; real hit-testing is a browser gate.
  const panel = f.container.querySelector('[data-office-ppt-template-panel]')
  const root = panel.closest('section')
  expect(root.dataset.placement).toBe('flow')
  expect(root.style.position).toBe('relative')
  expect(root.style.height).toBe('auto')
  expect(root.style.padding).toBe('0px')
  expect(panel.style.position).toBe('relative')
  expect(panel.style.top).toBe('auto')
  expect(panel.style.left).toBe('auto')
  expect(panel.style.transform).toBe('none')
  expect(panel.style.width).toBe('100%')
  expect(panel.style.maxWidth).toBe('none')
  expect(panel.style.height).toBe('auto')
  expect(panel.style.maxHeight).toBe('50dvh')
  expect(getComputedStyle(panel).position).toBe('relative')
  expect(getComputedStyle(root).height).not.toBe('0px')
  expect(f.container.querySelector('button[data-desktop-ppt]').getAttribute('aria-expanded')).toBe('true')
  await f.clickPpt()
  expect(f.container.querySelector('[data-office-ppt-template-panel]')).toBeNull()
  expect(f.container.querySelector('button[data-desktop-ppt]').getAttribute('aria-expanded')).toBe('false')
  await f.clickPpt()
  await f.choose()
  const preview = f.container.querySelector('button[aria-haspopup="dialog"]')
  expect(preview).not.toBeNull()
  expect(f.container.querySelectorAll('[data-slot="conversation.input.inside"] button[aria-haspopup="dialog"]')).toHaveLength(1)
  expect(f.container.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(1)
  const showModal = HTMLDialogElement.prototype.showModal
  const close = HTMLDialogElement.prototype.close
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  try {
    await act(async () => preview.click())
    expect(f.container.querySelector('dialog[open]')?.open).toBe(true)
    await act(async () => f.container.querySelector('dialog[open] button[aria-label="关闭预览"]').click())
    expect(document.activeElement).toBe(preview)
  } finally {
    HTMLDialogElement.prototype.showModal = showModal
    HTMLDialogElement.prototype.close = close
  }
  expect(f.calls.some(call => call.endpoint === 'template/select' && call.payload.templateId === 'example')).toBe(true)
  const selected = [...f.container.querySelectorAll('[data-office-ppt-template-panel] button')]
    .find(button => button.textContent === 'Example template')
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(f.container.querySelector('button[data-desktop-ppt]').getAttribute('aria-expanded')).toBe('true')
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(0)
})

it.each([false, true])('preserves legacy hero and composer behavior (missing spec API: %s)', async noSpec => {
  const f = await fixture({ legacy: true, noSpec })
  expect(f.registrations().sort()).toEqual([...legacyOnlySlots, 'conversation.composer.dock'].sort())
  await f.render()
  await f.clickPpt()
  expect(f.container.querySelectorAll('button[data-desktop-ppt]')).toHaveLength(1)
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  const heroPanel = f.container.querySelector('[data-slot="conversation.hero.dock"] [data-office-ppt-template-panel]')
  expect(heroPanel).not.toBeNull()
  expect(heroPanel.closest('section').dataset.placement).toBe('fixed')
  expect(heroPanel.style.position).toBe('')
  expect(heroPanel.closest('section').style.height).toBe('')
  await f.render({ hero: false })
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  const composerPanel = f.container.querySelector('[data-slot="conversation.composer.dock"] [data-office-ppt-template-panel]')
  expect(composerPanel).not.toBeNull()
  expect(composerPanel.closest('section').dataset.placement).toBe('fixed')
  expect(composerPanel.style.position).toBe('')
  expect(composerPanel.closest('section').style.height).toBe('')
})

it.each([false, true])('waits for declarations and removes/reinstalls contributions once (legacy: %s)', async legacy => {
  const f = await fixture({ legacy, delayed: true })
  expect(f.registrations()).toEqual([])
  f.declare()
  const expected = legacy ? 5 : 3
  expect(f.registrations()).toHaveLength(expected)
  f.collapse()
  expect(f.registrations()).toEqual([])
  f.declare()
  expect(f.registrations()).toHaveLength(expected)
  expect(f.registrations().every(name => f.entries(name).length === 1)).toBe(true)
  await f.dispose()
  expect(f.registrations()).toEqual([])
  await f.activate()
  expect(f.registrations()).toHaveLength(expected)
  await f.render()
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
})

it('shows modern controls after a session appears without requiring an unbound outlet', async () => {
  const f = await fixture()
  await f.render({ sessionId: null })
  expect(f.container.querySelectorAll('button[data-desktop-ppt]')).toHaveLength(0)
  await f.render()
  expect(f.container.querySelectorAll('button[data-desktop-ppt]')).toHaveLength(1)
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
})

it('clears only the matching session when Office takes over', async () => {
  const f = await fixture()
  await f.render()
  await f.clickPpt()
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-office-mode-change', { detail: { origin: 'office', mode: 'word', sessionId: 'other' } })))
  expect(f.container.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-office-mode-change', { detail: { origin: 'office', mode: 'word', sessionId: 'session-a' } })))
  expect(f.container.querySelector('[data-office-ppt-template-panel]')).toBeNull()
  expect(f.container.querySelector('button[data-desktop-ppt]').getAttribute('aria-pressed')).toBe('false')
})

it('hides the chooser once the modern session is no longer blank', async () => {
  const f = await fixture()
  await f.render()
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  await f.choose()
  expect(f.container.querySelectorAll('[data-slot="conversation.input.inside"] button[aria-haspopup="dialog"]')).toHaveLength(1)
  await f.render({ blank: false })
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(0)
  expect(f.container.querySelectorAll('[data-slot="conversation.input.inside"] button[aria-haspopup="dialog"]')).toHaveLength(0)
})

it.each(['conversation.input.after', 'conversation.input.inside'])('falls back to the input dock when %s is absent', async missing => {
  const f = await fixture({ missing: [missing] })
  expect(f.registrations()).toEqual(['conversation.hero.options', 'conversation.input.dock'])
  await f.render()
  await f.clickPpt()
  expect(f.container.querySelectorAll('[data-slot="conversation.input.dock"] [data-office-ppt-template-panel]')).toHaveLength(1)
  await f.choose()
  expect(f.container.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(1)
})

it('upgrades a live fallback when slots arrive separately and restores it on collapse', async () => {
  const f = await fixture({ missing: ['conversation.input.after', 'conversation.input.inside'] })
  await f.render()
  await f.clickPpt()
  const after = f.slots.register({ name: 'root', id: 'late-after', priority: 1, children: { 'conversation.input.after': { kind: 'list', scope: 'session' } } }, () => null)
  expect(f.entries('conversation.input.dock')).toHaveLength(1)
  const inside = f.slots.register({ name: 'root', id: 'late-inside', priority: 2, children: { 'conversation.input.inside': { kind: 'list', scope: 'session' } } }, () => null)
  expect(f.entries('conversation.input.dock')).toHaveLength(0)
  expect(f.entries('conversation.input.after')).toHaveLength(1)
  expect(f.entries('conversation.input.inside')).toHaveLength(1)
  await f.render()
  expect(f.container.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  inside()
  expect(f.entries('conversation.input.dock')).toHaveLength(1)
  expect(f.entries('conversation.input.after')).toHaveLength(0)
  after()
})
