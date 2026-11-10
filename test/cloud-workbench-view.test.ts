import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
function mockContents() { return Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async () => { if (loadFailure) throw new Error('Load failed') }),
  isDestroyed: vi.fn(() => false), close: vi.fn() }) }
function mockPartition() { return { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), clearStorageData: vi.fn(async () => {}),
  fetch: vi.fn(async () => new Response(null, { status: 204 })) } }
const views: Array<{ webContents: ReturnType<typeof mockContents>; setBounds: ReturnType<typeof vi.fn> }> = []
const partitions: Array<ReturnType<typeof mockPartition>> = []
let loadFailure = false
function view(index: number) { const value = views[index]; if (!value) throw new Error('Missing view'); return value }
function partition(index: number) { const value = partitions[index]; if (!value) throw new Error('Missing partition'); return value }
vi.mock('electron', () => ({
  WebContentsView: class {
    webContents = mockContents()
    setBounds = vi.fn()
    constructor() { views.push(this) }
  },
  session: { fromPartition: vi.fn(() => {
    const item = mockPartition()
    partitions.push(item); return item
  }) }, shell: { openExternal: vi.fn() }
}))
import { CloudWorkbenchView, cloudBounds } from '../src/main/enterprise/cloud-workbench-view'
import type { CloudLaunch } from '../src/main/enterprise/cloud-workbench'
let controller: CloudWorkbenchView
beforeEach(() => { views.length = 0; partitions.length = 0; loadFailure = false; controller = new CloudWorkbenchView() })
afterEach(() => { controller.close(); vi.useRealTimers() })
function parent() {
  // The Electron adapter boundary is represented by the exact methods exercised here.
  return Object.assign(new EventEmitter(), { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  isDestroyed: () => false, getContentSize: () => [1200, 800], webContents: { send: vi.fn() } }) as unknown as BrowserWindow }
const bounds = { x: 300, y: 20, width: 900, height: 780 }
function launch(appId: string, connectionKey = 'one'): CloudLaunch {
  return { appId, connectionKey, slug: appId, ticket: 't'.repeat(43), entryUrl: `https://enterprise.test/apps/${appId}/`, launchUrl: `https://enterprise.test/apps/${appId}/_desktop` }
}

it('retains the same page across workbench switching and renews only its scoped cookie', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  controller.closeFor('first')
  expect(view(0).webContents.close).not.toHaveBeenCalled()
  await controller.open(host, launch('b'), bounds, 'second', () => 'one')
  await controller.open(host, launch('a'), bounds, 'third', () => 'one')
  expect(views).toHaveLength(2)
  expect(view(0).webContents.loadURL).toHaveBeenCalledTimes(1)
  expect(partition(0).fetch).toHaveBeenCalledWith('https://enterprise.test/apps/a/_desktop', expect.objectContaining({ method: 'POST', redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } }))
  controller.closeFor('second')
  expect(host.contentView.removeChildView).not.toHaveBeenLastCalledWith(view(0))
  expect(view(0).webContents.close).not.toHaveBeenCalled()
})

it('clears all remote sessions when enterprise identity changes', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  await controller.open(host, launch('b', 'two'), bounds, 'second', () => 'two')
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(partition(0).clearStorageData).toHaveBeenCalledOnce()
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
})

it('stale page callbacks cannot resize or hide a different active workbench', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  await controller.open(host, launch('b'), bounds, 'second', () => 'one')
  view(1).setBounds.mockClear()
  controller.resizeFor('first', { ...bounds, width: 1 })
  controller.closeFor('first')
  expect(view(1).setBounds).not.toHaveBeenCalled()
  controller.resizeFor('second', bounds)
  expect(view(1).setBounds).toHaveBeenCalledOnce()
})

it('clamps native view bounds to the trusted parent content area', () => {
  expect(cloudBounds({ x: -10, y: 760, width: 5000, height: 5000 }, 1200, 800)).toEqual({ x: 0, y: 760, width: 1200, height: 40 })
  expect(() => cloudBounds({ ...bounds, x: Infinity }, 1200, 800)).toThrow()
})


it('discards a failed initial load so the next open can load a fresh page', async () => {
  const host = parent()
  loadFailure = true
  await expect(controller.open(host, launch('a'), bounds, 'first', () => 'one')).rejects.toThrow('Load failed')
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  loadFailure = false
  await controller.open(host, launch('a'), bounds, 'retry', () => 'one')
  expect(views).toHaveLength(2)
  expect(view(1).webContents.loadURL).toHaveBeenCalledOnce()
})

it('blocks malformed navigation and sends expired access back to the host', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  const event = { preventDefault: vi.fn() }
  expect(() => view(0).webContents.emit('will-navigate', event, 'invalid')).not.toThrow()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  view(0).webContents.emit('will-navigate', event, 'https://enterprise.test/login')
  expect(host.webContents.send).toHaveBeenCalledWith('enterprise-cloud:access-required', { owner: 'first', appId: 'a' })
})


it('renews app-scoped credentials during a long session without reloading the business page', async () => {
  vi.useFakeTimers()
  const host = parent()
  const renew = vi.fn(async () => launch('a'))
  await controller.open(host, launch('a'), bounds, 'first', () => 'one', renew)
  vi.setSystemTime(Date.now() + 20 * 60 * 1000)
  await vi.advanceTimersByTimeAsync(500)
  expect(renew).toHaveBeenCalledExactlyOnceWith('a')
  expect(partition(0).fetch).toHaveBeenCalledTimes(2)
  expect(view(0).webContents.loadURL).toHaveBeenCalledOnce()
})


it('exchanges a ticket without redirect before navigating to the business entry', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  expect(partition(0).fetch).toHaveBeenCalledWith(launch('a').launchUrl, expect.objectContaining({ redirect: 'error', credentials: 'include' }))
  expect(view(0).webContents.loadURL).toHaveBeenCalledExactlyOnceWith(launch('a').entryUrl)
  expect(partition(0).fetch.mock.invocationCallOrder[0]).toBeLessThan(view(0).webContents.loadURL.mock.invocationCallOrder[0] ?? 0)
  partition(0).fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
  await expect(controller.open(host, launch('a'), bounds, 'retry', () => 'one')).rejects.toThrow('access expired (HTTP 401)')
  expect(host.contentView.addChildView).toHaveBeenCalledOnce()
  expect(view(0).webContents.loadURL).toHaveBeenCalledOnce()
})


it('rejects an opening superseded by another workbench without hiding the newer view', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  let finishExchange: ((response: Response) => void) | undefined
  partition(0).fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishExchange = resolve }))
  const pending = controller.open(host, launch('a'), bounds, 'stale', () => 'one')
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await controller.open(host, launch('b'), bounds, 'current', () => 'one')
  if (!finishExchange) throw new Error('Missing pending exchange')
  finishExchange(new Response(null, { status: 204 }))
  await rejected
  expect(host.contentView.addChildView).toHaveBeenLastCalledWith(view(1))
  expect(host.contentView.removeChildView).not.toHaveBeenCalledWith(view(1))
  expect(view(1).webContents.close).not.toHaveBeenCalled()
})

it('rejects opening when the enterprise account changes during the exchange and clears scoped storage', async () => {
  const host = parent()
  let account = 'one'
  const pending = controller.open(host, launch('a'), bounds, 'first', () => account)
  account = 'two'
  await expect(pending).rejects.toThrow('Enterprise account changed')
  expect(host.contentView.addChildView).not.toHaveBeenCalled()
  expect(view(0).webContents.close).toHaveBeenCalledOnce()
  expect(partition(0).clearStorageData).toHaveBeenCalledOnce()
})

it('rejects opening cancelled by a closed controller', async () => {
  const host = parent()
  await controller.open(host, launch('a'), bounds, 'first', () => 'one')
  let finishExchange: ((response: Response) => void) | undefined
  partition(0).fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishExchange = resolve }))
  const pending = controller.open(host, launch('a'), bounds, 'stale', () => 'one')
  const rejected = expect(pending).rejects.toThrow('cancelled')
  controller.close()
  finishExchange?.(new Response(null, { status: 204 }))
  await rejected
  expect(host.contentView.addChildView).toHaveBeenCalledOnce()
})


it('keeps a shared initial page when a newer opening supersedes its creator', async () => {
  const host = parent()
  const first = controller.open(host, launch('a'), bounds, 'first', () => 'one')
  const rejected = expect(first).rejects.toThrow('cancelled')
  await controller.open(host, launch('a'), bounds, 'second', () => 'one')
  await rejected
  expect(views).toHaveLength(1)
  expect(host.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view(0))
  expect(view(0).webContents.close).not.toHaveBeenCalled()
  expect(partition(0).clearStorageData).not.toHaveBeenCalled()
})
