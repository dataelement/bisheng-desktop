import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import * as jsxRuntime from 'react/jsx-runtime'
import { createPortal } from 'react-dom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile(new URL('../packages/dsh-desktop-settings/client.js', import.meta.url), 'utf8')
let cleanup
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })

async function fixture(language = 'zh', settingsProtocolVersion = 1, signedIn = true) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let definition
  const subscribers = new Set()
  const unregister = vi.fn()
  let account = signedIn ? { connected: true, user: { display_name: '张三', username: 'zhangsan' } } : { connected: false }
  const request = vi.fn(async (path) => {
    if (path === '/api/enterprise.logout') account = { connected: false }
    return { ok: true, json: async () => account }
  })
  const primitives = {
    Menu: ({ open, anchor, children }) => React.createElement('div', null, anchor, open && React.createElement('div', { role: 'menu' }, children)),
    MenuItemButton: ({ children, onSelect, disabled }) => React.createElement('button', { type: 'button', role: 'menuitem', disabled, onClick: onSelect }, children),
    Modal: ({ open, onClose, title, children }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title, onKeyDown: event => { if (event.key === 'Escape') onClose() } }, children) : null,
    ...Object.fromEntries(['IconSettingsOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronDownOutlineRegular', 'IconCloseOutlineRegular'].map(name => [name, () => React.createElement('svg', { 'aria-hidden': true })]))
  }
  const registrations = [], effects = [], dictionaries = new Map()
  const state = { connected: true, phase: 'ready', settingsProtocolVersion, navigation: { settings: { aiAccess: false } } }
  dom.window.dshEnterpriseChat = { state: async () => state, subscribe: listener => { subscribers.add(listener); return () => { subscribers.delete(listener); unregister() } }, retry: vi.fn(async () => {}) }
  dom.window.dshDesktop = { openPhonePairing: vi.fn(async () => {}), settingsInfo: async () => ({ desktopVersion: '1.0.1', harnessVersion: '0.2.0-rc.2' }), settingsAction: vi.fn(async () => {}) }
  dom.window.__ModuleLoader__ = { load: entry => { definition = entry } }
  const resize = vi.fn()
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, AbortController, fetch: request, CustomEvent: dom.window.CustomEvent, ResizeObserver: class { observe = resize; disconnect = vi.fn() } })
  const plugin = definition.factory(id => { if (id === 'react') return React; if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives; throw new Error(id) })
  await act(async () => plugin.apply({
    locale: { register: (ns, values) => { dictionaries.set(ns, values) }, bind: ns => key => dictionaries.get(ns)[language][key] },
    effect: fn => { const dispose = fn(); if (dispose) effects.push(dispose) },
    slots: {
      inject: (_slot, fn) => fn(),
      register: (options, Component) => {
        const entry = { options, Component, active: true }
        registrations.push(entry)
        return () => { entry.active = false }
      }
    }
  }))
  const root = createRoot(document.getElementById('root'))
  cleanup = async () => { await act(async () => { root.unmount(); effects.reverse().forEach(dispose => dispose()) }); dom.window.close() }
  const render = async (name, props = {}) => {
    const entry = registrations.find(row => row.options.name === name && row.active)
    expect(entry).toBeDefined()
    await act(async () => root.render(React.createElement(entry.Component, { ...entry.options.inject?.(), ...props })))
  }
  const mount = async (Component, props) => { await act(async () => root.render(React.createElement(Component, props))) }
  const renderSlot = (name, props, options) => {
    const entry = registrations.find(row => row.options.name === name && row.active)
    return entry ? React.createElement(entry.Component, { ...entry.options.inject?.(), ...props }) : options?.fallback
  }
  return { mount, renderSlot, render, registrations, update: next => subscribers.forEach(listener => listener(next)), root, dom, unregister, request, subscribers, setAccount: next => { account = next } }
}

/** Exercise the installed DSH owners and their real fallbacks without copying their layouts. */
async function builtInComponents(packageName, names) {
  const require = createRequire(import.meta.url)
  const path = require.resolve(`${packageName}/package.json`).replace('package.json', 'lib/client.js')
  const code = (await readFile(path, 'utf8')).replace('exports.apply = apply;', `${names.map(name => `exports.${name} = ${name};`).join(' ')} exports.apply = apply;`)
  let definition
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: next => { definition = next } } }, document, CustomEvent: window.CustomEvent })
  const icons = Object.fromEntries(['Settings', 'User', 'Data', 'AgentPreset', 'Personalization', 'Archive'].map(name => [`Icon${name}OutlineMedium`, () => React.createElement('svg')]))
  return definition.factory(id => ({
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-dom': { createPortal },
    '@deepseek-ai/dsh-client-ui-primitives': { ...icons, IconCloseOutlineRegular: () => React.createElement('svg'), useModalLayer() {} },
    '@deepseek-ai/dsh-client-ui-slots': {},
    '@deepseek-ai/dsh-client-store': {}
  })[id])
}

it.each(['zh', 'en'])('uses DSH flat navigation, General rows and header actions with Bisheng sections (%s)', async language => {
  const f = await fixture(language)
  const { SettingsPanel, GeneralSection } = await builtInComponents('@deepseek-ai/dsh-client-ui-settings-general', ['SettingsPanel', 'GeneralSection'])
  const mounted = new Map(), selected = vi.fn()
  function Entry({ id }) {
    React.useEffect(() => { mounted.set(id, (mounted.get(id) || 0) + 1) }, [id])
    return React.createElement('div', { 'data-row': id }, id)
  }
  const ids = ['language', 'appearance', 'font-size', 'shortcuts', 'permissions', 'plugin-extra']
  const rows = ['general', 'models', 'plugins', 'enterprise-account', 'desktop-usage', 'agent-presets', 'third-party-extra', 'desktop-about'].map(id => ({ id, label: id }))
  const renderSlot = (name, props, options) => {
    if (name === 'settings.header') return language === 'zh' ? '设置' : 'Settings'
    if (name === 'settings.action') return ['open-document', 'third-party-action'].map(id => React.createElement('button', { key: id, 'data-action': id }, id))
    if (name === 'settings.close') return 'Close'
    if (name === 'settings.general.item') return ids.map(id => React.createElement(Entry, { key: id, id }))
    if (name === 'settings.section') return React.createElement(GeneralSection, { useItems: fn => fn(ids), renderSlot })
    return f.renderSlot(name, props, options)
  }
  await f.mount(SettingsPanel, { rows, activeId: 'general', actionItems: ['open-document', 'third-party-action'], renderSlot, onSelect: selected, onClose() {} })
  expect([...document.querySelectorAll('nav button')].map(node => node.textContent)).toEqual(rows.map(row => row.label))
  expect(document.querySelector('details')).toBeNull()
  expect([...document.querySelectorAll('[data-row]')].map(node => node.dataset.row)).toEqual(ids)
  expect([...mounted.values()]).toEqual(ids.map(() => 1))
  expect(document.querySelectorAll('[data-action="open-document"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-action="third-party-action"]')).toHaveLength(1)
  await click([...document.querySelectorAll('nav button')].find(node => node.textContent === 'third-party-extra'))
  expect(selected).toHaveBeenCalledWith('third-party-extra')
})

it.each(['zh', 'en'])('shows recovery with the other About actions without disclosure (%s)', async language => {
  const f = await fixture(language)
  const entry = f.registrations.find(row => row.options.id === 'desktop-about')
  await f.mount(entry.Component, entry.options.inject())
  expect(document.querySelector('details')).toBeNull()
  expect([...document.querySelectorAll('button')].map(node => node.textContent)).toEqual(language === 'zh' ? ['检查更新', '查看日志', '安全模式与插件恢复'] : ['Check for updates', 'Show logs', 'Safe Mode and plugin recovery'])
  await click(document.querySelectorAll('button')[2])
  expect(window.dshDesktop.settingsAction).toHaveBeenCalledWith('safe-mode')
})

it('shows enterprise models alongside Bisheng account content without disclosure', async () => {
  const f = await fixture()
  f.setAccount({ connected: true, modelsAvailable: true, user: { username: 'employee' }, models: [{ id: 'example-model', display_name: 'Example provider / Example model' }] })
  const code = (await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')).replace('exports.apply = apply', 'exports.EnterpriseSection = EnterpriseSection\n    exports.apply = apply')
  let definition
  // The enterprise bundle registers through the same loader used by the fixture.
  window.__ModuleLoader__.load = next => { definition = next }
  vm.runInNewContext(code, { window, document, fetch: f.request, CustomEvent: window.CustomEvent, localStorage: window.localStorage })
  const { EnterpriseSection } = definition.factory(id => { if (id === 'react') return React; throw new Error(id) })
  await f.mount(EnterpriseSection, { t: key => key, renderSlot: () => React.createElement('div', { 'data-account-content': '' }, 'Bisheng account') })
  expect(document.querySelector('.dshEnterpriseManagedModels').tagName).toBe('SECTION')
  expect(document.querySelector('.dshEnterpriseManagedModels h3').textContent).toBe('managedModels')
  expect(document.querySelector('.dshEnterpriseModels').textContent).toContain('Example model')
  expect(document.querySelector('[data-account-content]').textContent).toBe('Bisheng account')
  expect(document.querySelector('details')).toBeNull()
})

it('uses account capabilities for personal access and releases listeners and owned styles', async () => {
  const f = await fixture()
  const entries = () => f.registrations.filter(row => row.options.id === 'desktop-ai-access' && row.active)
  expect(entries()).toHaveLength(0)
  await act(async () => f.update({ connected: true, navigation: { settings: { aiAccess: true } } }))
  expect(entries()).toHaveLength(1)
  await act(async () => f.update({ connected: true, navigation: { settings: { aiAccess: true } } }))
  expect(entries()).toHaveLength(1)
  await act(async () => f.update({ connected: false }))
  expect(entries()).toHaveLength(0)
  expect(document.querySelectorAll('style[data-plugin-css="dsh-desktop-settings"]')).toHaveLength(1)
  await cleanup(); cleanup = undefined
  expect(f.unregister).toHaveBeenCalledOnce()
})

it.each(['zh', 'en'])('does not present the previous enterprise page through an older desktop host (%s)', async language => {
  const f = await fixture(language, null)
  const surface = vi.fn()
  window.addEventListener('dsh-desktop:settings-surface', surface)
  await f.render('desktop.settings.account')
  expect(document.body.textContent).toContain(language === 'zh' ? '请完全退出并重新启动客户端' : 'Quit and restart the desktop app')
  expect(document.querySelector('.dshSettingsRemote').getAttribute('aria-busy')).toBe('false')
  expect(surface).not.toHaveBeenCalled()
  // A host that supports the protocol may request geometry, but still must await page readiness.
  await act(async () => f.update({ connected: true, phase: 'ready', settingsProtocolVersion: 1 }))
  expect(surface).toHaveBeenCalledOnce()
  expect(surface.mock.calls[0][0].detail.section).toBe('account')
  expect(document.querySelector('.dshSettingsRemote').getAttribute('aria-busy')).toBe('true')
})

it('uses DSH plugin tabs for inventory and enterprise contributions without an Advanced group', async () => {
  const f = await fixture()
  const { PluginsSettingsSection } = await builtInComponents('@deepseek-ai/dsh-client-ui-settings-plugins', ['PluginsSettingsSection'])
  const mounted = new Map()
  function PluginPage({ id }) {
    React.useEffect(() => { mounted.set(id, (mounted.get(id) || 0) + 1) }, [id])
    return React.createElement('div', { 'data-plugin-page': id }, id)
  }
  const rows = ['all', 'enterprise-market', 'desktop-workbenches'].map(id => ({ id, label: id }))
  const renderSlot = (name, props, options) => name === 'settings.plugins.tab' ? React.createElement(PluginPage, { id: options.only }) : f.renderSlot(name, props, options)
  await f.mount(PluginsSettingsSection, { t: key => key, renderSlot, useTabs: fn => fn(rows) })
  const tabs = [...document.querySelectorAll('[role=tab]')]
  expect(tabs.map(node => node.textContent)).toEqual(rows.map(row => row.label))
  expect(document.querySelector('details')).toBeNull()
  expect(document.querySelector('[role=tabpanel]:not([hidden])').textContent).toBe('all')
  await act(async () => tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(document.activeElement).toBe(tabs[1])
  expect(document.querySelector('[role=tabpanel]:not([hidden])').textContent).toBe('enterprise-market')
  await click(tabs[2])
  expect(document.querySelector('[role=tabpanel]:not([hidden])').textContent).toBe('desktop-workbenches')
  await click(tabs[0])
  expect([...mounted.values()]).toEqual([1, 1, 1])
})

const click = async node => { expect(node).not.toBeNull(); await act(async () => node.click()) }
const menuItem = label => [...document.querySelectorAll('[role=menuitem]')].find(node => node.textContent === label)

it.each([true, false])('keeps Chat visible while the sidebar account menu opens and closes (wide=%s)', async wide => {
  const f = await fixture()
  const overlay = vi.fn(), surface = vi.fn(), openSettings = vi.fn()
  window.addEventListener('dsh-desktop:settings-overlay', overlay)
  window.addEventListener('dsh-desktop:settings-surface', surface)
  await f.render('settings.launcher', { wide, openSettings, settingsOpen: false })
  await click(document.querySelector('.dshAccountTrigger'))
  expect(document.querySelector('[role=menu]')).not.toBeNull()
  expect(overlay).not.toHaveBeenCalled()
  expect(surface).not.toHaveBeenCalled()
  expect(openSettings).not.toHaveBeenCalled()
  await click(document.querySelector('.dshAccountTrigger'))
  expect(document.querySelector('[role=menu]')).toBeNull()
  await cleanup(); cleanup = undefined
  expect(overlay).not.toHaveBeenCalled()
  expect(surface).not.toHaveBeenCalled()
})

it.each(['zh', 'en'])('shows one account launcher with four ordered actions and preserves the Settings command (%s)', async language => {
  const f = await fixture(language)
  const openSettings = vi.fn()
  expect(f.registrations.some(row => row.options.id === 'desktop-messages')).toBe(false)
  expect(f.registrations.some(row => row.options.name === 'sidebar.footer.action')).toBe(false)
  await f.render('settings.launcher', { wide: true, openSettings, settingsOpen: false })
  expect(document.querySelector('[data-dsh-account-launcher]').textContent).toContain('张三')
  expect(document.querySelector('[role=menu]')).toBeNull()
  await click(document.querySelector('.dshAccountTrigger'))
  const labels = language === 'zh' ? ['设置', '审批', '连接手机', '退出登录'] : ['Settings', 'Approvals', 'Connect phone', 'Log out']
  expect([...document.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(labels)
  await click(menuItem(labels[0]))
  expect(openSettings).toHaveBeenCalledOnce()
  expect(document.querySelector('[role=menu]')).toBeNull()
  await f.render('settings.launcher', { wide: false, openSettings, settingsOpen: false })
  expect(document.querySelector('.dshAccountTriggerCopy')).toBeNull()
  expect(document.querySelector('.dshAccountTrigger').getAttribute('aria-label')).toContain('张三')
})

it('opens approvals outside Settings and releases the document surface when dismissed', async () => {
  const f = await fixture()
  const openSettings = vi.fn(), visibility = vi.fn(), surface = vi.fn()
  window.addEventListener('dsh-desktop:approvals-visibility', visibility)
  window.addEventListener('dsh-desktop:settings-surface', surface)
  await f.render('settings.launcher', { wide: true, openSettings })
  await click(document.querySelector('.dshAccountTrigger'))
  await click(menuItem('审批'))
  expect(openSettings).not.toHaveBeenCalled()
  expect(document.querySelector('[role=dialog]').getAttribute('aria-label')).toBe('审批')
  expect(visibility.mock.calls.at(-1)[0].detail.open).toBe(true)
  expect(surface.mock.calls.at(-1)[0].detail.section).toBe('my-tasks')
  const tabs = [...document.querySelectorAll('[role=tab]')]
  await click(tabs[1])
  expect(surface.mock.calls.at(-1)[0].detail.section).toBe('my-requests')
  await act(async () => window.dispatchEvent(new window.CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'my-requests', direction: 'next' } })))
  expect(document.activeElement).toBe(document.querySelector('[data-dsh-approvals-close]'))
  await click(document.querySelector('[data-dsh-approvals-close]'))
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(visibility.mock.calls.at(-1)[0].detail.open).toBe(false)
  expect(surface.mock.calls.at(-1)[0].detail.close).toBe(true)
  expect(document.activeElement).toBe(document.querySelector('.dshAccountTrigger'))
  await click(document.querySelector('.dshAccountTrigger'))
  await click(menuItem('审批'))
  await act(async () => window.dispatchEvent(new window.CustomEvent('dsh-desktop:close-settings')))
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(document.activeElement).toBe(document.querySelector('.dshAccountTrigger'))
})

it('uses native phone pairing and keeps a failed action retryable', async () => {
  const f = await fixture()
  await f.render('settings.launcher', { wide: true })
  await click(document.querySelector('.dshAccountTrigger'))
  window.dshDesktop.openPhonePairing.mockRejectedValueOnce(new Error('Pairing unavailable'))
  await click(menuItem('连接手机'))
  expect(document.querySelector('[role=alert]').textContent).toContain('操作未完成')
  expect(menuItem('连接手机').disabled).toBe(false)
  expect(document.querySelector('.dshAccountTrigger').textContent).toContain('张三')
  await click(menuItem('连接手机'))
  expect(window.dshDesktop.openPhonePairing).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role=menu]')).toBeNull()
})

it('disables enterprise actions while signed out but keeps device settings and phone pairing available', async () => {
  const f = await fixture('zh', 1, false)
  await f.render('settings.launcher', { wide: true })
  await click(document.querySelector('.dshAccountTrigger'))
  expect(menuItem('设置').disabled).toBe(false)
  expect(menuItem('连接手机').disabled).toBe(false)
  expect(menuItem('审批').disabled).toBe(true)
  expect(menuItem('退出登录').disabled).toBe(true)
})

it('retains the signed-in account after logout fails and discards profile reads completed after successful logout', async () => {
  const f = await fixture()
  await f.render('settings.launcher', { wide: true })
  await click(document.querySelector('.dshAccountTrigger'))
  f.request.mockRejectedValueOnce(new Error('Logout failed'))
  await click(menuItem('退出登录'))
  expect(document.querySelector('[role=alert]')).not.toBeNull()
  expect(document.querySelector('.dshAccountTrigger').textContent).toContain('张三')
  // Begin a slow profile refresh while the menu is closed, then log out.
  await click(document.querySelector('.dshAccountTrigger'))
  let finishRead
  f.request.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
  await click(document.querySelector('.dshAccountTrigger'))
  let finishLogout
  f.request.mockImplementationOnce(() => new Promise(resolve => { finishLogout = resolve }))
  await click(menuItem('退出登录'))
  expect([...document.querySelectorAll('[role=menuitem]')].every(node => node.disabled)).toBe(true)
  expect(document.body.textContent).toContain('正在退出登录')
  f.setAccount({ connected: false })
  await act(async () => finishLogout({ ok: true, json: async () => ({ connected: false }) }))
  await act(async () => finishRead({ ok: true, json: async () => ({ connected: true, user: { display_name: '旧账号' } }) }))
  expect(document.querySelector('.dshAccountTrigger').textContent).toContain('未登录')
  expect(document.querySelector('.dshAccountTrigger').textContent).not.toContain('旧账号')
})
