import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipc: new Map<string, (...args: unknown[]) => unknown>(),
  updater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.8.0',
    getPath: () => '/nonexistent-desktop-test',
    isReady: () => true
  },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipc.set(channel, handler)
    })
  }
}))
vi.mock('../src/main/update/update-policy', async (importOriginal) => ({
  ...await importOriginal<object>(),
  supportsAutoUpdates: () => true
}))

let manager: typeof import('../src/main/update/update-manager')

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.ipc.clear()
  manager = await import('../src/main/update/update-manager')
  manager.startUpdateManager({ prepareToInstall: async () => {} })
})

afterEach(() => manager.stopUpdateManager())

it('keeps online update checks disabled for manual and background requests', async () => {
  await manager.checkForUpdates(true)
  await manager.checkForUpdates()

  expect(manager.getUpdateStatus().phase).toBe('unsupported')
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  expect(mocks.updater.setFeedURL).not.toHaveBeenCalled()
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
})

it('does not expose the removed version-list and rollback handlers', () => {
  manager.registerUpdateHandlers()

  expect(mocks.ipc.has('updates:list-versions')).toBe(false)
  expect(mocks.ipc.has('updates:install-version')).toBe(false)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
})
