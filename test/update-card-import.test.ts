import { afterEach, expect, it, vi } from 'vitest'

const observed = vi.hoisted(() => ({
  updaterReads: 0,
  versionReads: 0,
  updater: {
    autoDownload: true,
    allowDowngrade: true,
    allowPrerelease: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => {
      observed.versionReads += 1
      return '1.0.0'
    },
    getPath: () => '',
    isReady: () => true
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  session: { fromPartition: () => ({}) },
  shell: { openExternal: vi.fn() },
  WebContentsView: class {}
}))

vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      observed.updaterReads += 1
      return observed.updater
    }
  }
}))

vi.mock('../src/main/update/update-policy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/update/update-policy')>(),
  supportsAutoUpdates: () => true
}))

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  observed.updaterReads = 0
  observed.versionReads = 0
  observed.updater.on.mockClear()
})

it('imports enterprise Chat without constructing the updater', async () => {
  await import('../src/main/enterprise/chat-view')
  expect(observed.updaterReads).toBe(0)
  expect(observed.versionReads).toBe(0)
})

it('starts one updater and reuses it for later checks', async () => {
  vi.useFakeTimers()
  const manager = await import('../src/main/update/update-manager')
  expect(observed.updaterReads).toBe(0)
  manager.startUpdateManager({ prepareToInstall: async () => {} })
  expect(observed.updaterReads).toBe(1)
  await manager.checkForUpdates(true)
  expect(observed.updaterReads).toBe(1)
  expect(observed.updater.on).toHaveBeenCalled()
  expect(observed.updater.checkForUpdates).toHaveBeenCalledOnce()
  manager.stopUpdateManager()
})
