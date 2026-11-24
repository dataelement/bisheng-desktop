// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const branding = source.slice(source.indexOf('const BISHENG_MARK_PATHS'), source.indexOf('function createSessionRequest('))
let root
let host
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { if (root) act(() => root.unmount()); root = undefined; document.body.replaceChildren() })
function fixture() {
  const context = vm.createContext({ React })
  vm.runInContext(branding, context)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  return config => {
    const state = { navigation: { branding: config } }
    const navigation = { snapshot: () => state, subscribe: () => () => {} }
    act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(context.ConversationBrandMark, { navigation, size: 34, className: 'hero-mark' }),
      React.createElement(context.ConversationBrandTitle, { navigation, t: () => '来一起创造' }))))
  }
}
it('uses enterprise branding and the 34px hero mark size from V1.3.1', () => {
  const render = fixture()
  render({ assistantIcon: { enabled: true, image: 'https://example.test/logo.svg' }, welcomeMessage: 'Enterprise welcome' })
  expect(host.querySelector('img').getAttribute('src')).toBe('https://example.test/logo.svg')
  expect(host.querySelector('img').width).toBe(34)
  expect(host.querySelector('img').height).toBe(34)
  expect(host.textContent).toBe('Enterprise welcome')
  act(() => host.querySelector('img').dispatchEvent(new Event('error')))
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('svg').getAttribute('width')).toBe('34')
  render({ assistantIcon: { image: 'https://example.test/new-logo.svg' }, welcomeMessage: 'New welcome' })
  expect(host.querySelector('img').getAttribute('src')).toContain('new-logo.svg')
  expect(host.textContent).toBe('New welcome')
})
it('honors a disabled logo and restores the branded fallback when configuration is absent', () => {
  const render = fixture()
  render({ assistantIcon: { enabled: false, image: 'https://example.test/logo.svg' } })
  expect(host.querySelector('img,svg')).toBeNull()
  render(undefined)
  const mark = host.querySelector('svg')
  expect(mark.getAttribute('viewBox')).toBe('0 0 2400 2400')
  expect(mark.getAttribute('height')).toBe('34')
  expect(host.textContent).toBe('来一起创造')
})
it('keeps the fallback logo geometry identical to the authoritative brand asset', async () => {
  const render = fixture()
  render(undefined)
  const asset = new DOMParser().parseFromString(await readFile('build/bisheng-logo-mark.svg', 'utf8'), 'image/svg+xml')
  expect([...host.querySelectorAll('path')].map(path => path.getAttribute('d')))
    .toEqual([...asset.querySelectorAll('path')].map(path => path.getAttribute('d')))
})
