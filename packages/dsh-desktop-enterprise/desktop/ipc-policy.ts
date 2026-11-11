import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/** The account bridge belongs only to the trusted application authority. */
export function isEnterpriseAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && !url.port && !url.username && !url.password
  } catch {
    return false
  }
}

/** Only the product's explicitly attached application window owns enterprise operations. */
export function assertEnterpriseSender(
  window: BrowserWindow | undefined,
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>
): BrowserWindow {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Enterprise IPC rejected: unowned window or frame.')
  }
  if (!isEnterpriseAppUrl(event.senderFrame.url)) {
    throw new Error('Enterprise IPC rejected: untrusted application origin.')
  }
  return window
}
