import { net, safeStorage, type BrowserWindow } from 'electron'
import { EnterpriseChatView } from './chat-view'
import { startEnterpriseDesktop } from './enterprise-desktop'
import { allowInsecureEnterpriseLoopback } from './login-link'
import { createElectronEnterpriseFetch } from './platform-fetch'

export async function startEnterpriseExtension(context: {
  version: string
  userDataPath: string
  activate: () => Promise<void>
  note: (line: string) => void
  window: () => BrowserWindow | undefined
}) {
  const desktop = await startEnterpriseDesktop({
    desktopVersion: context.version,
    activateDesktop: context.activate,
    userDataPath: context.userDataPath,
    safeStorage,
    fetchImpl: createElectronEnterpriseFetch(net.fetch.bind(net)),
    allowInsecureLoopback: allowInsecureEnterpriseLoopback(),
    note: context.note
  })
  let stopPromise: Promise<void> | undefined
  return {
    readThirdPartyPolicy: () => desktop.readThirdPartyPolicy(),
    rotateCapability: () => desktop.rotateCapability(),
    harnessEnvironment: () => desktop.harnessEnvironment(),
    stop() {
      stopPromise ??= desktop.stop().catch((error: unknown) => {
        stopPromise = undefined
        throw error
      })
      return stopPromise
    },
    createView: () => new EnterpriseChatView(desktop, context.note, context.window)
  }
}
