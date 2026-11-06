// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const source = readFileSync('packages/dsh-desktop-client-ui/client.js', 'utf8')
const componentSource = source.slice(source.indexOf('    function WorkResourceAccessory('), source.indexOf('    function installWorkResources('))
const Accessory = new Function('React', 'Modal', 'Button', 'workResourceRequest', `${componentSource}; return WorkResourceAccessory`)(React, () => null, 'button', vi.fn())
let root, container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = undefined
  container?.remove()
  vi.useRealTimers()
})

async function mount() {
  vi.useFakeTimers()
  let phase = 'plain', spaces = [{ id: 7, name: 'Policy' }]
  const listeners = new Set()
  const state = { getSnapshot: () => ({ phase }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
  const knowledge = { state: () => state, read: () => spaces, refresh: vi.fn(async () => {}) }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(Accessory, { sessionId: 'one', controls: new Map(), t: key => key, inputActions: {}, knowledge })))
  return { knowledge, listeners, change: async (nextPhase, nextSpaces = spaces) => {
    phase = nextPhase; spaces = nextSpaces
    await act(async () => listeners.forEach(listener => listener()))
  } }
}

it('refreshes restored drafts, foreground windows and editable reference changes', async () => {
  const { knowledge, change } = await mount()
  expect(knowledge.refresh).toHaveBeenCalledTimes(1)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(knowledge.refresh).toHaveBeenCalledTimes(2)
  await change('plain')
  expect(knowledge.refresh).toHaveBeenCalledTimes(2)
  await change('plain', [{ id: 9, name: 'New space' }])
  expect(knowledge.refresh).toHaveBeenCalledTimes(3)
  await change('submitting')
  expect(knowledge.refresh).toHaveBeenCalledTimes(3)
  await change('plain')
  expect(knowledge.refresh).toHaveBeenCalledTimes(4)
  await act(async () => vi.advanceTimersByTime(30_000))
  expect(knowledge.refresh).toHaveBeenCalledTimes(5)
})

it('cancels obsolete checks and releases listeners and timers on unmount', async () => {
  const { knowledge, listeners } = await mount()
  const first = knowledge.refresh.mock.calls[0][1]
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(first.aborted).toBe(true)
  const current = knowledge.refresh.mock.calls.at(-1)[1]
  await act(async () => root.unmount())
  root = undefined
  expect(current.aborted).toBe(true)
  expect(listeners.size).toBe(0)
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(60_000)
  })
  expect(knowledge.refresh).toHaveBeenCalledTimes(2)
})
