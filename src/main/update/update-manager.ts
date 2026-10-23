import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../../shared/contracts'
import {
  AUTO_INSTALL_ON_APP_QUIT,
  shouldCheckAfterResume,
  supportsAutoUpdates,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  UPDATE_STARTUP_JITTER_MS
} from './update-policy'
import {
  initialUpdateStatus,
  reduceUpdateStatus,
  normalizeReleaseNotes,
  type UpdateStateEvent
} from './update-state'
import {
  readSkippedVersion,
  shouldOfferUpdate,
  skippedVersionPath,
  writeSkippedVersion
} from './skipped-version'

const { autoUpdater } = electronUpdater
const TRANSIENT_STATUS_MS = 8_000
const UPDATES_UNAVAILABLE_MESSAGE = 'Online updates are unavailable in this build.'

let status = initialUpdateStatus(app.getVersion())
let prepareToInstall: (() => Promise<void>) | undefined
let startupTimer: NodeJS.Timeout | undefined
let intervalTimer: NodeJS.Timeout | undefined
let checkPromise: Promise<unknown> | undefined
let lastCheckedAt = 0
let installing = false
let downloading = false
let started = false
let handlersRegistered = false
let updateLocale: (() => 'en' | 'zh') | undefined
let skippedVersion: string | undefined
let skipLoaded = false
let manualCheck = false
let manualCheckRequested = false

export function getUpdateStatus(): UpdateStatus {
  return { ...status, locale: updateLocale?.() }
}

export function registerUpdateHandlers(options: { locale?: () => 'en' | 'zh' } = {}): void {
  updateLocale = options.locale ?? updateLocale
  if (handlersRegistered) return
  handlersRegistered = true
  ipcMain.handle('updates:status', () => getUpdateStatus())
  ipcMain.handle('updates:check', () => checkForUpdates(true))
  ipcMain.handle('updates:install', () => installDownloadedUpdate())
  ipcMain.handle('updates:skip', (_event, version: unknown) => skipUpdate(version))
  ipcMain.handle('updates:download', () => downloadAvailableUpdate())
}

function skipFile(): string {
  return skippedVersionPath(app.getPath('userData'))
}

function currentSkippedVersion(): string | undefined {
  if (!skipLoaded) {
    skippedVersion = readSkippedVersion(skipFile())
    skipLoaded = true
  }
  return skippedVersion
}

/**
 * Stop offering one version. The banner goes away for good rather than until
 * the next launch, and a later release is a new question that still gets
 * asked. A manual check overrides this, which is how the user takes back a
 * version they skipped.
 */
export function skipUpdate(version: unknown): UpdateStatus {
  if (typeof version !== 'string' || !version) return getUpdateStatus()
  skippedVersion = version
  skipLoaded = true
  writeSkippedVersion(skipFile(), version)
  transition({ type: 'reset' })
  return getUpdateStatus()
}

export function startUpdateManager(options: { prepareToInstall: () => Promise<void> }): void {
  prepareToInstall = options.prepareToInstall
  if (started) return
  started = true

  if (!supportsUpdates()) {
    transition({
      type: 'unsupported',
      message: UPDATES_UNAVAILABLE_MESSAGE
    })
    return
  }

  configureUpdater()
  startupTimer = setTimeout(
    () => void checkForUpdates(false, 'startup'),
    UPDATE_STARTUP_DELAY_MS + Math.random() * UPDATE_STARTUP_JITTER_MS
  )
  intervalTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS)
  powerMonitor.on('resume', checkAfterResume)
}

export async function checkForUpdates(manual = false, source: UpdateStatus['source'] = manual ? 'manual' : 'runtime'): Promise<UpdateStatus> {
  // Development builds never start this manager. Their menu/IPC entry points
  // must not initialize an updater against the production feed.
  if (!started || !supportsUpdates()) {
    transition(
      {
        type: 'unsupported',
        message: UPDATES_UNAVAILABLE_MESSAGE
      },
      manual
    )
    return getUpdateStatus()
  }

  if (checkPromise) {
    if (manual) {
      manualCheckRequested = true
      transition({ type: 'present-manual' })
    }
    await checkPromise
    return getUpdateStatus()
  }
  if (['downloading', 'downloaded'].includes(status.phase) || (!manual && status.phase === 'available')) {
    if (manual) {
      manualCheck = true
      transition({ type: 'present-manual' })
    }
    return getUpdateStatus()
  }

  transition({ type: 'check', manual, source })
  manualCheck = manual
  manualCheckRequested = manual
  lastCheckedAt = Date.now()
  checkPromise = (async () => {
    await autoUpdater.checkForUpdates()
  })()
  try {
    await checkPromise
  } catch (error) {
    transition({ type: 'error', message: errorMessage(error) })
  } finally {
    checkPromise = undefined
  }

  return getUpdateStatus()
}

/**
 * Start the download the user just accepted. Consent and download are one
 * action — an update sits at `available` until it is taken.
 */
export async function downloadAvailableUpdate(): Promise<UpdateStatus> {
  if (status.phase !== 'available' || downloading) return getUpdateStatus()
  const expectedVersion = status.availableVersion
  // A queued manual check can replace an automatic offer. Consent to A must
  // not download B; history installs already own this lock and cannot await it.
  if (checkPromise) await checkPromise
  if (status.phase !== 'available' || status.availableVersion !== expectedVersion || downloading) {
    return getUpdateStatus()
  }
  downloading = true

  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    transition({ type: 'error', message: errorMessage(error) })
  } finally {
    downloading = false
  }

  return getUpdateStatus()
}

export async function installDownloadedUpdate(): Promise<void> {
  if (status.phase !== 'downloaded' || installing) return
  installing = true

  try {
    await prepareToInstall?.()
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    installing = false
    transition({ type: 'error', message: errorMessage(error) }, true)
  }
}

export function stopUpdateManager(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  startupTimer = undefined
  intervalTimer = undefined
  if (started && app.isReady()) powerMonitor.removeListener('resume', checkAfterResume)
}

function configureUpdater(): void {
  // The download is ours to start: an update the user skipped should not be
  // fetched at all, and update-available is the only place that is known.
  autoUpdater.autoDownload = false
  autoUpdater.allowDowngrade = false
  autoUpdater.autoInstallOnAppQuit = AUTO_INSTALL_ON_APP_QUIT
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = {
    info: (...args: unknown[]) => console.info('[updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[updater]', ...args),
    error: (...args: unknown[]) => console.error('[updater]', ...args),
    debug: (...args: unknown[]) => console.debug('[updater]', ...args)
  }

  autoUpdater.on('checking-for-update', () =>
    transition({ type: 'check', manual: status.manual, source: status.source })
  )
  autoUpdater.on('update-available', (info) => {
    if (!shouldOfferUpdate(info.version, currentSkippedVersion(), manualCheck)) {
      console.info('[updater] skipping', info.version, 'at the user’s request')
      transition({ type: 'reset' })
      return
    }
    // Offered, not fetched: nothing leaves the network until the user accepts
    // the update, which is the same click that starts the download.
    transition({ type: 'available', version: info.version, releaseNotes: normalizeReleaseNotes(info.releaseNotes) })
  })
  autoUpdater.on('download-progress', (progress) =>
    transition({ type: 'progress', percent: progress.percent })
  )
  autoUpdater.on('update-not-available', () => {
    transition({ type: 'not-available' })
  })
  autoUpdater.on('update-downloaded', (info) =>
    transition({ type: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) => {
    transition({ type: 'error', message: errorMessage(error) })
  })
}

function transition(event: UpdateStateEvent, manualOverride?: boolean): void {
  status = reduceUpdateStatus(status, event)
  if (manualOverride !== undefined) status.manual = manualOverride

  console.info('[updater] status', status.phase, status.percent ?? '')
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('updates:status-changed', getUpdateStatus())
  }
}

function checkAfterResume(): void {
  if (shouldCheckAfterResume(lastCheckedAt)) void checkForUpdates()
}

function supportsUpdates(): boolean {
  return supportsAutoUpdates(app.isPackaged, process.platform)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
