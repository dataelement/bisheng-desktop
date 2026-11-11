import { app, ipcMain, net, safeStorage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { startEnterpriseDesktop } from './enterprise-desktop'
import { EnterpriseChatView } from './chat-view'
import { createElectronEnterpriseFetch } from './platform-fetch'
import { assertEnterpriseSender, isEnterpriseAppUrl } from './ipc-policy'
import { parseDesktopSettingsAction } from './shared/desktop-settings'
import { bundledHarnessVersion } from '../../../src/main/version-info'
import { allowInsecureEnterpriseLoopback, enterpriseLoginFromArgv, parseEnterpriseLoginLink, registerEnterpriseLoginProtocol } from './login-link'

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
  let mainWindow: BrowserWindow | undefined
  let enterpriseChat: EnterpriseChatView | undefined
  let disposed = false
  let actions: EnterpriseHostActions | undefined
  const channels = new Set<string>()
  const enterpriseDesktop = await startEnterpriseDesktop({
    userDataPath: context.userDataPath,
    desktopVersion: context.version,
    activateDesktop: () => { mainWindow?.show(); mainWindow?.focus() },
    safeStorage,
    fetchImpl: createElectronEnterpriseFetch(net.fetch.bind(net)),
    allowInsecureLoopback: allowInsecureEnterpriseLoopback(),
    note: line => console.info(line)
  })
  // A missing broker must not silently activate Web/session authentication in Desktop.
  const environment = enterpriseDesktop.harnessEnvironment()
  if (!environment.DSH_DESKTOP_ENTERPRISE_BROKER_URL || !environment.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY) {
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
  function registerEnterpriseChatHandlers(): void {
    for (const channel of [
      'enterprise-chat:present',
      'enterprise-chat:capture',
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


  const closeWindow = (): void => { enterpriseChat?.dispose(); enterpriseChat = undefined; mainWindow = undefined }
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
    await enterpriseDesktop.stop()
    throw error
  }
  const onLogin = (): void => { deliverPendingEnterpriseLogin() }
  loginListeners.add(onLogin)
  return {
    hostEnvironment: () => disposed ? {} : enterpriseDesktop.harnessEnvironment(),
    attachWindow(window: BrowserWindow, services: EnterpriseHostActions): void {
      if (disposed) throw new Error('Enterprise desktop is stopping.')
      actions = services
      if (mainWindow === window) return
      if (mainWindow) {
        mainWindow.webContents.removeListener('did-finish-load', deliverPendingEnterpriseLogin)
        mainWindow.removeListener('closed', closeWindow)
        enterpriseChat?.dispose()
      }
      mainWindow = window
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
