import { contextBridge, ipcRenderer } from 'electron'

/** Presentation-only channel. Remote Chat receives no local execution or account APIs. */
contextBridge.exposeInMainWorld('dshChatPresentation', Object.freeze({
  reportNavigation(navigation: unknown): void {
    ipcRenderer.send('enterprise-chat:navigation', { navigation, path: window.location.pathname })
  },
  reportLanding(landing: unknown): void {
    if (typeof landing === 'boolean') ipcRenderer.send('enterprise-chat:landing', { landing, path: window.location.pathname })
  }
}))
