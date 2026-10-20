import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile(new URL('../packages/dsh-desktop-settings/client.js', import.meta.url), 'utf8')
let cleanup
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })

async function fixture(language = 'zh', settingsProtocolVersion = 1) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let definition, update
  const unregister = vi.fn()
  const registrations = [], effects = [], dictionaries = new Map()
  const state = { connected: true, phase: 'ready', settingsProtocolVersion, navigation: { settings: { aiAccess: false } } }
  dom.window.dshEnterpriseChat = { state: async () => state, subscribe: listener => { update = listener; return unregister }, retry: vi.fn(async () => {}) }
  dom.window.dshDesktop = { settingsInfo: async () => ({ desktopVersion: '1.0.1', harnessVersion: '0.2.0-rc.2' }), settingsAction: vi.fn(async () => {}) }
  dom.window.__ModuleLoader__ = { load: entry => { definition = entry } }
  const resize = vi.fn()
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, ResizeObserver: class { observe = resize; disconnect = vi.fn() } })
  const plugin = definition.factory(id => { if (id === 'react') return React; throw new Error(id) })
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
  return { render, registrations, update: next => update(next), root, dom, unregister }
}

it.each(['zh', 'en'])('prioritizes employee settings and keeps unknown contributions accessible once (%s)', async language => {
  const f = await fixture(language)
  const mounted = new Map()
  function Entry({ row }) {
    React.useEffect(() => { mounted.set(row.id, (mounted.get(row.id) || 0) + 1) }, [])
    return React.createElement('button', { 'data-entry': row.id }, row.label)
  }
  const rows = ['general', 'models', 'plugins', 'enterprise-account', 'agent-presets', 'third-party-extra', 'desktop-usage', 'desktop-about', 'desktop-messages'].map(id => ({ id, label: id }))
  await f.render('settings.navigation', { rows, activeId: 'general', renderEntry: row => React.createElement(Entry, { key: row.id, row }) })
  const direct = [...document.querySelector('.dshSettingsNav').children].filter(node => node.tagName === 'BUTTON').map(node => node.dataset.entry)
  expect(direct).toEqual(['general', 'enterprise-account', 'desktop-usage', 'plugins', 'desktop-about'])
  expect(document.querySelector('details').open).toBe(false)
  expect(document.querySelector('details [data-entry="third-party-extra"]')).not.toBeNull()
  expect([...mounted.values()]).toEqual(rows.map(() => 1))
  await f.render('settings.navigation', { rows, activeId: 'third-party-extra', renderEntry: row => React.createElement(Entry, { key: row.id, row }) })
  expect(document.querySelector('details').open).toBe(true)
  expect([...mounted.values()]).toEqual(rows.map(() => 1))
  expect(document.querySelector('[data-entry="general"]').textContent).toBe(language === 'zh' ? '通用' : 'General')
})

it('folds execution preferences while preserving every feature-owned row and action', async () => {
  const f = await fixture()
  const rendered = vi.fn(id => React.createElement('div', { 'data-row': id }, id))
  const ids = ['language', 'appearance', 'font-size', 'shortcuts', 'permissions', 'plugin-extra']
  await f.render('settings.general.layout', { items: ids.map(id => ({ id, render: () => rendered(id) })) })
  const folded = [...document.querySelectorAll('details [data-row]')].map(node => node.dataset.row)
  expect(folded).toEqual(['permissions', 'plugin-extra'])
  expect(rendered).toHaveBeenCalledTimes(ids.length)
  expect(document.querySelector('details').open).toBe(false)
  await f.render('settings.actions.layout', { items: ['open-document', 'third-party-action'].map(id => ({ id, render: () => React.createElement('button', { 'data-action': id }, id) })) })
  expect(document.querySelector('details [data-action="open-document"]')).not.toBeNull()
  expect(document.querySelector('[data-action="third-party-action"]').closest('details')).toBeNull()
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

it('keeps technical plugin inventory folded and mounts its page only when requested', async () => {
  const f = await fixture()
  const renderInventory = vi.fn(() => React.createElement('div', null, 'technical-inventory'))
  const renderEnterprise = vi.fn(() => React.createElement('div', null, 'company-extensions'))
  await f.render('settings.plugins.layout', { items: [{ id: 'all', label: 'Inventory', render: renderInventory }, { id: 'enterprise-market', label: 'Company', render: renderEnterprise }] })
  expect(document.body.textContent).toContain('company-extensions')
  expect(document.body.textContent).not.toContain('technical-inventory')
  expect(renderInventory).not.toHaveBeenCalled()
  const details = [...document.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === 'Inventory')
  await act(async () => { details.open = true; details.dispatchEvent(new window.Event('toggle')) })
  expect(document.body.textContent).toContain('technical-inventory')
  expect(document.querySelectorAll('details').length).toBe(2)
})

it('supports keyboard selection between employee extension tabs without mounting technical inventory', async () => {
  const f = await fixture()
  const inventory = vi.fn(() => React.createElement('div', null, 'inventory'))
  await f.render('settings.plugins.layout', { items: [
    { id: 'enterprise-market', label: 'Company', render: () => React.createElement('div', null, 'company-panel') },
    { id: 'desktop-workbenches', label: 'Workbenches', render: () => React.createElement('div', null, 'workbench-panel') },
    { id: 'all', label: 'Inventory', render: inventory }
  ] })
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  await act(async () => tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tabs[1])
  expect(document.querySelector('[role="tabpanel"]:not([hidden])').textContent).toBe('workbench-panel')
  expect(inventory).not.toHaveBeenCalled()
})
