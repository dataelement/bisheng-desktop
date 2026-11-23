import type { BrowserWindow, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
// Loads start synchronously inside open(); holdLoads() holds the next load before it begins.
const gates: Promise<void>[] = []
function mockContents() { return Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async () => { const gate = gates.shift(); if (gate) await gate; if (loadFailure) throw new Error('Load failed') }),
  isDestroyed: vi.fn(() => false), close: vi.fn(), getURL: vi.fn(() => 'https://enterprise.test/apps/a/'),
  capturePage: vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,fixture' })) }) }
const views: Array<{ webContents: ReturnType<typeof mockContents>; setBounds: ReturnType<typeof vi.fn>; getBounds: ReturnType<typeof vi.fn>; options: { webPreferences?: { session?: unknown } } }> = []
let loadFailure = false
function view(index: number) { const value = views[index]; if (!value) throw new Error('Missing view'); return value }
vi.mock('electron', () => ({
  WebContentsView: class {
    webContents = mockContents()
    getBounds = vi.fn(() => ({ ...bounds }))
    setBounds = vi.fn()
    options: unknown
    constructor(options: unknown) { this.options = options; views.push(this as never) }
  },
  shell: { openExternal: vi.fn() }
}))
import { CloudWorkbenchView, cloudBounds } from '../src/main/enterprise/cloud-workbench-view'
import type { CloudEntry } from '../src/main/enterprise/cloud-workbench'
let controller: CloudWorkbenchView
beforeEach(() => { views.length = 0; loadFailure = false; gates.length = 0; controller = new CloudWorkbenchView() })
afterEach(() => { controller.close(); vi.useRealTimers() })
function parent() {
  // The Electron adapter boundary is represented by the exact methods exercised here.
  return Object.assign(new EventEmitter(), { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  isDestroyed: () => false, getContentSize: () => [1200, 800], webContents: { send: vi.fn(), focus: vi.fn() } }) as unknown as BrowserWindow }
const bounds = { x: 300, y: 20, width: 900, height: 780 }
// The account's hosted-app session (hosted-app-session.ts). The view must never clear it.
function hostedSession() { return { clearStorageData: vi.fn(async () => {}) } }
let pageSession = hostedSession()
beforeEach(() => { pageSession = hostedSession() })
const shared = () => pageSession as unknown as Session
function entry(appId: string, connectionKey = 'one'): CloudEntry {
  return { appId, connectionKey, slug: appId, entryUrl: `https://enterprise.test/apps/${appId}/` }
}
function holdLoads() {
  let finish: (() => void) | undefined
  gates.push(new Promise<void>(resolve => { finish = resolve }))
  return () => finish?.()
}

it('retains the same page across workbench switching', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.closeFor('first')
  expect(view(0).webContents.close).not.toHaveBeenCalled()
  await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  await controller.open(host, entry('a'), bounds, 'third', () => 'one', shared())
  expect(views).toHaveLength(2)
  expect(view(0).webContents.loadURL).toHaveBeenCalledTimes(1)
  controller.closeFor('second')
  expect(host.contentView.removeChildView).not.toHaveBeenLastCalledWith(view(0))
  expect(view(0).webContents.close).not.toHaveBeenCalled()
})

it('closes the previous account\'s pages when enterprise identity changes', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  await controller.open(host, entry('b', 'two'), bounds, 'second', () => 'two', shared())
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
  expect(pageSession.clearStorageData).not.toHaveBeenCalled()
})

it('stale page callbacks cannot resize or hide a different active workbench', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  view(1).setBounds.mockClear()
  controller.resizeFor('first', { ...bounds, width: 1 })
  controller.closeFor('first')
  expect(view(1).setBounds).not.toHaveBeenCalled()
  controller.resizeFor('second', bounds)
  expect(view(1).setBounds).toHaveBeenCalledOnce()
})

it('detaches for host overlays without reloading or losing bounds and returns input to the host', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.setHostOccluded(true)
  controller.setHostOccluded(true)
  expect(host.contentView.removeChildView).toHaveBeenCalledExactlyOnceWith(view(0))
  expect(host.webContents.focus).toHaveBeenCalledOnce()
  expect(view(0).setBounds).toHaveBeenCalledExactlyOnceWith(bounds)
  const resized = { ...bounds, width: 600 }
  controller.resizeFor('first', resized)
  controller.setHostOccluded(false)
  controller.setHostOccluded(false)
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(2)
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(0))
  expect(view(0).setBounds).toHaveBeenCalledTimes(2)
  expect(view(0).setBounds).toHaveBeenLastCalledWith(resized)
  expect(view(0).webContents.loadURL).toHaveBeenCalledOnce()
  expect(view(0).webContents.close).not.toHaveBeenCalled()
})

it('respects host occlusion when an initial page finishes loading', async () => {
  const host = parent()
  const finish = holdLoads()
  const opening = controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  await vi.waitFor(() => expect(view(0).webContents.loadURL).toHaveBeenCalledOnce())
  controller.setHostOccluded(true)
  finish()
  await opening
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
  expect(view(0).setBounds).toHaveBeenCalledExactlyOnceWith(bounds)
  controller.setHostOccluded(false)
  expect(host.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view(0))
})

it('restores only the selected workbench after switching behind an overlay', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.setHostOccluded(true)
  await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  controller.closeFor('first')
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(1)
  controller.setHostOccluded(false)
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(2)
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
  expect(view(0).webContents.close).not.toHaveBeenCalled()
})

it.each(['owner', 'release', 'controller', 'access'] as const)('does not revive an occluded page after %s closes it', async reason => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.setHostOccluded(true)
  if (reason === 'owner') controller.closeFor('first')
  if (reason === 'release') await controller.release('a', 'one')
  if (reason === 'controller') controller.close()
  if (reason === 'access') view(0).webContents.emit('will-navigate', { preventDefault: vi.fn() }, 'https://enterprise.test/login')
  controller.setHostOccluded(false)
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(1)
  expect(host.contentView.removeChildView).toHaveBeenCalledTimes(1)
})

it('preserves host occlusion across controller cleanup and account changes', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.setHostOccluded(true)
  controller.close()
  await controller.open(host, entry('b', 'two'), bounds, 'second', () => 'two', shared())
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(1)
  controller.setHostOccluded(false)
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
  expect(host.contentView.addChildView).toHaveBeenCalledTimes(2)
})

it('does not restore a stale opening when the selected workbench changes while occluded', async () => {
  const host = parent()
  controller.setHostOccluded(true)
  const finish = holdLoads()
  const opening = controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  const rejected = expect(opening).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(view(0).webContents.loadURL).toHaveBeenCalledOnce())
  await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  controller.setHostOccluded(false)
  finish()
  await rejected
  expect(host.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view(1))
  expect(host.contentView.removeChildView).not.toHaveBeenCalled()
})

it('does not revive a pending page closed by its owner while occluded', async () => {
  const host = parent()
  controller.setHostOccluded(true)
  const opening = controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  const rejected = expect(opening).rejects.toThrow('cancelled')
  controller.closeFor('first')
  controller.setHostOccluded(false)
  await rejected
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
})

it('clamps native view bounds to the trusted parent content area', () => {
  expect(cloudBounds({ x: -10, y: 760, width: 5000, height: 5000 }, 1200, 800)).toEqual({ x: 0, y: 760, width: 1200, height: 40 })
  expect(() => cloudBounds({ ...bounds, x: Infinity }, 1200, 800)).toThrow()
})


it('discards a failed initial load so the next open can load a fresh page', async () => {
  const host = parent()
  loadFailure = true
  await expect(controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())).rejects.toThrow('Load failed')
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  loadFailure = false
  await controller.open(host, entry('a'), bounds, 'retry', () => 'one', shared())
  expect(views).toHaveLength(2)
  expect(view(1).webContents.loadURL).toHaveBeenCalledOnce()
})

it('blocks malformed navigation and sends expired access back to the host', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  const event = { preventDefault: vi.fn() }
  expect(() => view(0).webContents.emit('will-navigate', event, 'invalid')).not.toThrow()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  view(0).webContents.emit('will-navigate', event, 'https://enterprise.test/login')
  expect(host.webContents.send).toHaveBeenCalledWith('enterprise-cloud:access-required', { owner: 'first', appId: 'a' })
})


it('opens the business entry directly in the account\'s hosted-app session', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  // No launch ticket: the platform admits the page with the session's web login.
  expect(view(0).options.webPreferences?.session).toBe(pageSession)
  expect(view(0).webContents.loadURL).toHaveBeenCalledExactlyOnceWith(entry('a').entryUrl)
  expect(host.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view(0))
})

it('does not reuse a retained page from an identity that has since been replaced', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.closeFor('first')
  const previous = pageSession
  pageSession = hostedSession()
  await controller.open(host, entry('a'), bounds, 'second', () => 'one', shared())
  expect(views).toHaveLength(2)
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(view(1).options.webPreferences?.session).toBe(pageSession)
  expect(previous.clearStorageData).not.toHaveBeenCalled()
})

it('rejects an opening superseded by another workbench without hiding the newer view', async () => {
  const host = parent()
  const finish = holdLoads()
  const pending = controller.open(host, entry('a'), bounds, 'stale', () => 'one', shared())
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await controller.open(host, entry('b'), bounds, 'current', () => 'one', shared())
  finish()
  await rejected
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
  expect(host.contentView.removeChildView).not.toHaveBeenCalledWith(view(1))
  expect(view(1).webContents.close).not.toHaveBeenCalled()
})

it('rejects opening when the enterprise account changes during the initial load', async () => {
  const host = parent()
  let account = 'one'
  const pending = controller.open(host, entry('a'), bounds, 'first', () => account, shared())
  account = 'two'
  await expect(pending).rejects.toThrow('Enterprise account changed')
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(pageSession.clearStorageData).not.toHaveBeenCalled()
})

it('rejects opening cancelled by a closed controller', async () => {
  const host = parent()
  const finish = holdLoads()
  const pending = controller.open(host, entry('a'), bounds, 'stale', () => 'one', shared())
  const rejected = expect(pending).rejects.toThrow('cancelled')
  controller.close()
  finish()
  await rejected
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
})

it('keeps a shared initial page when a newer opening supersedes its creator', async () => {
  const host = parent()
  const first = controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  const rejected = expect(first).rejects.toThrow('cancelled')
  await controller.open(host, entry('a'), bounds, 'second', () => 'one', shared())
  await rejected
  expect(views).toHaveLength(1)
  expect(host.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view(0))
  expect(view(0).webContents.close).not.toHaveBeenCalled()
})


it('explicit uninstall releases only that app and reinstall navigates a fresh page', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  controller.closeFor('first')
  await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  await controller.release('a', 'other-account')
  expect(view(0).webContents.close).not.toHaveBeenCalled()
  await controller.release('a', 'one')
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(view(1).webContents.close).not.toHaveBeenCalled()
  // The session is shared with the account's other pages and stays signed in.
  expect(pageSession.clearStorageData).not.toHaveBeenCalled()
  await controller.release('a', 'one')
  await controller.open(host, entry('a'), bounds, 'reinstalled', () => 'one', shared())
  expect(views).toHaveLength(3)
  expect(view(2).webContents.loadURL).toHaveBeenCalledOnce()
})

it('uninstall during the initial load cannot reattach the released page', async () => {
  const host = parent()
  const finish = holdLoads()
  const pending = controller.open(host, entry('a'), bounds, 'pending', () => 'one', shared())
  await controller.release('a', 'one')
  finish()
  await expect(pending).rejects.toThrow('cancelled')
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
})

it('asks the host to reopen when the proxy redirects a lapsed login to the platform', async () => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  const event = { preventDefault: vi.fn() }
  view(0).webContents.emit('will-redirect', event, 'https://enterprise.test/apps/a/data')
  expect(event.preventDefault).not.toHaveBeenCalled()
  view(0).webContents.emit('will-redirect', event, 'https://enterprise.test/workspace/login?redirect=%2Fapps%2Fa%2F')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(host.webContents.send).toHaveBeenCalledWith('enterprise-cloud:access-required', { owner: 'first', appId: 'a' })
  expect(host.contentView.removeChildView).toHaveBeenCalledWith(view(0))
})

it('captures only the attached active page for its owning host', async () => {
  const host = parent()
  expect(await controller.capture(host)).toBeUndefined()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  expect(await controller.capture(parent())).toBeUndefined()
  expect(await controller.capture(host)).toEqual({ dataURL: 'data:image/png;base64,fixture', bounds })
  controller.setHostOccluded(true)
  expect(await controller.capture(host)).toBeUndefined()
  expect(view(0).webContents.capturePage).toHaveBeenCalledOnce()
})

it.each(['close', 'switch', 'resize', 'navigation'])('discards a capture after %s', async change => {
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  let finish: (() => void) | undefined
  view(0).webContents.capturePage.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,fixture' }) }))
  const capture = controller.capture(host)
  if (change === 'close') controller.closeFor('first')
  if (change === 'switch') await controller.open(host, entry('b'), bounds, 'second', () => 'one', shared())
  if (change === 'resize') view(0).getBounds.mockReturnValue({ ...bounds, width: 600 })
  if (change === 'navigation') view(0).webContents.getURL.mockReturnValue('https://enterprise.test/apps/a/next')
  if (!finish) throw new Error('Missing capture completion')
  finish()
  expect(await capture).toBeUndefined()
})

it('bounds capture failure so host overlays remain usable', async () => {
  vi.useFakeTimers()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const host = parent()
  await controller.open(host, entry('a'), bounds, 'first', () => 'one', shared())
  view(0).webContents.capturePage.mockImplementationOnce(() => new Promise(() => {}))
  const capture = controller.capture(host)
  await vi.advanceTimersByTimeAsync(1500)
  expect(await capture).toBeUndefined()
  expect(warn).toHaveBeenCalledOnce()
  warn.mockRestore()
})
