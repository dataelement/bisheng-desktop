import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'

const source = (await readFile(new URL('../packages/dsh-desktop-enterprise/client.js', import.meta.url), 'utf8')).replace('    function AiAccess({ t })', '    exports.Usage = Usage\n    function AiAccess({ t })')
const totals = { message_count: 3, input_tokens: 10, output_tokens: 5, total_tokens: 15, missing_usage_count: 0 }
const summary = { start_at: '2026-10-22T00:00:00+08:00', end_at: '2026-10-23T00:00:00+08:00', timezone: 'Asia/Shanghai', granularity: 'day', totals, points: [{ ...totals, start_at: '2026-10-22T00:00:00+08:00', end_at: '2026-10-23T00:00:00+08:00' }] }
const ok = data => new Response(JSON.stringify({ status_code: 200, data }))
async function setup(request) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let definition
  dom.window.__ModuleLoader__ = { load: value => { definition = value } }
  vm.runInNewContext(source, { window: dom.window, document: dom.window.document, fetch: request, AbortController, TextDecoder, Uint8Array, CustomEvent: dom.window.CustomEvent })
  const plugin = definition.factory(id => { if (id === 'react') return React; if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}; throw Error(id) })
  const root = createRoot(document.getElementById('root'))
  const t = key => key === 'numberLocale' ? 'en-US' : key
  const render = async identity => act(async () => root.render(React.createElement(plugin.Usage, { t, credits: '5', creditsLabel: 'credits', usageIdentity: identity })))
  await render(JSON.stringify(['base', 'tenant-a', 'user']))
  const cleanup = async () => { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals() }
  cleanup.render = render
  return cleanup
}
it('loads same-origin statistics and storage into the existing heatmap', async () => {
  const request = vi.fn(async path => ok(path.endsWith('usage-summary') ? summary : [{ resource_type: 'knowledge_space_file', user_used: 0.5, effective: -1 }]))
  const cleanup = await setup(request)
  expect(request.mock.calls.map(call => call[0])).toEqual(['/api/v1/dsh/me/usage-summary', '/api/v1/quota/effective'])
  expect(request.mock.calls[0][1].credentials).toBe('same-origin')
  expect(document.querySelectorAll('.dshUsageGrid [role=listitem]')).toHaveLength(1)
  expect(document.querySelector('.dshUsageStorage')).not.toBeNull()
  await cleanup()
})
it('rejects invalid summary independently and retries', async () => {
  let invalid = true
  const request = vi.fn(async path => ok(path.endsWith('usage-summary') ? (invalid ? { ...summary, points: [{ ...summary.points[0], message_count: -1 }] } : summary) : []))
  const cleanup = await setup(request)
  expect(document.body.textContent).toContain('usageError')
  expect(document.querySelector('.dshUsageStorage')).not.toBeNull()
  invalid = false
  await act(async () => document.querySelector('[role=alert] button').click())
  expect(document.querySelectorAll('.dshUsageGrid [role=listitem]')).toHaveLength(1)
  await cleanup()
})
it('handles 401, empty points, and independent storage failure', async () => {
  let mode = 'unauthorized'
  const request = vi.fn(async path => mode === 'unauthorized' ? new Response('', { status: 401 }) : path.endsWith('usage-summary') ? ok({ ...summary, points: [] }) : new Response('', { status: 500 }))
  const cleanup = await setup(request)
  expect(document.body.textContent).toContain('usageError')
  expect(document.body.textContent).toContain('storageError')
  mode = 'empty'
  await act(async () => document.querySelector('[role=alert] button').click())
  expect(document.body.textContent).toContain('noUsage')
  expect(document.body.textContent).toContain('storageError')
  expect(document.querySelectorAll('.dshUsageGrid [role=listitem]')).toHaveLength(0)
  await cleanup()
})
it('cancels old identity requests and ignores late results', async () => {
  const pending = [], signals = []
  const request = vi.fn((_path, options) => { signals.push(options.signal); return new Promise(resolve => pending.push(resolve)) })
  const cleanup = await setup(request)
  // Same user and base, but a different tenant must invalidate the request.
  await cleanup.render(JSON.stringify(['base', 'tenant-b', 'user']))
  expect(signals.slice(0, 2).every(signal => signal.aborted)).toBe(true)
  await act(async () => { pending[2](ok({ ...summary, points: [] })); pending[3](ok([])) })
  expect(document.body.textContent).toContain('noUsage')
  await act(async () => { pending[0](ok(summary)); pending[1](ok([])) })
  expect(document.querySelectorAll('.dshUsageGrid [role=listitem]')).toHaveLength(0)
  await cleanup()
})
it('times out stalled Web requests', async () => {
  const signals = []
  const request = vi.fn((_path, options) => { signals.push(options.signal); return new Promise(() => {}) })
  const cleanup = await setup(request)
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 15100)) })
  expect(signals.every(signal => signal.aborted)).toBe(true)
  expect(document.body.textContent).toContain('usageError')
  await cleanup()
}, 20000)
it('aborts pending requests on unmount', async () => {
  const signals = []
  const request = vi.fn((_path, options) => { signals.push(options.signal); return new Promise(() => {}) })
  const cleanup = await setup(request)
  await cleanup()
  expect(signals).toHaveLength(2)
  expect(signals.every(signal => signal.aborted)).toBe(true)
})
