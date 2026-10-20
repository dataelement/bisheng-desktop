import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

let cleanup
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })

it('presents approvals independently while preserving native Settings presentation', async () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let definition, Component, value = { mode: 'chat', connected: true, phase: 'ready', settingsProtocolVersion: 1, settingsOpen: false, approvalsOpen: false }
  const listeners = new Set(), effects = []
  const navigation = { start: vi.fn(() => vi.fn()), snapshot: () => value, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
  const update = async patch => { await act(async () => { value = { ...value, ...patch }; listeners.forEach(listener => listener()) }) }
  dom.window.dshEnterpriseChat = { present: vi.fn(async () => {}) }
  dom.window.__ModuleLoader__ = { load: next => { definition = next } }
  const source = await readFile(new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: dom.window.MutationObserver })
  const plugin = definition.factory(id => { if (id === 'react') return React; if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}; throw new Error(id) })
  const locale = { register() {}, bind: () => key => key, getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
  plugin.apply({
    locale, remote: { session: {} },
    effect: setup => { const dispose = setup(); if (dispose) effects.push(dispose) },
    slots: {
      inject: (_name, setup) => { const result = setup(); if (result?.[Symbol.iterator]) [...result]; return result },
      register: (options, component) => { if (options.name === 'desktop.mode.content') Component = component; return () => {} }
    }
  })
  const root = createRoot(document.getElementById('root'))
  cleanup = async () => { await act(async () => { root.unmount(); effects.reverse().forEach(dispose => dispose()) }); dom.window.close() }
  await act(async () => root.render(React.createElement(Component, { navigation, locale, t: key => key, work: React.createElement('div', null, 'Work remains mounted') })))
  const presented = () => window.dshEnterpriseChat.present.mock.calls.at(-1)[0]
  expect(presented().visible).toBe(true)
  await update({ approvalsOpen: true })
  // Never show the previous Chat page while the approvals surface is mounting.
  expect(presented().visible).toBe(false)
  const bounds = { x: 300, y: 180, width: 900, height: 500 }
  await update({ settingsSurface: { section: 'my-tasks', bounds } })
  expect(presented()).toMatchObject({ visible: true, settings: 'my-tasks', bounds })
  expect(value.settingsOpen).toBe(false)
  await update({ approvalsOpen: false, settingsSurface: undefined })
  expect(presented()).toMatchObject({ visible: true })
  expect(presented().settings).toBeUndefined()
  expect(document.body.textContent).toContain('Work remains mounted')
  await update({ settingsOpen: true, settingsSurface: { section: 'account', bounds } })
  expect(presented()).toMatchObject({ visible: true, settings: 'account' })
  await update({ settingsProtocolVersion: undefined })
  expect(presented().visible).toBe(false)
})
