import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
const source = await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')
it.each(['zh', 'en'])('renders legacy-server upgrade guidance without a request id in %s', async language => {
  const dom = new JSDOM('<html><div id="root"></div></html>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const state = { connected: false, secureStorageAvailable: true, phase: 'idle', error: 'seat not assigned', errorCode: 'seat_not_assigned', requestId: 'req-no-seat' }
  let definition
  dom.window.__ModuleLoader__ = { load: value => { definition = value } }
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, Date, AbortController, fetch: async () => ({ ok: true, json: async () => state }), CustomEvent: dom.window.CustomEvent })
  const extension = definition.factory(name => { if (name === 'react') return React; throw new Error(name) })
  const root = createRoot(dom.window.document.getElementById('root'))
  const disposers = [], dictionaries = new Map()
  try {
    await act(async () => {
      extension.apply({ locale: {
        register: (ns, values) => { dictionaries.set(ns, values) },
        bind: ns => key => dictionaries.get(ns)[language][key]
      }, effect: callback => { const dispose = callback(); if (dispose) disposers.push(dispose) }, slots: {
        inject: (_slot, callback) => callback(),
        register: (config, component) => { if (config.id === 'enterprise-account') root.render(React.createElement(component, config.inject())); return () => {} }
      } })
    })
    const alert = dom.window.document.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(language === 'zh'
      ? '当前服务版本不支持直接登录，请联系管理员升级平台。'
      : 'This server uses a legacy sign-in policy. Ask your administrator to upgrade the platform.')
    expect(alert?.textContent).not.toContain('req-no-seat')
  } finally {
    await act(async () => { disposers.reverse().forEach(dispose => dispose()); root.unmount() })
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
