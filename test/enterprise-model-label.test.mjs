// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

// F016: the credit ratio after BiSheng model names in the Work model picker. It is styled onto the
// picker's own name wrapper instead of taking the single label slot, so the DeepSeek 1017 badge stays.
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
const { createPricingHintStore, bindModelPricingLabel, modelRatioCss } = vm.runInNewContext(
  `${badge}\n${label}\n({ createPricingHintStore, bindModelPricingLabel, modelRatioCss })`,
  { document, NS: 'settings.desktopEnterprise', BISHENG_PROVIDER_ROUTE: 'bisheng-enterprise' }
)

const hint = (ratio, extra = {}) => ({ ratio, base: false, free: false, ...extra })
const connected = (...models) => ({ connected: true, models })
const style = () => document.getElementById('dsh-desktop-enterprise-model-ratio')
const owner = '[data-provider-id="bisheng-enterprise"]'

function fakeLocale(language = 'zh') {
  const copy = { zh: { ratioFree: '免费', ratioBase: '基准' }, en: { ratioFree: 'Free', ratioBase: 'Base' } }
  const listeners = new Set()
  const locale = {
    language,
    bind: vi.fn((ns) => (key) => { expect(ns).toBe('settings.desktopEnterprise'); return copy[locale.language][key] }),
    subscribe: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener) }),
    switch(next) { locale.language = next; listeners.forEach((listener) => listener()) }
  }
  return locale
}

const disposers = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })

it('keeps hints of the signed-in account only and notifies on real changes', () => {
  const store = createPricingHintStore()
  const listener = vi.fn()
  store.subscribe(listener)
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }, { id: 'bisheng:2' }))
  expect(store.size).toBe(1)
  expect(store.get('bisheng:1')).toEqual(hint('3.00'))
  expect([...store.entries()]).toEqual([['bisheng:1', hint('3.00')]])
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

it('styles a badge per BiSheng model and leaves other providers and unpriced models alone', () => {
  const store = createPricingHintStore()
  store.ingest(connected(
    { id: 'bisheng:1', pricing_hint: hint('3.00') },
    { id: 'bisheng:2', pricing_hint: hint('1.00', { base: true }) },
    { id: 'bisheng:3', pricing_hint: hint(null, { free: true }) },
    { id: 'bisheng:4', pricing_hint: hint(null) }
  ))
  const css = modelRatioCss(store, (key) => ({ ratioFree: '免费', ratioBase: '基准' })[key])
  expect(css).toContain(`${owner}[data-model-id="bisheng:1"]::after { content: "3.00x"; background: var(--dsw-alias-bg-module-platform)`)
  // The picker is narrow: the base model reads a plain "1.00x" in the business tone.
  expect(css).toContain(`${owner}[data-model-id="bisheng:2"]::after { content: "1.00x"; background: color-mix(in srgb, var(--dsw-alias-state-business-primary)`)
  expect(css).toContain(`${owner}[data-model-id="bisheng:3"]::after { content: "免费"; background: color-mix(in srgb, var(--dsw-alias-state-success-primary)`)
  expect(css).not.toContain('bisheng:4')
  // Every rule is scoped to the BiSheng provider, so a DeepSeek model with the same id is untouched.
  expect(css.split('\n').every((rule) => rule.startsWith(owner))).toBe(true)
  expect(modelRatioCss(createPricingHintStore(), () => '')).toBe('')
})

it('cannot be broken out of by a model id or copy carrying CSS syntax', () => {
  const store = createPricingHintStore()
  store.ingest(connected({ id: 'bisheng:"] body { display: none } [x="\n', pricing_hint: hint('3.00') }))
  const css = modelRatioCss(store, () => '')
  expect(css).toContain('[data-model-id="bisheng:\\"] body { display: none } [x=\\" "]::after')
  expect(css).not.toContain('\nbody')
})

it('keeps one style in step with hints and locale, without touching the label slot, and removes it on unload', () => {
  const store = createPricingHintStore()
  const locale = fakeLocale('zh')
  const dispose = bindModelPricingLabel(locale, store)
  disposers.push(dispose)
  expect(style().textContent).toBe('')
  expect(style().getAttribute('data-plugin-css')).toBe('dsh-desktop-enterprise')
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('3.00') }, { id: 'bisheng:3', pricing_hint: hint(null, { free: true }) }))
  expect(style().textContent).toContain('content: "3.00x"')
  expect(style().textContent).toContain('content: "免费"')
  locale.switch('en')
  expect(style().textContent).toContain('content: "Free"')
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('0.50') }))
  expect(style().textContent).toContain('content: "0.50x"')
  expect(style().textContent).not.toContain('Free')
  store.ingest({ connected: false, models: [] })
  expect(style().textContent).toBe('')
  expect(document.querySelectorAll('#dsh-desktop-enterprise-model-ratio')).toHaveLength(1)
  dispose()
  disposers.length = 0
  expect(style()).toBeNull()
  store.ingest(connected({ id: 'bisheng:1', pricing_hint: hint('4.00') }))
  expect(style()).toBeNull()
})
