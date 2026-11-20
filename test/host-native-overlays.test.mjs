// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let observeHostOverlays, createNativeSurfacePresenter, observeNativeSurfaceIntent, observeCloudHostOcclusion, apply
const disposers = []
const bounds = { x: 280, y: 48, width: 720, height: 700 }
const value = { visible: true, theme: 'light', bounds }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  document.body.innerHTML = '<main id="root"><aside></aside><section data-dsh-native-surface></section></main>'
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { queueMicrotask(() => callback(0)); return 0 }))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const visibility = Element.prototype.checkVisibility, decode = HTMLImageElement.prototype.decode
  Element.prototype.checkVisibility = function () { return !this.closest('[hidden]') && this.style.visibility !== 'hidden' }
  HTMLImageElement.prototype.decode = vi.fn(async () => {})
  disposers.push(() => {
    if (visibility) Element.prototype.checkVisibility = visibility
    else delete Element.prototype.checkVisibility
    if (decode) HTMLImageElement.prototype.decode = decode
    else delete HTMLImageElement.prototype.decode
  })
  window.__ModuleLoader__ = { load({ factory }) {
    const loaded = factory(() => ({}))
    ;({ observeHostOverlays, createNativeSurfacePresenter, observeNativeSurfaceIntent, observeCloudHostOcclusion, apply } = loaded)
  } }
  const source = await readFile('packages/dsh-desktop-client-ui/client.js', 'utf8')
  new Function(source.replace('exports.apply = apply', 'exports.observeCloudHostOcclusion = observeCloudHostOcclusion; exports.observeHostOverlays = observeHostOverlays; exports.createNativeSurfacePresenter = createNativeSurfacePresenter; exports.observeNativeSurfaceIntent = observeNativeSurfaceIntent; exports.apply = apply'))()
})
afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  document.body.innerHTML = ''
  delete window.__ModuleLoader__
  delete window.dshDesktopEnterprise
  document.documentElement.removeAttribute('data-dsh-about-open')
  document.documentElement.removeAttribute('data-dsh-safe-mode-page')
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function overlay(role, rect, parent = document.body) {
  const node = document.createElement('div')
  node.setAttribute('role', role)
  node.getBoundingClientRect = () => rect
  parent.append(node)
  return node
}
function observe(report = vi.fn()) {
  const observer = observeHostOverlays(report)
  disposers.push(observer.dispose)
  return observer
}
function presenter(capture = vi.fn(async () => ({ dataURL: 'data:image/png;base64,fixture', bounds }))) {
  const bridge = { capture, present: vi.fn(async () => ({})) }
  const target = document.querySelector('section')
  target.getBoundingClientRect = () => ({ x: 280, y: 48 })
  const instance = createNativeSurfacePresenter(bridge, () => target)
  disposers.push(instance.dispose)
  return { instance, bridge, target }
}

function cloudObserver() {
  const setCloudHostOccluded = vi.fn(async () => {})
  window.dshDesktopEnterprise = { setCloudHostOccluded }
  const dispose = observeCloudHostOcclusion()
  disposers.push(dispose)
  return { setCloudHostOccluded, dispose }
}

function cloudBackingObserver(capture = vi.fn(async () => ({ dataURL: 'data:image/png;base64,cloud', bounds }))) {
  const seat = document.querySelector('section')
  seat.setAttribute('data-dsh-cloud-surface', 'app-a')
  seat.getBoundingClientRect = () => bounds
  const send = vi.fn(async () => {})
  window.dshDesktopEnterprise = { captureCloudWorkbench: capture, setCloudHostOccluded: send }
  const dispose = observeCloudHostOcclusion()
  disposers.push(dispose)
  return { seat, send, capture, dispose }
}

it('resynchronizes on cloud surface readiness and removes its dedicated listener on unload', async () => {
  const remove = vi.spyOn(window, 'removeEventListener')
  const { seat, send, capture, dispose } = cloudBackingObserver()
  await flush()
  overlay('menu', { x: 1100, y: 100, width: 100, height: 100 }); await flush()
  expect(capture).not.toHaveBeenCalled()
  seat.getBoundingClientRect = () => ({ x: 1000, y: 48, width: 300, height: 700 })
  window.dispatchEvent(new Event('dsh-cloud-surface-ready')); await flush()
  expect(capture).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenLastCalledWith(true)
  dispose()
  expect(remove).toHaveBeenCalledWith('dsh-cloud-surface-ready', expect.any(Function))
  const captures = capture.mock.calls.length, calls = send.mock.calls.length
  window.dispatchEvent(new Event('dsh-cloud-surface-ready')); await flush()
  expect(capture).toHaveBeenCalledTimes(captures)
  expect(send).toHaveBeenCalledTimes(calls)
})

it('keeps a cloud seat visible under a nonoverlapping sidebar menu', async () => {
  const { send, capture } = cloudBackingObserver()
  await flush()
  overlay('menu', { x: 20, y: 100, width: 100, height: 100 }); await flush()
  expect(send).toHaveBeenCalledExactlyOnceWith(false)
  expect(capture).not.toHaveBeenCalled()
})

it('keeps cloud and Chat menu gates independent across release and disposal', async () => {
  const menu = overlay('menu', bounds)
  const chat = observe()
  const cloud = observeHostOverlays(vi.fn(), { gateName: 'cloud', gateModals: true })
  disposers.push(cloud.dispose)
  const releaseChat = chat.defer(bounds)
  const releaseCloud = cloud.defer(bounds)
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  expect(menu.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(true)
  releaseCloud()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  expect(document.documentElement.hasAttribute('data-dsh-native-overlay-handoff')).toBe(true)
  expect(menu.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(false)
  cloud.defer(bounds)
  releaseChat()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(true)
  expect(document.documentElement.hasAttribute('data-dsh-native-overlay-handoff-cloud')).toBe(true)
  chat.dispose()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(true)
  cloud.dispose()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(false)
  expect(document.documentElement.hasAttribute('data-dsh-native-overlay-handoff-cloud')).toBe(false)
})

it('gates the Settings mask and dialog until capture, decode, two paints and native yield finish', async () => {
  const captured = deferred(), decoding = deferred(), hidden = deferred(), paints = []
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { paints.push(callback); return paints.length }))
  HTMLImageElement.prototype.decode.mockReturnValueOnce(decoding.promise)
  const { seat, send } = cloudBackingObserver(vi.fn(() => captured.promise))
  await flush()
  send.mockImplementationOnce(() => hidden.promise)
  const layer = document.createElement('div')
  layer.setAttribute('role', 'presentation')
  layer.innerHTML = '<div aria-hidden="true"></div><div role="dialog" aria-modal="true" data-shortcut-modal="settings"></div>'
  document.body.append(layer); await flush()
  const gated = () => layer.hasAttribute('data-dsh-native-overlay-pending-cloud')
  expect(gated()).toBe(true)
  expect(getComputedStyle(layer).opacity).toBe('0')
  expect(send).toHaveBeenCalledExactlyOnceWith(false)
  captured.resolve({ dataURL: 'data:image/png;base64,cloud', bounds }); await flush()
  expect(gated()).toBe(true)
  expect(seat.querySelector('img')).toBeNull()
  decoding.resolve(); await flush()
  expect(seat.querySelector('img')).not.toBeNull()
  expect(gated()).toBe(true)
  paints.shift()(0); await flush()
  expect(gated()).toBe(true)
  expect(send).toHaveBeenCalledExactlyOnceWith(false)
  paints.shift()(0); await flush()
  expect(send).toHaveBeenLastCalledWith(true)
  expect(gated()).toBe(true)
  hidden.resolve(); await flush()
  expect(gated()).toBe(false)
})

it('keeps an owning settings layer ungated and gates only a nested confirmation', async () => {
  const layer = document.createElement('div')
  layer.setAttribute('role', 'presentation')
  layer.innerHTML = '<div aria-hidden="true"></div><div role="dialog" aria-modal="true"><section></section></div>'
  document.body.append(layer)
  const surface = layer.querySelector('section')
  const nested = overlay('alertdialog', bounds, layer.querySelector('[role="dialog"]'))
  nested.setAttribute('aria-modal', 'true')
  const cloud = observeHostOverlays(vi.fn(), { gateName: 'cloud', gateModals: true })
  disposers.push(cloud.dispose)
  cloud.defer(bounds, surface)
  expect(layer.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(false)
  expect(layer.querySelector('[role="dialog"]').hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(false)
  expect(nested.hasAttribute('data-dsh-native-overlay-pending-cloud')).toBe(true)
})

it('paints a cloud backing before Settings yields and restores the native page before removing it', async () => {
  const decoding = deferred(), restored = deferred()
  HTMLImageElement.prototype.decode.mockReturnValueOnce(decoding.promise)
  const { seat, send, capture } = cloudBackingObserver()
  await flush()
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true'); await flush()
  expect(capture).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledExactlyOnceWith(false)
  expect(seat.querySelector('img')).toBeNull()
  decoding.resolve(); await flush()
  expect(seat.querySelector('[data-dsh-native-frame]')).not.toBeNull()
  expect(send).toHaveBeenLastCalledWith(true)
  send.mockImplementationOnce(() => restored.promise)
  settings.remove(); await flush()
  expect(send).toHaveBeenLastCalledWith(false)
  expect(seat.querySelector('img')).not.toBeNull()
  restored.resolve(); await flush()
  expect(seat.querySelector('img')).toBeNull()
})

it.each(['unmount', 'replace', 'identity'])('discards late cloud capture after seat %s', async change => {
  const captured = deferred()
  const { seat, capture } = cloudBackingObserver(vi.fn().mockReturnValueOnce(captured.promise).mockResolvedValue(undefined))
  await flush()
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true'); await flush()
  expect(capture).toHaveBeenCalledTimes(1)
  if (change === 'unmount') seat.remove()
  else if (change === 'replace') {
    const replacement = document.createElement('section')
    replacement.setAttribute('data-dsh-cloud-surface', 'app-b')
    replacement.getBoundingClientRect = () => bounds
    seat.replaceWith(replacement)
  } else seat.setAttribute('data-dsh-cloud-surface', 'app-b')
  await flush()
  captured.resolve({ dataURL: 'data:image/png;base64,stale', bounds }); await flush()
  expect(seat.querySelector('img')).toBeNull()
  expect(document.querySelector('img')).toBeNull()
})

it('discards a decoded cloud backing when the same DOM seat changes workbench identity', async () => {
  const decoding = deferred()
  HTMLImageElement.prototype.decode.mockReturnValueOnce(decoding.promise)
  const { seat } = cloudBackingObserver(vi.fn().mockResolvedValueOnce({ dataURL: 'data:image/png;base64,old', bounds }).mockResolvedValue(undefined))
  await flush()
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true'); await flush()
  seat.setAttribute('data-dsh-cloud-surface', 'app-b'); await flush()
  decoding.resolve(); await flush()
  expect(document.querySelector('img')).toBeNull()
})

it('updates held cloud backing geometry on seat resize and disconnects replaced seats', async () => {
  const observers = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); this.disconnect = vi.fn(() => this.nodes.clear()); observers.push(this) }
    observe(node) { this.nodes.add(node) }
    unobserve(node) { this.nodes.delete(node) }
  })
  const { seat, capture, dispose } = cloudBackingObserver()
  const resize = observers.find(observer => observer.nodes.has(seat))
  await flush()
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true'); await flush()
  expect(seat.querySelector('img')).not.toBeNull()
  const resized = { x: 320, y: 48, width: 680, height: 700 }
  seat.getBoundingClientRect = () => resized
  resize.callback(); await flush()
  expect(seat.querySelector('img').style.width).toBe('680px')
  expect(seat.querySelector('img').style.left).toBe('0px')
  expect(capture).toHaveBeenCalledTimes(1)
  const replacement = document.createElement('section')
  replacement.setAttribute('data-dsh-cloud-surface', 'app-b')
  replacement.getBoundingClientRect = () => bounds
  seat.replaceWith(replacement); await flush()
  expect(resize.nodes.has(seat)).toBe(false)
  expect(resize.nodes.has(replacement)).toBe(true)
  dispose()
  expect(resize.nodes.size).toBe(0)
  const captures = capture.mock.calls.length
  resize.callback(); await flush()
  expect(capture).toHaveBeenCalledTimes(captures)
})

it('releases a cloud backing after a failed restore succeeds on retry and captures anew next time', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { seat, send, capture } = cloudBackingObserver()
  await flush()
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true'); await flush()
  expect(seat.querySelector('img')).not.toBeNull()
  vi.useFakeTimers()
  disposers.push(() => vi.useRealTimers())
  send.mockRejectedValueOnce(new Error('temporary restore failure'))
  settings.remove(); await flush()
  expect(send).toHaveBeenLastCalledWith(false)
  expect(seat.querySelector('img')).not.toBeNull()
  await vi.advanceTimersByTimeAsync(100); await flush()
  expect(send).toHaveBeenLastCalledWith(false)
  expect(seat.querySelector('img')).toBeNull()
  document.body.append(settings); await flush()
  expect(capture).toHaveBeenCalledTimes(2)
  expect(seat.querySelector('img')).not.toBeNull()
})

it('registers cloud occlusion as a plugin effect without mounting DesktopContent', () => {
  const sentinel = new Error('stop after first effect')
  const effect = vi.fn(() => { throw sentinel })
  expect(() => apply({ effect })).toThrow(sentinel)
  expect(effect).toHaveBeenCalledWith(observeCloudHostOcclusion, 'desktop cloud host occlusion')
})

it.each(['inert', 'data-dsh-about-open', 'data-dsh-safe-mode-page'])('synchronizes initial and subsequent %s boundaries and fails closed on unload', async attribute => {
  const root = document.getElementById('root')
  Object.defineProperty(root, 'inert', { configurable: true, get() { return this.hasAttribute('inert') } })
  const target = attribute === 'inert' ? root : document.documentElement
  target.setAttribute(attribute, '')
  const { setCloudHostOccluded: send, dispose } = cloudObserver()
  expect(send).toHaveBeenLastCalledWith(true)
  target.removeAttribute(attribute); await flush()
  expect(send).toHaveBeenLastCalledWith(false)
  target.setAttribute(attribute, ''); await flush()
  expect(send).toHaveBeenLastCalledWith(true)
  dispose()
  expect(send).toHaveBeenLastCalledWith(true)
  const calls = send.mock.calls.length
  target.removeAttribute(attribute); await flush()
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenCalledTimes(calls)
})

it('tracks semantic modals and viewport overlays without taking ownership of pending paint gates', async () => {
  const menu = overlay('menu', { x: 20, y: 100, width: 160, height: 100 })
  const chat = observe()
  const release = chat.defer({ x: 0, y: 0, width: 1000, height: 800 })
  // Match Chromium: opacity from the Chat gate is ignored only when explicitly requested.
  Element.prototype.checkVisibility = function (options) {
    return !this.hidden && !(options?.opacityProperty && this.hasAttribute('data-dsh-native-overlay-pending'))
  }
  const style = document.querySelector('style[data-plugin-css="dsh-native-overlay-handoff"]')
  const { setCloudHostOccluded: send, dispose } = cloudObserver()
  expect(send).toHaveBeenLastCalledWith(true)
  expect(style.dataset.observers).toBe('1')
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenCalledTimes(1)
  dispose()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  expect(document.documentElement.hasAttribute('data-dsh-native-overlay-handoff')).toBe(true)
  expect(style.isConnected).toBe(true)
  release()
  menu.remove(); await flush()
  const next = cloudObserver()
  expect(next.setCloudHostOccluded).toHaveBeenLastCalledWith(false)
  const modal = overlay('dialog', { x: -500, y: -500, width: 0, height: 0 })
  modal.setAttribute('aria-modal', 'true'); await flush()
  expect(next.setCloudHostOccluded).toHaveBeenLastCalledWith(true)
  const nested = overlay('alertdialog', bounds, modal)
  nested.setAttribute('aria-modal', 'true'); await flush()
  modal.hidden = true; nested.hidden = true; await flush()
  expect(next.setCloudHostOccluded).toHaveBeenLastCalledWith(false)
})

it('uses the full viewport, ignores offscreen/inline content, and never adds handoff styles', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
  const { setCloudHostOccluded: send } = cloudObserver()
  expect(send).toHaveBeenCalledExactlyOnceWith(false)
  expect(document.querySelector('style[data-plugin-css="dsh-native-overlay-handoff"]')).toBeNull()
  overlay('dialog', bounds, document.getElementById('root'))
  const node = overlay('tooltip', { x: 1100, y: 100, width: 100, height: 100 })
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenLastCalledWith(true)
  expect(node.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  node.hidden = true; await flush()
  expect(send).toHaveBeenLastCalledWith(false)
})

it('waits for DOM ready, synchronizes once, and removes a pending ready listener on unload', async () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const { setCloudHostOccluded: send, dispose } = cloudObserver()
  expect(send).not.toHaveBeenCalled()
  document.documentElement.setAttribute('data-dsh-about-open', '')
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(send).toHaveBeenCalledExactlyOnceWith(true)
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(send).toHaveBeenCalledTimes(1)
  dispose()
  const pending = cloudObserver()
  pending.dispose()
  pending.setCloudHostOccluded.mockClear()
  document.dispatchEvent(new Event('DOMContentLoaded')); await flush()
  expect(pending.setCloudHostOccluded).not.toHaveBeenCalled()
})

it('fails closed after unloading a clear host and restores observation on reload', async () => {
  const { setCloudHostOccluded: send, dispose } = cloudObserver()
  expect(send).toHaveBeenLastCalledWith(false)
  dispose()
  expect(send).toHaveBeenLastCalledWith(true)
  const nextDispose = observeCloudHostOcclusion()
  disposers.push(nextDispose)
  expect(send).toHaveBeenLastCalledWith(false)
})

it.each(['resolve', 'reject'])('retries failed syncs without allowing stale %s to invalidate newer requests', async outcome => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const old = deferred()
  const send = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(undefined)
  window.dshDesktopEnterprise = { setCloudHostOccluded: send }
  disposers.push(observeCloudHostOcclusion())
  document.documentElement.setAttribute('data-dsh-about-open', ''); await flush()
  expect(send).toHaveBeenLastCalledWith(true)
  if (outcome === 'reject') old.reject(new Error('stale'))
  else old.resolve()
  await flush()
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenCalledTimes(2)
  send.mockRejectedValueOnce(new Error('retry'))
  document.documentElement.removeAttribute('data-dsh-about-open'); await flush()
  expect(send).toHaveBeenCalledTimes(3)
  await new Promise(resolve => setTimeout(resolve, 120)); await flush()
  expect(send).toHaveBeenCalledTimes(4)
  expect(send).toHaveBeenLastCalledWith(false)
  expect(warn).toHaveBeenCalledTimes(outcome === 'reject' ? 2 : 1)
})

it('retries a rejected true while the same overlay remains open and bounds repeated failure', async () => {
  vi.useFakeTimers()
  disposers.push(() => vi.useRealTimers())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  document.documentElement.setAttribute('data-dsh-about-open', '')
  const send = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined)
  window.dshDesktopEnterprise = { setCloudHostOccluded: send }
  const dispose = observeCloudHostOcclusion()
  disposers.push(dispose)
  await flush()
  await vi.advanceTimersByTimeAsync(100)
  expect(send.mock.calls).toEqual([[true], [true]])
  await vi.advanceTimersByTimeAsync(1000)
  expect(send).toHaveBeenCalledTimes(2)
  dispose()
  send.mockRejectedValue(new Error('unavailable'))
  const stop = observeCloudHostOcclusion()
  disposers.push(stop)
  await flush()
  await vi.advanceTimersByTimeAsync(5000)
  expect(send).toHaveBeenCalledTimes(5)
  stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(send.mock.calls.every(([occluded]) => occluded === true)).toBe(true)
})

it('keeps cloud workbench occluded until the last independent modal portal closes', async () => {
  const { setCloudHostOccluded: send } = cloudObserver()
  const first = overlay('dialog', bounds)
  first.setAttribute('aria-modal', 'true')
  const second = overlay('alertdialog', bounds)
  second.setAttribute('aria-modal', 'true'); await flush()
  expect(send).toHaveBeenLastCalledWith(true)
  const calls = send.mock.calls.length
  first.remove(); await flush()
  expect(send).toHaveBeenCalledTimes(calls)
  expect(send).toHaveBeenLastCalledWith(true)
  second.remove(); await flush()
  expect(send).toHaveBeenLastCalledWith(false)
})

it('supports older bridges without installing observers and logs async and sync failures', async () => {
  const observer = vi.spyOn(window, 'MutationObserver')
  expect(() => observeCloudHostOcclusion()()).not.toThrow()
  window.dshDesktopEnterprise = {}
  expect(() => observeCloudHostOcclusion()()).not.toThrow()
  expect(observer).not.toHaveBeenCalled()
  observer.mockRestore()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const failed = new Error('IPC unavailable')
  window.dshDesktopEnterprise = { setCloudHostOccluded: vi.fn().mockRejectedValueOnce(failed).mockImplementation(() => { throw failed }) }
  const dispose = observeCloudHostOcclusion()
  disposers.push(dispose)
  await flush()
  expect(warn).toHaveBeenCalledWith('[desktop] cloud host occlusion sync failed', { occluded: false, error: failed })
  document.documentElement.setAttribute('data-dsh-about-open', ''); await flush()
  expect(warn).toHaveBeenCalledWith('[desktop] cloud host occlusion sync failed', { occluded: true, error: failed })
})

it('detects inline sidebar menus, portal submenus and the last surviving overlay', async () => {
  const report = vi.fn(), observer = observe(report)
  const menu = overlay('menu', { x: 210, y: 120, width: 240, height: 300 }, document.querySelector('aside'))
  await flush()
  expect(observer.intersects(bounds)).toBe(true)
  expect(observer.isModal()).toBe(false)
  const sub = overlay('menu', { x: 450, y: 180, width: 200, height: 100 })
  await flush()
  menu.remove(); await flush()
  expect(observer.intersects(bounds)).toBe(true)
  sub.hidden = true; await flush()
  expect(observer.intersects(bounds)).toBe(false)
  sub.hidden = false; await flush()
  expect(observer.intersects(bounds)).toBe(true)
  sub.remove(); await flush()
  expect(observer.intersects(bounds)).toBe(false)
  expect(report).toHaveBeenCalled()
})

it.each(['tooltip', 'listbox', 'dialog'])('coordinates overlapping %s surfaces while preserving nonoverlapping ones', async role => {
  const node = overlay(role, { x: 20, y: 100, width: 160, height: 100 })
  const observer = observe()
  expect(observer.intersects(bounds)).toBe(false)
  node.getBoundingClientRect = () => ({ x: 240, y: 100, width: 160, height: 100 })
  window.dispatchEvent(new Event('resize'))
  expect(observer.intersects(bounds)).toBe(true)
  node.style.visibility = 'hidden'; await flush()
  expect(observer.intersects(bounds)).toBe(false)
})

it.each([false, true])('claims an entering Modal before its opacity animation paints (passive=%s)', async passive => {
  Element.prototype.checkVisibility = function (options) {
    return !this.closest('[hidden]') && this.style.visibility !== 'hidden' && !(options?.opacityProperty && this.style.opacity === '0')
  }
  const modal = overlay('dialog', bounds)
  modal.setAttribute('aria-modal', 'true')
  modal.style.opacity = '0'
  modal.getAnimations = () => [{ playState: 'running', effect: { getKeyframes: () => [{ opacity: '0' }, { opacity: '1' }] } }]
  const observer = observeHostOverlays(vi.fn(), { passive })
  disposers.push(observer.dispose)
  // No animation progress, animationend, resize or subsequent mutation is needed.
  expect(observer.isModal()).toBe(true)
  modal.hidden = true; await flush()
  expect(observer.isModal()).toBe(false)
  modal.hidden = false; modal.style.visibility = 'hidden'; await flush()
  expect(observer.isModal()).toBe(false)
  modal.style.visibility = ''; modal.getAnimations = () => []; await flush()
  expect(observer.isModal()).toBe(false)
  modal.getAnimations = () => [{ playState: 'running', effect: { getKeyframes: () => [{ opacity: '1' }, { opacity: '0' }] } }]
  window.dispatchEvent(new Event('resize'))
  expect(observer.isModal()).toBe(false)
})

it('tracks modal state changes and ignores persistent inline dialog content and streaming mutations', async () => {
  const inline = overlay('dialog', bounds, document.getElementById('root'))
  const report = vi.fn(), observer = observe(report)
  expect(observer.intersects(bounds)).toBe(false)
  for (let i = 0; i < 100; i++) document.querySelector('section').append(document.createTextNode('token'))
  await flush()
  expect(report).not.toHaveBeenCalled()
  inline.setAttribute('aria-modal', 'true'); await flush()
  expect(observer.isModal()).toBe(true)
  inline.remove(); await flush()
  expect(observer.isModal()).toBe(false)
  observer.dispose(); report.mockClear()
  overlay('menu', bounds); await flush()
  expect(report).not.toHaveBeenCalled()
})

it('recognizes the installed SettingsPanel portal while preserving its own embedded settings surface', async () => {
  // SettingsPanel owns a body portal; unlike primitives.Modal its panel has no entry animation.
  const portal = document.createElement('div')
  portal.setAttribute('role', 'presentation')
  portal.style.position = 'fixed'
  portal.innerHTML = '<div aria-hidden="true"></div><div role="dialog" aria-modal="true" data-shortcut-modal="settings" data-dsh-settings-section="general" style="position:relative;display:flex"><section data-dsh-native-surface="general"></section></div>'
  const observer = observe()
  const { setCloudHostOccluded: send } = cloudObserver()
  expect(send).toHaveBeenLastCalledWith(false)
  document.body.append(portal); await flush()
  const surface = portal.querySelector('section')
  expect(observer.isModal()).toBe(true)
  expect(observer.isModal(surface)).toBe(false)
  expect(send).toHaveBeenLastCalledWith(true)
  portal.remove(); await flush()
  expect(observer.isModal()).toBe(false)
  expect(send).toHaveBeenLastCalledWith(false)
})

it('keeps an embedded settings surface inside its owning modal and yields to a nested confirmation', async () => {
  const settings = overlay('dialog', bounds)
  settings.setAttribute('aria-modal', 'true')
  const surface = document.createElement('section')
  settings.append(surface)
  const observer = observe()
  expect(observer.isModal(surface)).toBe(false)
  expect(observer.isModal(document.querySelector('#root section'))).toBe(true)
  const confirm = overlay('alertdialog', bounds, settings)
  confirm.setAttribute('aria-modal', 'true'); await flush()
  expect(observer.isModal(surface)).toBe(true)
  confirm.remove(); await flush()
  expect(observer.isModal(surface)).toBe(false)
})

it('places a frame at current seat bounds when layout changes during decode', async () => {
  const decode = deferred()
  HTMLImageElement.prototype.decode.mockReturnValueOnce(decode.promise)
  const { instance, bridge, target } = presenter()
  instance.present(value, true); await flush()
  const resized = { ...bounds, width: 540, height: 600 }
  instance.present({ ...value, bounds: resized }, true)
  decode.resolve(); await flush()
  const backing = target.querySelector('img')
  expect(backing.style.width).toBe('540px')
  expect(backing.style.height).toBe('600px')
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, bounds: resized, visible: false })
})

it('decodes the backing before hiding the native surface and restores it after the final overlay', async () => {
  const decode = deferred()
  HTMLImageElement.prototype.decode.mockReturnValueOnce(decode.promise)
  const { instance, bridge, target } = presenter()
  instance.present(value, true); await flush()
  expect(bridge.present).not.toHaveBeenCalled()
  decode.resolve(); await flush()
  expect(target.querySelector('[data-dsh-native-frame]')).not.toBeNull()
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: false })
  instance.present({ ...value, bounds: { ...bounds, width: 600 } }, true); await flush()
  expect(target.querySelector('img').style.width).toBe('600px')
  expect(bridge.capture).toHaveBeenCalledTimes(1)
  instance.present(value, false); await flush()
  expect(bridge.present).toHaveBeenLastCalledWith(value)
  expect(target.querySelector('img')).toBeNull()
})

it.each(['closed', 'work', 'disposed'])('discards an in-flight frame when the surface becomes %s', async change => {
  const capture = deferred(), { instance, bridge, target } = presenter(() => capture.promise)
  instance.present(value, true)
  if (change === 'disposed') instance.dispose()
  else instance.present({ ...value, visible: change !== 'work' }, false)
  capture.resolve({ dataURL: 'data:image/png;base64,fixture', bounds }); await flush()
  expect(target.querySelector('img')).toBeNull()
  expect(bridge.present).toHaveBeenCalledTimes(change === 'disposed' ? 0 : 1)
  if (change !== 'disposed') expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: change !== 'work' })
})

it('yields input even if capture fails and releases pending frames on account teardown', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { instance, bridge, target } = presenter(async () => { throw new Error('capture failed') })
  instance.present(value, true); await flush()
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: false })
  expect(target.querySelector('img')).toBeNull()
  instance.dispose()
  instance.present(value, false); await flush()
  expect(bridge.present).toHaveBeenCalledTimes(1)
})

it('recaptures after a rapid close/reopen instead of installing the previous cycle\'s frame', async () => {
  const first = deferred(), next = deferred()
  const capture = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
  const { instance, bridge, target } = presenter(capture)
  instance.present(value, true)
  instance.present(value, false)
  instance.present(value, true)
  first.resolve({ dataURL: 'data:image/png;base64,old', bounds }); await flush()
  expect(target.querySelector('img')).toBeNull()
  expect(capture).toHaveBeenCalledTimes(2)
  next.resolve({ dataURL: 'data:image/png;base64,new', bounds }); await flush()
  expect(target.querySelector('img').src).toBe('data:image/png;base64,new')
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: false })
})

it('keeps a cold menu and its material out of paint until native visibility is acknowledged', async () => {
  const capture = deferred(), hidden = deferred()
  const { instance, bridge } = presenter(vi.fn(() => capture.promise))
  instance.present(value); await flush()
  bridge.present.mockImplementation(next => next.visible ? Promise.resolve({}) : hidden.promise)
  const menu = overlay('menu', { x: 210, y: 120, width: 240, height: 300 })
  const local = overlay('menu', { x: 20, y: 120, width: 100, height: 100 })
  const observer = observe()
  instance.present(value, true, () => observer.defer(bounds))
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  expect(getComputedStyle(menu).opacity).toBe('0')
  expect(getComputedStyle(menu).pointerEvents).toBe('none')
  expect(local.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  window.dispatchEvent(new Event('resize'))
  expect(observer.intersects(bounds)).toBe(true)
  capture.resolve({ dataURL: 'data:image/png;base64,fixture', bounds }); await flush()
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: false })
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  hidden.resolve({}); await flush()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  expect(document.documentElement.hasAttribute('data-dsh-native-overlay-handoff')).toBe(false)
  const submenu = overlay('menu', { x: 450, y: 150, width: 160, height: 100 })
  await flush()
  instance.present(value, true, () => observer.defer(bounds))
  expect(submenu.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  expect(bridge.capture).toHaveBeenCalledTimes(1)
})

it('reuses a prepainted interaction frame without capture, decoding or animation-frame waits on open', async () => {
  const { instance, bridge, target } = presenter()
  instance.present(value); await flush()
  await instance.warm()
  expect(bridge.capture).toHaveBeenCalledTimes(1)
  expect(bridge.present).toHaveBeenLastCalledWith(value)
  const backing = target.querySelector('img'), frames = requestAnimationFrame.mock.calls.length
  expect(backing).not.toBeNull()
  instance.present(value, true)
  expect(bridge.present).toHaveBeenLastCalledWith({ ...value, visible: false })
  expect(requestAnimationFrame).toHaveBeenCalledTimes(frames)
  expect(HTMLImageElement.prototype.decode).toHaveBeenCalledTimes(1)
  expect(bridge.capture).toHaveBeenCalledTimes(1)
  await flush()
  expect(target.querySelector('img')).toBe(backing)
})

it.each(['invalidate', 'resize', 'expired'])('rejects a warmed frame after %s', async change => {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const { instance, bridge, target } = presenter()
  instance.present(value); await flush()
  await instance.warm()
  if (change === 'invalidate') instance.invalidate()
  if (change === 'expired') now += 251
  const next = change === 'resize' ? { ...value, bounds: { ...bounds, width: 600 } } : value
  instance.present(next, true); await flush()
  expect(bridge.capture).toHaveBeenCalledTimes(2)
  expect(target.querySelectorAll('img')).toHaveLength(1)
})

it('discards speculative captures on account teardown without changing native visibility', async () => {
  const capture = deferred(), { instance, bridge, target } = presenter(() => capture.promise)
  instance.present(value); await flush()
  const warming = instance.warm()
  instance.dispose()
  capture.resolve({ dataURL: 'data:image/png;base64,stale', bounds })
  await warming
  expect(target.querySelector('img')).toBeNull()
  expect(bridge.present).toHaveBeenCalledTimes(1)
})

it('prepares pointer, focus and menu keyboard input before handlers, and releases the input observers', () => {
  const button = document.createElement('button'), embedded = document.createElement('button')
  document.querySelector('aside').append(button)
  document.querySelector('section').append(embedded)
  const warm = vi.fn(), dispose = observeNativeSurfaceIntent(warm)
  disposers.push(dispose)
  button.addEventListener('pointerdown', () => expect(warm).toHaveBeenCalledTimes(1))
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  button.dispatchEvent(new Event('focusin', { bubbles: true }))
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  embedded.dispatchEvent(new Event('pointerover', { bubbles: true }))
  expect(warm).toHaveBeenCalledTimes(3)
  dispose()
  button.dispatchEvent(new Event('pointerover', { bubbles: true }))
  expect(warm).toHaveBeenCalledTimes(3)
})

it('releases a paint-gated menu when capture is cancelled by a mode change', async () => {
  const capture = deferred(), { instance } = presenter(() => capture.promise)
  const menu = overlay('menu', bounds), observer = observe()
  instance.present(value, true, () => observer.defer(bounds))
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(true)
  instance.present({ ...value, visible: false })
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
  capture.resolve(undefined); await flush()
  expect(menu.hasAttribute('data-dsh-native-overlay-pending')).toBe(false)
})

it('warms once after pointer dwell and cancels toolbar flybys and unmounted timers', () => {
  vi.useFakeTimers()
  try {
    const button = document.createElement('button'), icon = document.createElement('span')
    button.append(icon); document.querySelector('aside').append(button)
    const warm = vi.fn(), dispose = observeNativeSurfaceIntent(warm)
    disposers.push(dispose)
    button.dispatchEvent(new Event('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(30)
    button.dispatchEvent(new Event('pointerout', { bubbles: true }))
    vi.advanceTimersByTime(100)
    expect(warm).not.toHaveBeenCalled()
    button.dispatchEvent(new Event('pointerover', { bubbles: true }))
    icon.dispatchEvent(new Event('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(60)
    expect(warm).toHaveBeenCalledTimes(1)
    button.dispatchEvent(new Event('pointerout', { bubbles: true }))
    button.dispatchEvent(new Event('pointerover', { bubbles: true }))
    dispose(); vi.advanceTimersByTime(100)
    expect(warm).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('shares handoff CSS across remounts and removes it after the last observer', () => {
  const first = observe(), second = observe()
  const selector = 'style[data-plugin-css="dsh-native-overlay-handoff"]'
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  first.dispose(); first.dispose()
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  second.dispose()
  expect(document.querySelectorAll(selector)).toHaveLength(0)
})
