import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const code = await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8')

function setup({ enabled, publicMarket }) {
  let client, tab, snapshot = { active: 'en', revision: 0 }
  const dictionaries = new Map()
  const listeners = new Set()
  const dispose = []
  const invalidate = vi.fn()
  const storage = new Map([['dsh-workbench-enabled', String(enabled)]])
  const locale = {
    register: (ns, copy) => { dictionaries.set(ns, copy); return () => dictionaries.delete(ns) },
    bind: ns => key => dictionaries.get(ns)[snapshot.active][key],
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }
  }
  const window = {
    __dshEnterpriseWorkbenchSnapshot: { known: true, connected: true, allowThirdPartyWorkbenches: publicMarket },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    __ModuleLoader__: { load({ factory }) {
      client = factory(name => {
        if (name === 'react') return { ...React, useSyncExternalStore: (subscribe, getSnapshot) => {
          dispose.push(subscribe(invalidate))
          return getSnapshot()
        } }
        if (name === '@deepseek-ai/cordis') return { Service: { tracker: Symbol('tracker') } }
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
          Switch: ({ checked, label }) => React.createElement('button', { role: 'switch', 'aria-checked': checked, 'aria-label': label })
        }
        throw new Error(`Unexpected module ${name}`)
      })
    } }
  }
  vm.runInNewContext(code, { window, setTimeout, clearTimeout, AbortController, fetch: async () => ({ ok: false }) })
  client.apply({
    locale,
    effect: (callback, label) => {
      if (['workbenches: settings dictionaries', 'workbenches: enterprise capability'].includes(label)) {
        const cleanup = callback()
        if (cleanup) dispose.push(cleanup)
      }
    },
    slots: {
      inject: (name, callback) => name === 'settings.plugins.tab' ? callback() : undefined,
      register: (options, Component) => { tab = { ...options, Component }; return () => {} }
    }
  })
  return {
    tab,
    invalidate,
    render: () => renderToStaticMarkup(tab.Component()),
    switchLanguage: active => { snapshot = { active, revision: snapshot.revision + 1 }; listeners.forEach(listener => listener()) },
    dispose: () => dispose.reverse().forEach(cleanup => cleanup())
  }
}

describe('workbench settings locale', () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true]
  ])('updates the tab, accessible switch and help text with enabled=%s publicMarket=%s', (enabled, publicMarket) => {
    const ui = setup({ enabled, publicMarket })
    try {
      expect(ui.tab.label()).toBe('Workbenches')
      const english = ui.render()
      expect(english).toContain('<h2>Workbenches</h2>')
      expect(english).toContain('aria-label="Show workbenches in the sidebar"')
      expect(english).toContain(`aria-checked="${enabled}"`)
      expect(english).toContain(enabled
        ? publicMarket ? 'The list comes from the network workbench market.' : 'The workbench market shows workbenches uploaded by your enterprise'
        : 'Turn this on to access workbenches next to Sessions in the sidebar.')
      expect(english).not.toMatch(/[\u4e00-\u9fff]/)

      ui.switchLanguage('zh')
      expect(ui.invalidate).toHaveBeenCalled()
      expect(ui.tab.label()).toBe('工作台')
      const chinese = ui.render()
      expect(chinese).toContain('<h2>工作台</h2>')
      expect(chinese).toContain('aria-label="在左侧显示工作台"')
      expect(chinese).toContain(enabled
        ? publicMarket ? '列表来自网络工作台市场' : '工作台市场展示本企业上传的工作台'
        : '开启后，可以在左侧会话旁进入工作台。')

      ui.switchLanguage('en')
      expect(ui.tab.label()).toBe('Workbenches')
      expect(ui.render()).toBe(english)
    } finally { ui.dispose() }
  })
})
