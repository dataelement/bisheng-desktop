import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import * as jsx from 'react/jsx-runtime'
import { Context } from '@deepseek-ai/cordis'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8')
const localeSource = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-locale/lib/client.js', import.meta.url), 'utf8')
let cleanup
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })

async function mountMarket(language, capability = { known: true, connected: true, allowThirdPartyWorkbenches: true }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.localStorage.setItem('dsh-workbench-enabled', 'true')
  dom.window.__dshEnterpriseWorkbenchSnapshot = capability
  const definitions = new Map()
  dom.window.__ModuleLoader__ = { load: definition => definitions.set(definition.id, definition) }
  vm.runInNewContext(localeSource + '\n' + source, { window: dom.window, document: dom.window.document, requestAnimationFrame: callback => callback(), setTimeout, clearTimeout, AbortController })
  const { LocaleRuntime } = definitions.get('@deepseek-ai/dsh-client-locale').factory(name =>
    name === 'react' ? React : name === 'react/jsx-runtime' ? jsx : {})
  const localeContext = new Context()
  const locale = new LocaleRuntime(localeContext, undefined, { languages: [language], preference: null })
  const client = definitions.get('dsh-desktop-workbenches').factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/cordis') return { Service: { tracker: Symbol('tracker') } }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: () => null, Toast: () => null }
    throw new Error(`Unexpected module ${name}`)
  })
  const disposers = []
  let service
  client.apply({
    locale,
    reflect: { provide: (_name, value) => { service = value } },
    effect: (callback, label) => {
      if (['workbenches: service', 'workbenches: enterprise locale'].includes(label)) {
        const dispose = callback()
        if (dispose) disposers.push(dispose)
      }
    },
    slots: { inject: () => {} }
  })
  service.ready = true
  service.catalogLoaded = true
  service.enterpriseCatalogStatus = 'empty'
  service.publish()
  const root = createRoot(document.getElementById('root'))
  cleanup = async () => {
    await act(async () => root.unmount())
    service.dispose()
    disposers.reverse().forEach(dispose => dispose())
    await localeContext.fiber.dispose()
    dom.window.close()
  }
  await act(async () => root.render(React.createElement(client.Market, { service })))
  return { locale, service, tab: () => document.getElementById('dsh-workbench-enterprise-tab'), rerender: () => act(async () => { service.publish() }) }
}

it.each([
  [false, false], [false, true], [true, false], [true, true]
])('keeps enterprise first and selected with connected=%s thirdParty=%s', async (connected, allowThirdPartyWorkbenches) => {
  const ui = await mountMarket('zh-CN', { known: true, connected, allowThirdPartyWorkbenches })
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  expect(tabs.map(tab => tab.id)).toEqual([
    'dsh-workbench-enterprise-tab',
    ...(allowThirdPartyWorkbenches ? ['dsh-workbench-market-tab', 'dsh-workbench-favorites-tab'] : []),
    'dsh-workbench-mine-tab'
  ])
  expect(ui.tab().getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('[role="tabpanel"]').id).toBe('dsh-workbench-enterprise-panel')
  if (!connected) {
    expect(document.body.textContent).toContain('登录后查看企业工作台')
    expect(document.body.textContent).not.toContain('正在读取企业工作台')
    await act(async () => ui.locale.setLocale('en'))
    expect(document.body.textContent).toContain('Sign in to view enterprise workbenches')
  }
  const last = tabs.at(-1)
  await act(async () => ui.tab().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement).toBe(last)
  expect(last.getAttribute('aria-selected')).toBe('true')
  await act(async () => last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(document.activeElement).toBe(ui.tab())
  expect(ui.tab().getAttribute('aria-selected')).toBe('true')
})

it('falls back to the enterprise panel when policy hides the selected public market', async () => {
  const capability = { known: true, connected: true, allowThirdPartyWorkbenches: true }
  const ui = await mountMarket('zh-CN', capability)
  await act(async () => document.getElementById('dsh-workbench-market-tab').click())
  expect(document.querySelector('[role="tabpanel"]').id).toBe('dsh-workbench-market-panel')
  capability.allowThirdPartyWorkbenches = false
  await ui.rerender()
  expect(document.getElementById('dsh-workbench-market-tab')).toBeNull()
  expect(ui.tab().getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby')).toBe(ui.tab().id)
  expect(document.querySelector('[role="tabpanel"]').id).toBe(ui.tab().getAttribute('aria-controls'))
})

it.each(['en-US', 'zh-CN'])('localizes the enterprise workbench tab and preserves selection across language changes from %s', async language => {
  const ui = await mountMarket(language)
  const tab = ui.tab()
  expect(tab.textContent).toBe(language === 'en-US' ? 'From enterprise' : '来自企业')
  expect(tab.getAttribute('role')).toBe('tab')
  await act(async () => tab.click())
  expect(tab.getAttribute('aria-selected')).toBe('true')
  expect(document.getElementById(tab.getAttribute('aria-controls'))).toBeTruthy()
  for (const [language, label] of [['zh', '来自企业'], ['en', 'From enterprise'], ['zh', '来自企业']]) {
    await act(async () => ui.locale.setLocale(language))
    expect(ui.tab()).toBe(tab)
    expect(tab.textContent).toBe(label)
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(tab.tabIndex).toBe(0)
  }
})
