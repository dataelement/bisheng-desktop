import { createEnterpriseMobileExtension } from './mobile/mobile-extension'
import { join } from 'node:path'
import { adoptLegacyCloudState } from '../legacy-cloud-state.js'
import { CloudWorkbenchView } from './cloud-workbench-view'
import type { CloudLaunch } from './cloud-workbench'
import { assertCloudRendererRequest, confirmCloudEffect } from './cloud-confirmation'
import { app, ipcMain, net, safeStorage, screen, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { startEnterpriseDesktop } from './enterprise-desktop'
import { EnterpriseChatView } from './chat-view'
import { createElectronEnterpriseFetch } from './platform-fetch'
import { assertEnterpriseSender, isEnterpriseAppUrl } from './ipc-policy'
import { parseDesktopSettingsAction } from './shared/desktop-settings'
import { bundledHarnessVersion } from '../../../src/main/version-info'
import { allowInsecureEnterpriseLoopback, enterpriseLoginFromArgv, parseEnterpriseLoginLink, registerEnterpriseLoginProtocol } from './login-link'
import { appendWindowLayoutLog, startWindowLayoutProbe } from './window-layout-probe'

export interface EnterpriseProductContext {
  userDataPath: string
  dshHome: string
  safeMode: boolean
  version: string
}

export interface EnterpriseHostActions {
  checkForUpdates(): Promise<void>
  showLogs(): Promise<void>
  restartInSafeMode(): void
}

/** Initialized by the shell before Host launch; never mutates the shell environment. */
export async function createEnterpriseProductRuntime(context: EnterpriseProductContext) {
  if (context.safeMode) return { hostEnvironment: () => ({}), attachWindow() {}, async dispose() {} }
  adoptLegacyCloudState(join(context.dshHome, 'desktop-workbenches'))
  const cloudView = new CloudWorkbenchView()
  let mainWindow: BrowserWindow | undefined
  let layoutProbe: { stop(): void } | undefined
  let enterpriseChat: EnterpriseChatView | undefined
  let disposed = false
  let actions: EnterpriseHostActions | undefined
  const channels = new Set<string>()
  const enterpriseDesktop = await startEnterpriseDesktop({
    userDataPath: context.userDataPath,
    confirmCloudEffect: effect => confirmCloudEffect(effect, mainWindow, app.getLocale().startsWith('zh')),
    desktopVersion: context.version,
    productName: app.getName(),
    activateDesktop: () => { mainWindow?.show(); mainWindow?.focus() },
    safeStorage,
    fetchImpl: createElectronEnterpriseFetch(net.fetch.bind(net)),
    allowInsecureLoopback: allowInsecureEnterpriseLoopback(),
    note: line => console.info(line)
  })
  let cloudAccountKey = enterpriseDesktop.snapshot().connectionKey
  const unsubscribeCloud = enterpriseDesktop.subscribe(state => {
    if (!state.connected || state.connectionKey !== cloudAccountKey) cloudView.close()
    cloudAccountKey = state.connectionKey
  })
  // A missing broker must not silently activate Web/session authentication in Desktop.
  const environment = enterpriseDesktop.harnessEnvironment()
  if (!environment.DSH_DESKTOP_ENTERPRISE_BROKER_URL || !environment.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY) {
    unsubscribeCloud()
    await enterpriseDesktop.stop()
    throw new Error('Enterprise desktop broker failed to initialize.')
  }
  function requireChat(): EnterpriseChatView {
    if (disposed || !enterpriseChat) throw new Error('Enterprise desktop is not ready.')
    return enterpriseChat
  }
  function assertTrustedMainWindowEvent(event: IpcMainInvokeEvent): BrowserWindow {
    if (disposed) throw new Error('Enterprise desktop is stopping.')
    return assertEnterpriseSender(mainWindow, event)
  }
  function deliverPendingEnterpriseLogin(): void {
    if (!pendingLoginUrl || !mainWindow || mainWindow.isDestroyed()) return
    if (!isEnterpriseAppUrl(mainWindow.webContents.getURL())) return
    mainWindow.webContents.send('enterprise:login-link', pendingLoginUrl)
    pendingLoginUrl = undefined
  }
  const launchCloud = async (appId: string): Promise<CloudLaunch> => {
    const value = await enterpriseDesktop.cloudRequest({ operation: 'launch', appId })
    if (!value || typeof value !== 'object') throw new Error('Invalid cloud launch.')
    const record = value as Record<string, unknown>
    if (typeof record.appId !== 'string' || typeof record.slug !== 'string' || typeof record.ticket !== 'string' || typeof record.launchUrl !== 'string' || typeof record.entryUrl !== 'string' || typeof record.connectionKey !== 'string') throw new Error('Invalid cloud launch.')
    return { appId: record.appId, slug: record.slug, ticket: record.ticket, launchUrl: record.launchUrl, entryUrl: record.entryUrl, connectionKey: record.connectionKey }
  }
  function registerEnterpriseChatHandlers(): void {
    for (const channel of ['enterprise-cloud:request', 'enterprise-cloud:open', 'enterprise-cloud:resize', 'enterprise-cloud:close', 'enterprise-cloud:occluded']) channels.add(channel)
    ipcMain.handle('enterprise-cloud:request', (event, input: unknown) => {
      assertTrustedMainWindowEvent(event)
      assertCloudRendererRequest(input)
      return enterpriseDesktop.cloudRequest(input)
    })
    ipcMain.handle('enterprise-cloud:open', async (event, id: unknown, bounds: unknown, key: unknown, owner: unknown) => {
      const parent = assertTrustedMainWindowEvent(event)
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner) || key !== enterpriseDesktop.snapshot().connectionKey) throw new Error('Invalid cloud request or account changed.')
      const launch = await launchCloud(id)
      if (launch.connectionKey !== key) throw new Error('Enterprise account changed.')
      await cloudView.open(parent, launch, bounds, owner, () => enterpriseDesktop.snapshot().connectionKey, launchCloud)
    })
    ipcMain.handle('enterprise-cloud:resize', (event, bounds: unknown, owner: unknown) => { assertTrustedMainWindowEvent(event); cloudView.resizeFor(owner, bounds) })
    ipcMain.handle('enterprise-cloud:close', (event, owner: unknown) => { assertTrustedMainWindowEvent(event); cloudView.closeFor(owner) })
    ipcMain.handle('enterprise-cloud:occluded', (event, value: unknown) => { assertTrustedMainWindowEvent(event); if (typeof value !== 'boolean') throw new Error('Invalid occlusion.'); cloudView.setHostOccluded(value) })
    for (const channel of [
      'enterprise-chat:present',
      'enterprise-chat:capture',
      'enterprise-chat:landing-geometry',
      'enterprise-chat:landing-text-motion',
      'enterprise-chat:state',
      'enterprise-chat:retry',
      'enterprise-chat:usage',
      'enterprise-chat:history',
      'enterprise-chat:open',
      'enterprise-chat:remove',
      'enterprise-chat:rename',
      'enterprise-chat:open-page',
      'enterprise-chat:focus-settings',
      'enterprise-chat:projects-state',
      'enterprise-chat:project-action',
      'enterprise-chat:project-conversations'
    ]) {
      channels.add(channel)
    }

    ipcMain.handle('enterprise-chat:projects-state', (event) => {
      assertTrustedMainWindowEvent(event)
      return requireChat().projectsState()
    })
    ipcMain.handle('enterprise-chat:project-action', (event, action: unknown, epoch: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (!enterpriseChat) throw new Error('Project sync unavailable.')
      return enterpriseChat.projectAction(action, epoch)
    })
    ipcMain.handle('enterprise-chat:project-conversations', (event, page: unknown, epoch: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (!enterpriseChat) throw new Error('Project sync unavailable.')
      return enterpriseChat.projectConversations(page, epoch)
    })
    ipcMain.handle('enterprise-chat:landing-geometry', event => {
      const window = assertTrustedMainWindowEvent(event)
      return requireChat().landingGeometry(window)
    })
    ipcMain.handle('enterprise-chat:landing-text-motion', (event, direction: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (direction !== 'in' && direction !== 'out') throw new Error('Invalid landing motion.')
      return requireChat().landingTextMotion(assertTrustedMainWindowEvent(event), direction)
    })
    ipcMain.handle('enterprise-chat:capture', (event) => {
      const window = assertTrustedMainWindowEvent(event)
      return requireChat().capture(window)
    })
    ipcMain.handle('enterprise-chat:focus-settings', (event) => {
      assertTrustedMainWindowEvent(event)
      requireChat().focusSettings()
    })
    ipcMain.handle('enterprise-chat:present', (event, presentation: unknown) => {
      const window = assertTrustedMainWindowEvent(event)
      return requireChat().present(window, presentation)
    })
    ipcMain.handle('enterprise-chat:state', (event) => {
      assertTrustedMainWindowEvent(event)
      return requireChat().snapshot()
    })
    ipcMain.handle('enterprise-chat:retry', (event) => {
      assertTrustedMainWindowEvent(event)
      requireChat().retry()
    })
    ipcMain.handle('enterprise-chat:usage', (event) => {
      assertTrustedMainWindowEvent(event)
      if (!enterpriseChat) throw new Error('Enterprise usage unavailable.')
      return enterpriseChat.usage()
    })
    ipcMain.handle('enterprise-chat:history', (event, page: unknown) => {
      assertTrustedMainWindowEvent(event)
      return requireChat().history(page)
    })
    ipcMain.handle('enterprise-chat:open-page', (event, id: unknown) => {
      assertTrustedMainWindowEvent(event)
      return requireChat().openPage(id)
    })
    ipcMain.handle('enterprise-chat:open', (event, id: unknown, projectId: unknown) => {
      assertTrustedMainWindowEvent(event)
      return requireChat().open(id, projectId)
    })
    ipcMain.handle('enterprise-chat:remove', (event, id: unknown, epoch: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (!enterpriseChat) throw new Error('Enterprise Chat unavailable.')
      return enterpriseChat.remove(id, epoch)
    })
    ipcMain.handle('enterprise-chat:rename', (event, id: unknown, name: unknown, epoch: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (!enterpriseChat) throw new Error('Enterprise Chat unavailable.')
      return enterpriseChat.rename(id, name, epoch)
    })
  }


  const stopLayoutProbe = (): void => { layoutProbe?.stop(); layoutProbe = undefined }
  const closeWindow = (): void => { stopLayoutProbe(); cloudView.close(); enterpriseChat?.dispose(); enterpriseChat = undefined; mainWindow = undefined }
  try {
    registerEnterpriseChatHandlers()
    for (const channel of ['enterprise:settings-info', 'enterprise:settings-action']) channels.add(channel)
    ipcMain.handle('enterprise:settings-info', event => {
      assertTrustedMainWindowEvent(event)
      return { desktopVersion: context.version, harnessVersion: bundledHarnessVersion(app.getAppPath()) }
    })
    ipcMain.handle('enterprise:settings-action', async (event, value: unknown) => {
      assertTrustedMainWindowEvent(event)
      if (!actions) throw new Error('Desktop settings are not ready.')
      switch (parseDesktopSettingsAction(value)) {
        case 'check-for-updates': await actions.checkForUpdates(); return
        case 'show-harness-log': await actions.showLogs(); return
        case 'safe-mode': actions.restartInSafeMode(); return
      }
    })
    registerEnterpriseLoginProtocol()
    const link = await enterpriseLoginFromArgv(process.argv)
    if (link) pendingLoginUrl = link.url
  } catch (error) {
    for (const channel of channels) ipcMain.removeHandler(channel)
    unsubscribeCloud()
    await enterpriseDesktop.stop()
    throw error
  }
  const onLogin = (): void => { deliverPendingEnterpriseLogin() }
  loginListeners.add(onLogin)
  return {
    hostEnvironment: () => disposed ? {} : { ...enterpriseDesktop.harnessEnvironment(), DSH_ENTERPRISE_LEGACY_CLOUD_PROJECTS: join(context.userDataPath, 'cloud-development') },
    mobileExtension: () => createEnterpriseMobileExtension(enterpriseDesktop, context.userDataPath, app.getName()),
    attachWindow(window: BrowserWindow, services: EnterpriseHostActions): void {
      if (disposed) throw new Error('Enterprise desktop is stopping.')
      actions = services
      if (mainWindow === window) return
      if (mainWindow) {
        stopLayoutProbe()
        mainWindow.webContents.removeListener('did-finish-load', deliverPendingEnterpriseLogin)
        mainWindow.removeListener('closed', closeWindow)
        cloudView.close()
        enterpriseChat?.dispose()
      }
      mainWindow = window
      // Work mode may never create the Chat view. Watch the host window itself.
      layoutProbe = startWindowLayoutProbe({
        window,
        readScaleFactor: () => screen.getDisplayMatching(window.getBounds()).scaleFactor,
        writeLog: line => appendWindowLayoutLog(join(app.getPath('logs'), 'window-layout.log'), line)
      })
      enterpriseChat = new EnterpriseChatView(enterpriseDesktop, line => console.info(line), () => mainWindow)
      window.webContents.on('did-finish-load', deliverPendingEnterpriseLogin)
      window.once('closed', closeWindow)
      deliverPendingEnterpriseLogin()
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      loginListeners.delete(onLogin)
      for (const channel of channels) ipcMain.removeHandler(channel)
      mainWindow?.webContents.removeListener('did-finish-load', deliverPendingEnterpriseLogin)
      mainWindow?.removeListener('closed', closeWindow)
      closeWindow()
      unsubscribeCloud()
      await enterpriseDesktop.stop()
    }
  }
}

// Capture deep links before Electron ready; no credentials or native runtime are created here.
let pendingLoginUrl: string | undefined
const loginListeners = new Set<() => void>()
async function acceptLogin(value: string): Promise<void> {
  try {
    pendingLoginUrl = (await parseEnterpriseLoginLink(value)).url
    for (const listener of loginListeners) listener()
  } catch {
    console.warn('[enterprise] invalid login link rejected')
  }
}
app.on('open-url', (event, value) => { event.preventDefault(); void acceptLogin(value) })
app.on('second-instance', (_event, argv) => {
  void enterpriseLoginFromArgv(argv).then(link => { if (link) return acceptLogin(link.url) }).catch(() => { console.warn('[enterprise] invalid login arguments rejected') })
})
