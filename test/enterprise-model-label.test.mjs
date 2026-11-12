// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

// F015: the credit ratio after BiSheng model names in the Work model picker.
// jsdom replaces the global URL, so resolve the bundle path without it.
const source = readFileSync(path.join(import.meta.dirname, '../packages/dsh-desktop-enterprise/client.js'), 'utf8')
function slice(from, to) {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  if (start < 0 || end < 0) throw new Error(`Missing client.js region: ${from}`)
  return source.slice(start, end)
}
const badge = slice('    function pricingHintBadge(', '    function renderModelRow(')
const label = slice('    function createPricingHintStore()', '    function bindEnterpriseModelSync(')
const SLOT = 'conversation.input.model.label'
const Tag = ({ tone, children }) => React.createElement('em', { 'data-tone': tone }, children)
const { createPricingHintStore, PricingModelLabel, bindModelPricingLabel } = vm.runInNewContext(
  `${badge}\n${label}\n({ createPricingHintStore, PricingModelLabel, bindModelPricingLabel })`,
  {
    React, h: React.createElement, NS: 'settings.desktopEnterprise',
    BISHENG_PROVIDER_ROUTE: 'bisheng-enterprise', MODEL_LABEL_SLOT: SLOT,
    require: (id) => {
      if (id !== '@deepseek-ai/dsh-client-ui-primitives') throw new Error(`unexpected require ${id}`)
      return { Tag }
    }
  }
)

const hint = (ratio, extra = {}) => ({ ratio, base: false, free: false, ...extra })
const connected = (...models) => ({ connected: true, models })
const t = (key) => key
const bisheng = { id: 'bisheng-enterprise', name: 'Acme' }
const roots = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()) })

function fakeSlots() {
  const registrations = []
  const slots = {
    inject: vi.fn((name, callback) => {
      const release = callback()
      return () => release()
    }),
    register: vi.fn((options, component) => {
      const entry = { options, component, live: true }
      registrations.push(entry)
      return () => { entry.live = false }
    })
  }
  return { ctx: { slots }, registrations, live: () => registrations.filter(entry => entry.live) }
}

function mount(element) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(element))
  return container
}

it('keeps hints of the signed-in account only and notifies on real changes', () => {
  const store = createPricingHintStore()
  const listener = vi.fn()
  store.subscribe(listener)
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }, { id: 'bisheng:2' }))
  expect(store.size).toBe(1)
  expect(store.get('bisheng:1')).toEqual(hint('3.00'))
  expect(listener).toHaveBeenCalledTimes(1)
  const version = store.version()
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }))
  expect(store.version()).toBe(version)
  expect(listener).toHaveBeenCalledTimes(1)
  store.ingest({ connected: false, models: [{ id: 'bisheng:1', pricing_hint: hint('3.00') }] })
  expect(store.size).toBe(0)
  store.ingest(undefined)
  expect(listener).toHaveBeenCalledTimes(2)
})

it('registers below the DeepSeek badge only while hints exist and releases on sign-out and unload', () => {
  const store = createPricingHintStore()
  const { ctx, live } = fakeSlots()
  const dispose = bindModelPricingLabel(ctx, store)
  expect(ctx.slots.inject).not.toHaveBeenCalled()
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }))
  expect(live()).toHaveLength(1)
  expect(live()[0].options).toEqual({ name: SLOT, locale: 'settings.desktopEnterprise', priority: -1 })
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('2.00') }))
  expect(ctx.slots.register).toHaveBeenCalledTimes(1)
  store.ingest({ connected: false, models: [] })
  expect(live()).toHaveLength(0)
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('2.00') }))
  expect(live()).toHaveLength(1)
  dispose()
  expect(live()).toHaveLength(0)
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('4.00') }))
  expect(live()).toHaveLength(0)
})

it('adds the ratio to BiSheng models and leaves every other label as the catalog name', () => {
  const store = createPricingHintStore()
  store.ingest(connected(
    { id: 'bisheng:1', pricing_hint: hint('3.00') },
    { id: 'bisheng:2', pricing_hint: hint('1.00', { base: true }) },
    { id: 'bisheng:3', pricing_hint: hint(null, { free: true }) },
    { id: 'bisheng:4', pricing_hint: hint(null) }
  ))
  const render = (provider, id) => mount(React.createElement(PricingModelLabel, {
    provider, model: { id, name: `Model ${id}` }, placement: 'option', selected: false, t, hints: store
  }))
  expect(render(bisheng, 'bisheng:1').innerHTML).toBe('<span class="dshEnterpriseModelLabel"><span>Model bisheng:1</span><em data-tone="neutral">3.00x</em></span>')
  expect(render(bisheng, 'bisheng:2').textContent).toBe('Model bisheng:21.00x · ratioBase')
  expect(render(bisheng, 'bisheng:3').querySelector('em')?.textContent).toBe('ratioFree')
  expect(render(bisheng, 'bisheng:4').innerHTML).toBe('Model bisheng:4')
  expect(render(bisheng, 'bisheng:9').innerHTML).toBe('Model bisheng:9')
  // Another provider reusing a BiSheng-looking id keeps its own name.
  expect(render({ id: 'deepseek-official', name: 'DeepSeek' }, 'bisheng:1').innerHTML).toBe('Model bisheng:1')
})

it('updates mounted labels when the next catalog refresh changes the ratio', () => {
  const store = createPricingHintStore()
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }))
  const container = mount(React.createElement(PricingModelLabel, {
    provider: bisheng, model: { id: 'bisheng:1', name: 'Qwen' }, placement: 'trigger', selected: true, t, hints: store
  }))
  expect(container.textContent).toBe('Qwen3.00x')
  act(() => store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('0.50') })))
  expect(container.textContent).toBe('Qwen0.50x')
  act(() => store.ingest(connected({ id: 'bisheng:1' })))
  expect(container.textContent).toBe('Qwen')
})
