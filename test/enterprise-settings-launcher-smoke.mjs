import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
const globals = ['window', 'document', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT']
const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
const links = new Set()
dom.window.dshDesktopEnterprise = { onLoginLink(callback) { links.add(callback); return () => links.delete(callback) } }
const primitives = {
  Menu: ({ anchor, open, children }) => React.createElement(React.Fragment, null, anchor, open ? children : null),
  MenuItemButton: ({ children, onSelect, disabled }) => React.createElement('button', { onClick: onSelect, disabled }, children),
  Modal: ({ open, children }) => open ? React.createElement('div', null, children) : null
}
const source = await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')
let definition
dom.window.__ModuleLoader__ = { load: value => { definition = value } }
runInNewContext(source.replace('exports.apply = apply', 'exports.launcherTest = { AccountLauncher, RemoteSettings }; exports.apply = apply'), {
  window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, AbortController,
  fetch: async () => Response.json({ connected: false })
})
const { AccountLauncher, RemoteSettings } = definition.factory(name => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw Error('Unexpected enterprise client import: ' + name)
}).launcherTest
const root = createRoot(dom.window.document.getElementById('root'))
const sections = [], fallback = [], close = [], focus = []
const t = key => key === 'numberLocale' ? 'en-US' : key
try {
  await act(async () => root.render(React.createElement(AccountLauncher, { wide: true, settingsOpen: false, openSettings: () => fallback.push('open'), openSettingsSection: id => sections.push(id), t })))
  assert.equal(links.size, 1)
  await act(async () => { for (const callback of links) callback('bisheng://enterprise-login') })
  assert.deepEqual(sections, ['enterprise-account'])
  await act(async () => {
    for (const id of ['desktop-ai-access', 'desktop-about', 'unowned-section']) dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:open-settings-section', { detail: { id } }))
  })
  assert.deepEqual(sections, ['enterprise-account', 'desktop-ai-access', 'desktop-about'])
  assert.deepEqual(fallback, [])
  await act(async () => root.render(React.createElement(AccountLauncher, { wide: false, settingsOpen: false, openSettings: () => fallback.push('fallback'), t })))
  assert.equal(links.size, 1)
  await act(async () => { for (const callback of links) callback('bisheng://enterprise-login') })
  assert.deepEqual(fallback, ['fallback'])
  await act(async () => root.render(React.createElement(RemoteSettings, { section: 'ai-access', close: () => close.push('close'), focusShell: direction => focus.push(direction), t })))
  assert.equal(links.size, 0)
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:close-settings'))
    for (const detail of [{ section: 'ai-access', direction: 'previous' }, { section: 'other', direction: 'next' }, { section: 'ai-access', direction: 'invalid' }, { section: 'ai-access', direction: 'next' }]) dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:settings-focus', { detail }))
  })
  assert.deepEqual(close, ['close'])
  assert.deepEqual(focus, ['previous', 'next'])
  await act(async () => root.unmount())
  dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:close-settings'))
  dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-desktop:settings-focus', { detail: { section: 'ai-access', direction: 'next' } }))
  assert.deepEqual(close, ['close'])
  assert.deepEqual(focus, ['previous', 'next'])
  console.log('PASS')
} finally {
  dom.window.close()
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}
