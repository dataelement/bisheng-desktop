import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const clientPath = require.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json').replace('package.json', 'lib/client.js')
let definition
vm.runInNewContext((await readFile(clientPath, 'utf8')).replace('exports.SlotRegistry = SlotRegistry;', 'exports.createSlotRenderer = createSlotRenderer; exports.SlotRegistry = SlotRegistry;'), { window: { __ModuleLoader__: { load: value => { definition = value } } } })
const { SlotRegistry, createSlotRenderer } = definition.factory(id => {
  if (id === '@deepseek-ai/cordis') return cordis
  if (id === '@deepseek-ai/dsh-client-ui-slots') return slots
  return require(id)
})

const launcher = () => null
const noop = () => null
const settle = () => new Promise(resolve => setImmediate(resolve))

async function fixture(providerFirst) {
  const root = new cordis.Context()
  new SlotRegistry(root).install(createSlotRenderer())
  const binding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  root.slots.installScope('session', { current: { getSnapshot: () => binding, subscribe: () => () => {} } })
  await root.plugin({ inject: ['slots'], apply(ctx) {
    ctx.slots.register({ name: 'root', children: { 'settings.launcher': { kind: 'single', scope: 'root' } } }, ({ renderSlot }) => renderSlot('settings.launcher', {}, { fallback: React.createElement('button', null, 'Settings') }))
  } })
  const cleanup = vi.fn()
  const started = vi.fn()
  const enable = () => root.plugin(ctx => ctx.provide('enterpriseLauncher', {}))
  let provider = providerFirst ? await enable() : undefined
  const settings = await root.plugin({ inject: ['slots'], apply(ctx) {
    ctx.inject(['slots', 'enterpriseLauncher'], scoped => {
      started()
      scoped.effect(() => cleanup)
      scoped.slots.inject('settings.launcher', () => scoped.slots.register({ name: 'settings.launcher', id: 'enterprise' }, launcher))
    })
  } })
  const core = root.slots._core
  return { root, settings, core, cleanup, started, enable, provider }
}

it.each([false, true])('tracks provider lifecycle with providerFirst=%s', async providerFirst => {
  const f = await fixture(providerFirst)
  try {
    if (!providerFirst) {
      expect(f.core.entries('settings.launcher')).toHaveLength(0)
      const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' })
      vi.stubGlobal('window', dom.window)
      vi.stubGlobal('document', dom.window.document)
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      const view = createRoot(document.getElementById('app'))
      await React.act(async () => view.render(f.root.slots.renderSlot('root', {})))
      expect(document.querySelector('button').textContent).toBe('Settings')
      await React.act(async () => view.unmount())
      vi.unstubAllGlobals()
      dom.window.close()
      f.provider = await f.enable()
    }
    await settle()
    expect(f.core.entries('settings.launcher')).toHaveLength(1)
    await f.provider.dispose()
    await settle()
    expect(f.core.entries('settings.launcher')).toHaveLength(0)
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    f.provider = await f.enable()
    await settle()
    expect(f.core.entries('settings.launcher')).toHaveLength(1)
    expect(f.started).toHaveBeenCalledTimes(2)
    await f.settings.dispose()
    await settle()
    expect(f.core.entries('settings.launcher')).toHaveLength(0)
    expect(f.cleanup).toHaveBeenCalledTimes(2)
  } finally {
    await f.root.fiber.dispose()
  }
})

it('rejects competing single registrations without replacing the existing owner', async () => {
  const f = await fixture(false)
  try {
    const release = f.core.register({ name: 'settings.launcher', id: 'other' }, noop)
    expect(() => f.core.register({ name: 'settings.launcher', id: 'enterprise' }, launcher)).toThrow(/already has a registration/)
    expect(f.core.entries('settings.launcher')).toHaveLength(1)
    expect(f.core.entries('settings.launcher')[0].component).toBe(noop)
    release()
    expect(f.core.entries('settings.launcher')).toHaveLength(0)
  } finally {
    await f.root.fiber.dispose()
  }
})

it('mounts real dsh-desktop-settings in public mode and upgrades when dsh-desktop-enterprise provides enterpriseLauncher', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  const loadClientBundle = async (file) => {
    let loaded
    dom.window.__ModuleLoader__ = { load: value => { loaded = value } }
    dom.window.fetch = async () => ({ ok: false, json: async () => ({}) })
    vm.runInNewContext(await readFile(file, 'utf8'), dom.window)
    return loaded.factory(id => {
      if (id === 'react') return React
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return new Proxy({}, { get: () => noop })
      }
      return require(id)
    })
  }
  const settingsPlugin = await loadClientBundle('packages/dsh-desktop-settings/client.js')
  const enterprisePlugin = await loadClientBundle('packages/dsh-desktop-enterprise/client.js')
  const root = new cordis.Context()
  new SlotRegistry(root).install(createSlotRenderer())
  const binding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  root.slots.installScope('session', { current: { getSnapshot: () => binding, subscribe: () => () => {} } })
  root.provide('locale', {
    register: () => () => {},
    bind: () => key => key,
    subscribe: () => () => {}
  })
  await root.plugin({ inject: ['slots'], apply(ctx) {
    ctx.slots.register({
      name: 'root',
      children: {
        'settings.launcher': { kind: 'single', scope: 'root' },
        'settings.navigation': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'collection', scope: 'root' },
        'settings.plugins.tab': { kind: 'collection', scope: 'root' }
      }
    }, noop)
  } })
  try {
    await root.plugin(settingsPlugin)
    await settle()
    expect(root.slots._core.entries('settings.section')).toHaveLength(1)
    expect(root.slots._core.entries('settings.navigation')).toHaveLength(1)
    expect(root.slots._core.entries('settings.launcher')).toHaveLength(0)
    expect(root.slots._core.entries('desktop.account.usage')).toHaveLength(0)

    const enterpriseFork = await root.plugin(enterprisePlugin)
    await settle()
    expect(root.get('enterpriseLauncher')).toEqual({ accountSectionId: 'enterprise-account' })
    expect(root.get('enterpriseWorkResources')).toEqual({ enabled: true })
    expect(root.slots._core.entries('settings.launcher')).toHaveLength(1)
    expect(root.slots._core.entries('desktop.account.usage')).toHaveLength(1)
    expect(root.slots._core.entries('settings.section')).toHaveLength(2)

    await enterpriseFork.dispose()
    await settle()
    expect(root.slots._core.entries('settings.launcher')).toHaveLength(0)
    expect(root.slots._core.entries('desktop.account.usage')).toHaveLength(0)
    expect(root.slots._core.entries('settings.section')).toHaveLength(1)
  } finally {
    await root.fiber.dispose()
    vi.unstubAllGlobals()
    dom.window.close()
  }
})
