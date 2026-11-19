import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

function fixture() {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const launches: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = []
  const cloudWorkbenchView = { open: vi.fn(async (..._args: unknown[]) => {}), closeFor: vi.fn(), close: vi.fn(), setHostOccluded: vi.fn(), release: vi.fn() }
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, getURL: () => 'http://host.test' })
  const window = { webContents, isDestroyed: () => false }
  const enterpriseDesktop = { snapshot: () => ({ connectionKey: '1234567890abcdef', connected: true }),
    cloudRequest: vi.fn(() => new Promise((resolve, reject) => launches.push({ resolve, reject }))) }
  const context = vm.createContext({ cloudWorkbenchView, enterpriseDesktop, mainWindow: window,
    ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(name, handler) },
    clearProfileBootConfirmation: vi.fn(), runtime: { snapshot: () => ({ url: 'http://host.test' }) },
    sameHarnessOrigin: (a: string, b: string) => a === b,
  })
  const run = (code: string) => vm.runInContext(ts.transpile(code), context)
  run(source.slice(source.indexOf('let cloudOpenEpoch'), source.indexOf('let enterpriseDesktop:')))
  run(source.slice(source.indexOf('function assertTrustedMainWindowEvent('), source.indexOf('\n/**', source.indexOf('function assertTrustedMainWindowEvent('))))
  run(source.slice(source.indexOf('  const checkCloudHost ='), source.indexOf("  ipcMain.handle('enterprise-cloud:request'")))
  run(source.slice(source.indexOf("  ipcMain.handle('enterprise-cloud:open'"), source.indexOf('  // Fail closed until')))
  run(source.slice(source.indexOf("  ipcMain.handle('enterprise-cloud:close'"), source.indexOf("  ipcMain.removeAllListeners('dsh:storage-load-sync'")))
  const navigationStart = source.indexOf("  webContents.on('did-start-navigation'")
  run(source.slice(navigationStart, source.indexOf('\n}\n', navigationStart)).replaceAll('webContents.on', 'mainWindow.webContents.on'))
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get('enterprise-cloud:' + name)
    if (!handler) throw new Error('Missing handler: ' + name)
    return handler(event, ...args)
  }
  const open = (owner: string, appId = 'a'.repeat(32)) => Promise.resolve(invoke('open', appId, {}, '1234567890abcdef', owner))
  const finish = (index: number, appId = 'a'.repeat(32)) => launches[index]?.resolve({ appId, connectionKey: '1234567890abcdef' })
  return { open, invoke, finish, launches, cloudWorkbenchView, webContents }
}

it('cancels an owner before launch authorization completes', async () => {
  const f = fixture()
  const opening = f.open('first')
  f.invoke('close', 'first')
  f.finish(0)
  await expect(opening).rejects.toThrow('cancelled')
  expect(f.cloudWorkbenchView.open).not.toHaveBeenCalled()
})

it('keeps only the newest selection even when launch responses arrive out of order', async () => {
  const f = fixture()
  const first = f.open('first')
  const second = f.open('second')
  f.finish(1)
  await second
  f.finish(0)
  await expect(first).rejects.toThrow('cancelled')
  expect(f.cloudWorkbenchView.open).toHaveBeenCalledOnce()
  expect(f.cloudWorkbenchView.open.mock.calls[0]?.[3]).toBe('second')
})

it('stale completion cannot clear the newer pending owner', async () => {
  const f = fixture()
  const first = f.open('first')
  const second = f.open('second')
  f.finish(0)
  await expect(first).rejects.toThrow('cancelled')
  f.invoke('close', 'first')
  f.invoke('close', 'second')
  f.finish(1)
  await expect(second).rejects.toThrow('cancelled')
  expect(f.cloudWorkbenchView.open).not.toHaveBeenCalled()
})

it.each([true, false])('cancels pending authorization for main-frame navigation (in-place=%s)', async inPlace => {
  const f = fixture()
  const opening = f.open('first')
  f.webContents.emit('did-start-navigation', {}, 'http://host.test/next', inPlace, true)
  f.finish(0)
  await expect(opening).rejects.toThrow('cancelled')
  expect(f.cloudWorkbenchView.open).not.toHaveBeenCalled()
  expect(f.cloudWorkbenchView.close).toHaveBeenCalledTimes(inPlace ? 0 : 1)
})

it('does not cancel the selected owner for an unrelated close or subframe navigation', async () => {
  const f = fixture()
  const opening = f.open('second')
  f.invoke('close', 'first')
  f.webContents.emit('did-start-navigation', {}, 'http://host.test/frame', false, false)
  f.finish(0)
  await opening
  expect(f.cloudWorkbenchView.open).toHaveBeenCalledOnce()
})

it('rejects authorization completed for a replaced main frame', async () => {
  const f = fixture()
  const opening = f.open('first')
  f.webContents.mainFrame = {}
  f.finish(0)
  await expect(opening).rejects.toThrow('main BISHENG window')
  expect(f.cloudWorkbenchView.open).not.toHaveBeenCalled()
})

it('a failed authorization does not prevent a fresh owner from opening', async () => {
  const f = fixture()
  const first = f.open('first')
  f.launches[0]?.reject(new Error('launch failed'))
  await expect(first).rejects.toThrow('launch failed')
  const second = f.open('second')
  f.finish(1)
  await second
  expect(f.cloudWorkbenchView.open).toHaveBeenCalledOnce()
})

it('cancels a release that races launch authorization', async () => {
  const f = fixture()
  const opening = f.open('first')
  await f.invoke('release', 'a'.repeat(32), '1234567890abcdef')
  f.finish(0)
  await expect(opening).rejects.toThrow('cancelled')
  expect(f.cloudWorkbenchView.open).not.toHaveBeenCalled()
})
