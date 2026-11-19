import { ipcRenderer } from 'electron'
import type { UpdateStatus } from '../shared/contracts'
import { mountUpdateCard } from './update-card-mount'

function startUpdateCard(): void {
  const card = mountUpdateCard(document, layout => {
    ipcRenderer.send('updates:card-layout', layout)
  })

  ipcRenderer.on('updates:status-changed', (_event, status: UpdateStatus) => {
    card.applyStatus(status)
  })

  ipcRenderer.on('updates:card-host-state', (_event, state: unknown) => {
    if (!state || typeof state !== 'object') return
    if ('locale' in state && (state.locale === 'en' || state.locale === 'zh')) card.setLocale(state.locale)
    if ('theme' in state && (state.theme === 'dark' || state.theme === 'light')) card.setTheme(state.theme)
    card.setAboutOpen('held' in state && state.held === true)
  })

  void ipcRenderer.invoke('updates:status').then((status: UpdateStatus) => {
    card.applyStatus(status)
  }).catch((error: unknown) => {
    console.warn('[updater] unable to read update status', error)
  })
}

// about:blank has no body while this preload runs. Mounting immediately throws
// and the card never reports a size, so the window never adds it.
if (document.readyState === 'loading' || document.body === null) {
  window.addEventListener('DOMContentLoaded', startUpdateCard, { once: true })
} else {
  startUpdateCard()
}
