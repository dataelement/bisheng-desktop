import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')
const SERVICE = 'http://192.168.106.109:13001'
const LOGIN_LINK = 'bisheng-work://login?server=http%3A%2F%2F192.168.106.109%3A13001'
let cleanup

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
  vi.unstubAllGlobals()
})

function idleAccount() {
  return {
    connected: false,
    secureStorageAvailable: true,
    phase: 'idle',
    base: SERVICE,
    models: [],
    modelsAvailable: false
  }
}

function connectedAccount() {
  return {
    connected: true,
    secureStorageAvailable: true,
    phase: 'connected',
    base: SERVICE,
    models: [],
    modelsAvailable: false,
    user: { display_name: 'Alice' }
  }
}

async function mountEnterprise(initial, hooks = {}) {
  const dom = new JSDOM('<html lang="zh-CN"><div id="root"></div></html>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.open = () => null
  const capturedTimers = []
  if (hooks.captureTimers) {
    const nativeSetTimeout = dom.window.setTimeout.bind(dom.window)
    const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window)
    dom.window.setTimeout = (fn, ms = 0, ...args) => {
      if (ms < 1_000) return nativeSetTimeout(fn, ms, ...args)
      const record = { fn, ms, cleared: false, id: 0 }
      record.id = nativeSetTimeout(() => undefined, 0)
      capturedTimers.push(record)
      return record.id
    }
    dom.window.clearTimeout = (id) => {
      const record = capturedTimers.find((item) => item.id === id)
      if (record) record.cleared = true
      nativeClearTimeout(id)
    }
  }
  let account = initial
  const requests = []
  const loginListeners = new Set()
  dom.window.dshDesktopEnterprise = {
    onLoginLink(listener) {
      loginListeners.add(listener)
      return () => loginListeners.delete(listener)
    },
    consumeLoginLink() {}
  }
  const snapshot = () => structuredClone(account)
  const fetch = async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined
    requests.push({ path, body })
    if (path === '/api/enterprise.login.start' || path === '/api/enterprise.deep-link.confirm') {
      account = connectedAccount()
      return {
        ok: true,
        json: async () => ({ authorizationUrl: 'http://127.0.0.1:9/authorize', base: SERVICE, expiresIn: 60 })
      }
    }
    if (path === '/api/enterprise.logout') {
      account = idleAccount()
      return { ok: true, json: async () => snapshot() }
    }
    if (path === '/api/enterprise.base.inspect' || path === '/api/enterprise.deep-link.inspect') {
      return { ok: true, json: async () => ({ base: SERVICE, insecurePrivateHttp: true }) }
    }
    return { ok: true, json: async () => snapshot() }
  }
  let definition
  dom.window.__ModuleLoader__ = { load: value => { definition = value } }
  vm.runInNewContext(source, {
    window: dom.window,
    document: dom.window.document,
    Date,
    AbortController,
    fetch,
    CustomEvent: dom.window.CustomEvent
  })
  const extension = definition.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: ({ variant, size, ...props }) => React.createElement('button', props) }
    throw new Error(name)
  })
  const disposers = []
  const root = createRoot(dom.window.document.getElementById('root'))
  cleanup = async () => {
    await act(async () => {
      disposers.reverse().forEach(dispose => dispose())
      root.unmount()
    })
    dom.window.close()
  }
  await act(async () => {
    const dictionaries = new Map()
    extension.apply({
      locale: {
        register: (ns, values) => { dictionaries.set(ns, values) },
        bind: ns => key => dictionaries.get(ns).zh[key]
      },
      effect: callback => {
        const dispose = callback()
        if (dispose) disposers.push(dispose)
      },
      slots: {
        inject: (_slot, callback) => callback(),
        register: (config, component) => {
          if (config.id === 'enterprise-account') root.render(React.createElement(component, config.inject()))
          return () => {}
        }
      }
    })
  })
  const text = () => dom.window.document.getElementById('root').textContent
  const click = async (name) => {
    const button = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === name)
    expect(button, name).toBeTruthy()
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  }
  const deliverLoginLink = async (url) => {
    await act(async () => {
      for (const listener of loginListeners) listener(url)
    })
  }
  const flushTimer = async (ms) => {
    const record = capturedTimers.find((item) => item.ms === ms && !item.cleared)
    expect(record, `timer ${ms}`).toBeTruthy()
    record.cleared = true
    await act(async () => record.fn())
  }
  return { text, click, requests, deliverLoginLink, flushTimer, document: dom.window.document }
}

it('drops the trusted-source prompt after sign-in and shows it again only on the next browser login', async () => {
  const { text, click, requests, deliverLoginLink } = await mountEnterprise(idleAccount())
  expect(document.querySelector('input[type="url"]').value).toBe(SERVICE)

  await click('在浏览器中登录')
  expect(text()).toContain('确认为可信来源')

  await click('确认为可信来源')
  expect(requests.find(item => item.path === '/api/enterprise.login.start').body).toEqual({
    base: SERVICE,
    confirmInsecurePrivateHttp: true
  })
  expect(text()).toContain('退出登录')
  expect(text()).not.toContain('确认为可信来源')

  await deliverLoginLink(LOGIN_LINK)
  expect(requests.some(item => item.path === '/api/enterprise.deep-link.inspect')).toBe(true)
  expect(text()).toContain('退出登录')
  expect(text()).not.toContain('确认为可信来源')

  await click('退出登录')
  expect(text()).not.toContain('确认为可信来源')
  expect(text()).toContain('在浏览器中登录')
  expect(document.querySelector('input[type="url"]').value).toBe(SERVICE)

  await click('在浏览器中登录')
  expect(text()).toContain('确认为可信来源')
  expect(text()).toContain(SERVICE)
})

it('ignores a same-origin login link while browser sign-in is already in progress', async () => {
  const { text, requests, deliverLoginLink } = await mountEnterprise({
    ...idleAccount(),
    phase: 'authorizing',
    loginExpiresAt: new Date(Date.now() + 60_000).toISOString()
  })
  expect(text()).toContain('等待浏览器授权…')
  expect(text()).not.toContain('确认为可信来源')

  await deliverLoginLink(LOGIN_LINK)
  expect(requests.some(item => item.path === '/api/enterprise.deep-link.inspect')).toBe(true)
  expect(text()).not.toContain('确认为可信来源')
  expect(text()).not.toContain('确认毕昇平台')
})

it('shows a pending spinner without blocking the one-time code', async () => {
  const { document: page, flushTimer, requests } = await mountEnterprise({
    ...idleAccount(),
    phase: 'authorizing',
    loginExpiresAt: new Date(Date.now() + 60_000).toISOString()
  }, { captureTimers: true })
  await flushTimer(8_000)
  const code = page.querySelector('input[autocomplete="one-time-code"]')
  expect(code.disabled).toBe(false)
  expect(page.querySelector('button[aria-label="刷新状态"]')).toBeNull()
  const pending = page.querySelector('.dshEnterprisePending')
  expect(pending?.getAttribute('role')).toBe('status')
  expect(pending?.querySelector('.dshEnterprisePendingSpinner')).toBeTruthy()
  expect(page.getElementById('root').textContent).toContain('重新登录')
  expect(page.getElementById('root').textContent).toContain('等待浏览器授权…')

  await act(async () => {
    const propsKey = Object.keys(code).find((key) => key.startsWith('__reactProps'))
    code[propsKey].onChange({ target: { value: 'ticket-1' } })
  })
  const submit = [...page.querySelectorAll('button')].find((item) => item.textContent === '完成登录')
  expect(submit.disabled).toBe(false)
  expect(requests.some((item) => item.path === '/api/enterprise.state')).toBe(true)
})
