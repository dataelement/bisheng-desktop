import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipc: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  userData: '',
  supported: true,
  prepareToInstall: vi.fn(async () => {}),
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

vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.1',
    getPath: () => mocks.userData,
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
  supportsAutoUpdates: () => mocks.supported
}))

let manager: typeof import('../src/main/update/update-manager')

function start() {
  manager.startUpdateManager({ prepareToInstall: mocks.prepareToInstall })
}
function emit(event: string, value?: unknown) {
  mocks.listeners.get(event)?.(value)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.resetAllMocks()
  mocks.ipc.clear()
  mocks.listeners.clear()
  mocks.supported = true
  mocks.userData = await mkdtemp(join(tmpdir(), 'bisheng-update-'))
  mocks.updater.on.mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
    mocks.listeners.set(event, listener)
  })
  mocks.updater.checkForUpdates.mockImplementation(async () => {
    emit('checking-for-update')
    emit('update-not-available')
  })
  manager = await import('../src/main/update/update-manager')
})

afterEach(async () => {
  manager.stopUpdateManager()
  vi.useRealTimers()
  await rm(mocks.userData, { recursive: true, force: true })
})

it('checks the stable feed on manual request and reports the current version', async () => {
  start()
  manager.registerUpdateHandlers()
  await mocks.ipc.get('updates:check')?.()
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'up-to-date', manual: true })
  expect(mocks.updater).toMatchObject({
    autoDownload: false, allowDowngrade: false, allowPrerelease: false, autoInstallOnAppQuit: false
  })
})

it('checks automatically on startup and at the periodic interval', async () => {
  start()
  start()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
  expect(manager.getUpdateStatus().manual).toBe(false)
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it('does not check or configure the updater when a Dev build has not started the manager', async () => {
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus().phase).toBe('unsupported')
  expect(mocks.updater.on).not.toHaveBeenCalled()
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
})

it('keeps unsupported platforms and unpackaged builds disabled', async () => {
  mocks.supported = false
  start()
  await manager.checkForUpdates(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(manager.getUpdateStatus().phase).not.toBe('checking')
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
})

it('offers an update without downloading, then prepares shutdown only after download and install consent', async () => {
  start()
  mocks.updater.checkForUpdates.mockImplementation(async () => emit('update-available', { version: '1.0.2' }))
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'available', availableVersion: '1.0.2' })
  await manager.installDownloadedUpdate()
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(mocks.prepareToInstall).not.toHaveBeenCalled()
  mocks.updater.downloadUpdate.mockImplementation(async () => {
    emit('download-progress', { percent: 50 })
    expect(manager.getUpdateStatus()).toMatchObject({ phase: 'downloading', percent: 50 })
    emit('update-downloaded', { version: '1.0.2' })
  })
  await manager.downloadAvailableUpdate()
  expect(manager.getUpdateStatus().phase).toBe('downloaded')
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  await manager.installDownloadedUpdate()
  expect(mocks.prepareToInstall).toHaveBeenCalledOnce()
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  expect(mocks.prepareToInstall.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.updater.quitAndInstall.mock.invocationCallOrder[0] ?? 0
  )
})

it('preserves a failed check and allows a manual retry', async () => {
  start()
  mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error('metadata request failed'))
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'error', message: 'metadata request failed' })
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus().phase).toBe('up-to-date')
})

it('preserves a download error and permits checking again', async () => {
  start()
  mocks.updater.checkForUpdates.mockImplementation(async () => emit('update-available', { version: '1.0.2' }))
  await manager.checkForUpdates(true)
  mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error('download failed'))
  await manager.downloadAvailableUpdate()
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'error', message: 'download failed' })
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus().phase).toBe('available')
})

it('honors a skipped version in the background and offers it again on manual request', async () => {
  start()
  manager.skipUpdate('1.0.2')
  mocks.updater.checkForUpdates.mockImplementation(async () => emit('update-available', { version: '1.0.2' }))
  await manager.checkForUpdates()
  expect(manager.getUpdateStatus().phase).toBe('idle')
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus().phase).toBe('available')
})

it('does not expose the removed version-list and rollback handlers', () => {
  manager.registerUpdateHandlers()
  expect(mocks.ipc.has('updates:list-versions')).toBe(false)
  expect(mocks.ipc.has('updates:install-version')).toBe(false)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
})
