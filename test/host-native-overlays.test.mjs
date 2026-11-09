// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let observeHostOverlays, createNativeSurfacePresenter, observeNativeSurfaceIntent
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
    ;({ observeHostOverlays, createNativeSurfacePresenter, observeNativeSurfaceIntent } = loaded)
  } }
  const source = await readFile('packages/dsh-desktop-client-ui/client.js', 'utf8')
  new Function(source.replace('exports.apply = apply', 'exports.observeHostOverlays = observeHostOverlays; exports.createNativeSurfacePresenter = createNativeSurfacePresenter; exports.observeNativeSurfaceIntent = observeNativeSurfaceIntent; exports.apply = apply'))()
})
afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  document.body.innerHTML = ''
  delete window.__ModuleLoader__
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
