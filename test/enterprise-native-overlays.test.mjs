// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ handlers: new Map(), invoke: vi.fn(async () => ({ phase: 'idle', currentVersion: '1.0.0', manual: false })) }))
vi.mock('electron', () => ({ ipcRenderer: {
  on: (channel, listener) => ipc.handlers.set(channel, listener),
  removeListener: channel => ipc.handlers.delete(channel), invoke: ipc.invoke
} }))
const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
let root
const visibilityDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  if (root) act(() => root.unmount())
  root = undefined
  if (visibilityDescriptor) Object.defineProperty(Element.prototype, 'checkVisibility', visibilityDescriptor)
  else delete Element.prototype.checkVisibility
  window.dispatchEvent(new Event('unload'))
  document.getElementById('dsh-desktop-about-root')?.remove()
  document.getElementById('dsh-desktop-update-root')?.remove()
  ipc.handlers.clear()
  document.body.replaceChildren()
  delete document.documentElement.dataset.platform
  vi.restoreAllMocks()
  delete window.dshEnterpriseChat
  vi.useRealTimers()
})
function fixture({ capture, palette, initialState = {} } = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const bounds = { x: 200, y: 48, width: 800, height: 600, right: 1000, bottom: 648 }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(bounds)
  Element.prototype.checkVisibility = function () {
    for (let node = this; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  }
  const ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  const context = vm.createContext({ React, window, document, Element, HTMLDialogElement, MutationObserver, ResizeObserver,
    getComputedStyle, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, console,
    fetch: vi.fn(async () => ({})), hostPalette: () => palette })
  vm.runInContext(source.slice(source.indexOf('function observeHostOverlays('), source.indexOf('const NAV_ICON_PATHS =')), context)
  const present = vi.fn(async () => ({}))
  window.dshEnterpriseChat = { present, capture }
  let state = { mode: 'chat', phase: 'ready', connected: true, epoch: 1, conversationId: 'existing', settingsProtocolVersion: 1, ...initialState }
  const listeners = new Set()
  const empty = { subscribe: () => () => {}, getSnapshot: () => null }
  const project = { editor: null }
  const navigation = { snapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    projects: { snapshot: () => project, subscribe: () => () => {} }, deletion: empty, renaming: empty, start: () => () => {} }
  const locale = { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} }
  root = createRoot(document.getElementById('root'))
  act(() => root.render(React.createElement(context.DesktopModes, { work: null, navigation, t: key => key, locale })))
  return { context, present, change: async patch => { await act(async () => { state = { ...state, ...patch }; for (const fn of listeners) fn() }) } }
}
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }) }
it('yields to the actual preload About dialog in a closed shadow root outside body', async () => {
  const f = fixture()
  vi.resetModules()
  const { mountDesktopUpdateUi } = await import('../src/preload/desktop-update-ui')
  mountDesktopUpdateUi(); await flush()
  const host = document.getElementById('dsh-desktop-about-root')
  expect(host.parentElement).toBe(document.documentElement)
  expect(host.shadowRoot).toBeNull()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
  ipc.handlers.get('desktop:show-about')({}, { desktopVersion: '1.0.0', harnessVersion: '2.0.0', locale: 'zh' })
  await flush()
  expect(host.style.display).toBe('flex')
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush()
  expect(host.style.display).toBe('none')
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})
it('yields to the actual preload update card outside body and restores Chat on idle', async () => {
  const f = fixture()
  vi.resetModules()
  const { mountDesktopUpdateUi } = await import('../src/preload/desktop-update-ui')
  mountDesktopUpdateUi(); await flush()
  const host = document.getElementById('dsh-desktop-update-root')
  expect(host.parentElement).toBe(document.documentElement)
  expect(host.shadowRoot).toBeNull()
  ipc.handlers.get('updates:status-changed')({}, { phase: 'checking', currentVersion: '1.0.0', manual: true, presentationId: 1 })
  await flush()
  expect(host.style.display).toBe('block')
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  ipc.handlers.get('updates:status-changed')({}, { phase: 'idle', currentVersion: '1.0.0', manual: false })
  await flush()
  expect(host.style.display).toBe('none')
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})
it('keeps Chat hidden when About closes while a workbench notice remains', async () => {
  const f = fixture()
  vi.resetModules()
  const { mountDesktopUpdateUi } = await import('../src/preload/desktop-update-ui')
  mountDesktopUpdateUi(); await flush()
  ipc.handlers.get('desktop:show-about')({}, { desktopVersion: '1.0.0', harnessVersion: '2.0.0', locale: 'zh' })
  const notice = document.createElement('aside')
  notice.setAttribute('data-dsh-workbench-notice', '')
  document.body.append(notice); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush()
  expect(document.getElementById('dsh-desktop-about-root').style.display).toBe('none')
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  notice.remove(); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})

it('yields to a host modal and restores Chat when it closes', async () => {
  const f = fixture()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
  document.body.append(modal)
  await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  modal.remove(); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})
it('yields to an overlapping workbench notice and restores the native view on dismissal', async () => {
  const f = fixture()
  const notice = document.createElement('aside')
  notice.setAttribute('data-dsh-workbench-notice', '')
  document.body.append(notice); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  notice.remove(); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})

it('yields to host settings and work pages', async () => {
  const f = fixture()
  await f.change({ settingsOpen: true })
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  await f.change({ settingsOpen: false, mode: 'work', panelOpen: true })
  expect(f.present.mock.lastCall[0].visible).toBe(false)
})
it('keeps a remote settings surface visible inside its own modal but yields to a nested confirmation', async () => {
  const f = fixture()
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
  modal.innerHTML = '<section data-dsh-native-surface="account"></section>'
  document.body.append(modal)
  await f.change({ settingsOpen: true, settingsSurface: { section: 'account', bounds: { x: 200, y: 48, width: 800, height: 600 } } })
  expect(f.present.mock.lastCall[0]).toMatchObject({ visible: true, settings: 'account' })
  const surface = modal.querySelector('section')
  surface.hidden = true; await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  surface.hidden = false; await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
  const confirmation = document.createElement('div')
  confirmation.setAttribute('role', 'dialog'); confirmation.setAttribute('aria-modal', 'true')
  document.body.append(confirmation); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  confirmation.remove(); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})
it('releases a menu even if its native screenshot never resolves, and ignores a late frame', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let resolveCapture
  const f = fixture({ capture: vi.fn(() => new Promise(resolve => { resolveCapture = resolve })) })
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu')
  document.body.append(menu); await flush()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(1501) })
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  menu.remove(); await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
  const count = f.present.mock.calls.length
  resolveCapture({ dataURL: 'data:image/png;base64,late', bounds: {} }); await flush()
  expect(f.present).toHaveBeenCalledTimes(count)
  expect(document.querySelector('[data-dsh-native-frame]')).toBeNull()
})
it('stabilizes square banner presentation without feeding back its own style mutations', async () => {
  document.documentElement.dataset.platform = 'darwin'
  const f = fixture({ palette: { squareBanner: [20, 30, 40] }, initialState: { path: '/square' } })
  await flush()
  expect(document.getElementById('dsh-panel-chat').style.getPropertyValue('--dsh-square-chrome-fill')).toBe('rgb(20 30 40)')
  const count = f.present.mock.calls.length
  await flush()
  expect(f.present).toHaveBeenCalledTimes(count)
})
it('does not reveal Chat when its host seat is hidden by another page', async () => {
  const f = fixture()
  document.querySelector('.dshModes').hidden = true
  await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(false)
  document.querySelector('.dshModes').hidden = false
  await flush()
  expect(f.present.mock.lastCall[0].visible).toBe(true)
})
