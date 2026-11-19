import { BrowserWindow, ipcMain, WebContentsView, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import type { UpdateStatus } from '../../shared/contracts'
import { updateCardMeasuredSize, updateCardOuterWidth, updateCardViewBounds } from '../../shared/update-card-bounds'
import { shouldShowUpdate } from '../../preload/update-view'
import { bindUpdateCardPresenter, getUpdateStatus } from './update-manager'

const HOST_STATE_CHANNEL = 'updates:card-host-state'
const LAYOUT_CHANNEL = 'updates:card-layout'

interface CardLayout {
  visible: boolean
  width: number
  height: number
}

let listening = false
let enabled = false
let owner: BrowserWindow | undefined
let view: WebContentsView | undefined
let attached = false
let held = false
let locale: 'en' | 'zh' = 'zh'
let theme: 'dark' | 'light' = 'light'
let layout: CardLayout = { visible: false, width: 0, height: 0 }
let loaded = false

/** Production windows can show the single desktop update card. Dev never calls this. */
export function enableUpdateCardView(window: BrowserWindow): void {
  enabled = true
  attachUpdateCardWindow(window)
}

/** A window created after updates are enabled takes over the same card. */
export function attachUpdateCardWindowIfEnabled(window: BrowserWindow): void {
  if (!enabled) return
  attachUpdateCardWindow(window)
  presentStatus(getUpdateStatus())
}

function attachUpdateCardWindow(window: BrowserWindow): void {
  ensureListening()
  if (owner === window) return
  detach()
  owner = window
  const onResize = (): void => { if (owner === window && attached) place() }
  window.on('resize', onResize)
  window.on('closed', () => {
    window.removeListener('resize', onResize)
    if (owner === window) detach()
  })
}

/** Chat was just attached. Keep the card above it only while the card is already showing. */
export function raiseUpdateCardViewIfShown(window: BrowserWindow): void {
  if (window !== owner || !attached || !view || window.isDestroyed()) return
  window.contentView.addChildView(view)
}

function ensureListening(): void {
  if (listening) return
  listening = true
  bindUpdateCardPresenter(presentStatus)
  ipcMain.on(HOST_STATE_CHANNEL, onHostState)
  ipcMain.on(LAYOUT_CHANNEL, onLayout)
}

function presentStatus(status: UpdateStatus): void {
  if (!owner || owner.isDestroyed()) return
  if (!view && !shouldShowUpdate(status)) return
  ensureView()
  deliver()
}

function ensureView(): void {
  if (view || !owner || owner.isDestroyed()) return
  const cardView = new WebContentsView({
    webPreferences: {
      // Main is bundled into out/main/index.js, so the preload is one directory up.
      preload: join(import.meta.dirname, '../preload/update-overlay.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  cardView.setBackgroundColor('#00000000')
  // The view is not on screen yet. Give the document a viewport so it can measure the card before it is added.
  cardView.setBounds({ x: 0, y: 0, width: updateCardOuterWidth(), height: 360 })
  cardView.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[updater] card preload failed', preloadPath, error)
  })
  cardView.webContents.on('did-finish-load', () => {
    if (view !== cardView) return
    loaded = true
    deliver()
  })
  view = cardView
  loaded = false
  void cardView.webContents.loadURL('about:blank')
}

function deliver(): void {
  if (!view || view.webContents.isDestroyed() || !loaded) return
  view.webContents.send(HOST_STATE_CHANNEL, { held, locale, theme })
  view.webContents.send('updates:status-changed', getUpdateStatus())
}

function onHostState(event: IpcMainEvent, payload: unknown): void {
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return
  const next = readHostState(payload)
  if (!next) return
  held = next.held
  locale = next.locale
  theme = next.theme
  if (loaded && view && !view.webContents.isDestroyed()) view.webContents.send(HOST_STATE_CHANNEL, { held, locale, theme })
  place()
}

function onLayout(event: IpcMainEvent, payload: unknown): void {
  if (!view || event.sender !== view.webContents) return
  const next = readLayout(payload)
  if (!next) return
  layout = next
  place()
}

function place(): void {
  if (!owner || owner.isDestroyed() || !view) return
  const show = layout.visible && !held
  if (!show) {
    if (attached) {
      owner.contentView.removeChildView(view)
      attached = false
    }
    return
  }
  const [width = 0, height = 0] = owner.getContentSize()
  const bounds = updateCardViewBounds({ width, height }, updateCardMeasuredSize(layout))
  if (bounds.width <= 0 || bounds.height <= 0) return
  view.setBounds(bounds)
  owner.contentView.addChildView(view)
  attached = true
}

function detach(): void {
  if (owner && !owner.isDestroyed() && view && attached) owner.contentView.removeChildView(view)
  if (view && !view.webContents.isDestroyed()) view.webContents.close()
  view = undefined
  attached = false
  loaded = false
  layout = { visible: false, width: 0, height: 0 }
  owner = undefined
}

function readHostState(value: unknown): { held: boolean; locale: 'en' | 'zh'; theme: 'dark' | 'light' } | null {
  if (!value || typeof value !== 'object') return null
  if (!('locale' in value) || (value.locale !== 'en' && value.locale !== 'zh')) return null
  return {
    held: 'held' in value && value.held === true,
    locale: value.locale,
    theme: 'theme' in value && value.theme === 'dark' ? 'dark' : 'light'
  }
}

function readLayout(value: unknown): CardLayout | null {
  if (!value || typeof value !== 'object') return null
  const width = 'width' in value && typeof value.width === 'number' && Number.isFinite(value.width) ? Math.round(value.width) : -1
  const height = 'height' in value && typeof value.height === 'number' && Number.isFinite(value.height) ? Math.round(value.height) : -1
  if (width < 0 || height < 0 || width > 2000 || height > 2000) return null
  return { visible: 'visible' in value && value.visible === true, width, height }
}
