import { contextBridge, ipcRenderer } from 'electron'
import type { EnterpriseChatPresentation, EnterpriseChatViewState } from '../shared/enterprise-chat-view'

export function initializeEnterpriseLoginBridge(): () => void {
  const enterpriseLoginListeners = new Set<(url: string) => void>()
  let pendingEnterpriseLoginUrl: string | undefined

  ipcRenderer.on('enterprise:login-link', (_event, url: unknown) => {
    if (typeof url !== 'string') return
    pendingEnterpriseLoginUrl = url
    for (const listener of enterpriseLoginListeners) listener(url)
  })

  return () => {
    ipcRenderer.on('enterprise-chat:close-settings', () => {
      window.dispatchEvent(new CustomEvent('dsh-desktop:close-settings'))
    })
    ipcRenderer.on('enterprise-chat:settings-focus', (_event, detail) => {
      window.dispatchEvent(new CustomEvent('dsh-desktop:settings-focus', { detail }))
    })

    contextBridge.exposeInMainWorld('dshEnterpriseChat', Object.freeze({
      onToolsChanged: (listener: () => void): (() => void) => {
        if (typeof listener !== 'function') throw new TypeError('Tool change listener must be a function.')
        const receive = (): void => listener()
        ipcRenderer.on('enterprise-chat:tools-changed', receive)
        return () => ipcRenderer.removeListener('enterprise-chat:tools-changed', receive)
      },
      focusSettings: (): Promise<void> => ipcRenderer.invoke('enterprise-chat:focus-settings'),
      present: (value: EnterpriseChatPresentation): Promise<EnterpriseChatViewState> => ipcRenderer.invoke('enterprise-chat:present', value),
      state: (): Promise<EnterpriseChatViewState> => ipcRenderer.invoke('enterprise-chat:state'),
      retry: (): Promise<void> => ipcRenderer.invoke('enterprise-chat:retry'),
      usage: (): Promise<import('../shared/enterprise-usage').EnterpriseUsage> => ipcRenderer.invoke('enterprise-chat:usage'),
      history: (page: number) => ipcRenderer.invoke('enterprise-chat:history', page),
      openPage: (id: string): Promise<void> => ipcRenderer.invoke('enterprise-chat:open-page', id),
      open: (id: string): Promise<void> => ipcRenderer.invoke('enterprise-chat:open', id),
      subscribe: (listener: (state: EnterpriseChatViewState) => void): (() => void) => {
        const receive = (_event: Electron.IpcRendererEvent, state: EnterpriseChatViewState): void => listener(state)
        ipcRenderer.on('enterprise-chat:changed', receive)
        return () => ipcRenderer.removeListener('enterprise-chat:changed', receive)
      }
    }))

    contextBridge.exposeInMainWorld(
      'dshDesktopEnterprise',
      Object.freeze({
        onLoginLink: (listener: (url: string) => void): (() => void) => {
          if (typeof listener !== 'function') {
            throw new TypeError('Enterprise login listener must be a function.')
          }
          enterpriseLoginListeners.add(listener)
          if (pendingEnterpriseLoginUrl) listener(pendingEnterpriseLoginUrl)
          return () => {
            enterpriseLoginListeners.delete(listener)
          }
        },
        consumeLoginLink: (): string | undefined => {
          const url = pendingEnterpriseLoginUrl
          pendingEnterpriseLoginUrl = undefined
          return url
        }
      })
    )

  }
}
