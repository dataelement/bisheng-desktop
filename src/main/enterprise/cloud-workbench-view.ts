import { WebContentsView, session, shell, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { CloudLaunch } from './cloud-workbench'

export interface CloudBounds { x: number; y: number; width: number; height: number }
export function cloudBounds(input: unknown, width: number, height: number): CloudBounds {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud view bounds.')
  const value = input as Record<string, unknown>
  const fields = ['x', 'y', 'width', 'height'] as const
  if (fields.some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error('Invalid cloud view bounds.')
  const x = Math.max(0, Math.min(width, Math.floor(value.x as number)))
  const y = Math.max(0, Math.min(height, Math.floor(value.y as number)))
  return { x, y, width: Math.max(0, Math.min(width - x, Math.floor(value.width as number))),
    height: Math.max(0, Math.min(height - y, Math.floor(value.height as number))) }
}
interface RetainedView { view: WebContentsView; partition: Electron.Session; connectionKey: string; appId: string; renewedAt: number; renewing?: boolean }

/** Application pages run in distinct, nonpersistent, unprivileged sessions. */
export class CloudWorkbenchView {
  private readonly retained = new Map<string, RetainedView>()
  private active: RetainedView | undefined
  private owner: string | undefined
  private generation = 0
  private connectionKey: string | undefined
  private parent: BrowserWindow | undefined
  private timer: NodeJS.Timeout | undefined
  private readonly onParentClosed = () => this.close()

  async open(parent: BrowserWindow, launch: CloudLaunch, bounds: unknown, owner: string, currentKey: () => string | undefined, renew?: (appId: string) => Promise<CloudLaunch>): Promise<void> {
    this.hide()
    if (this.connectionKey && this.connectionKey !== launch.connectionKey) this.close()
    const generation = ++this.generation
    this.parent?.removeListener('closed', this.onParentClosed)
    this.parent = parent
    parent.once('closed', this.onParentClosed)
    this.connectionKey = launch.connectionKey
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (currentKey() !== this.connectionKey) { this.close(); return }
      // Renew scoped cookies without reloading pages or touching user inputs.
      for (const retained of this.retained.values()) {
        if (!renew || retained.renewing || Date.now() - retained.renewedAt < 20 * 60 * 1000) continue
        retained.renewing = true
        void renew(retained.appId).then(async fresh => {
          if (fresh.connectionKey !== retained.connectionKey || currentKey() !== fresh.connectionKey || fresh.appId !== retained.appId) throw new Error('Enterprise account changed.')
          await this.refreshCookie(retained, fresh)
        }).catch(() => {
          retained.renewedAt = Date.now() // Back off; an explicit reopen can retry immediately.
          if (this.active === retained) {
            parent.webContents.send('enterprise-cloud:access-required', { owner: this.owner, appId: retained.appId })
            this.hide()
          }
        }).finally(() => { retained.renewing = false })
      }
    }, 500)
    this.timer.unref()
    const cacheKey = `${launch.connectionKey}:${launch.appId}`
    let item = this.retained.get(cacheKey)
    let created = false
    let superseded = false
    try {
      if (item) {
        await this.refreshCookie(item, launch)
      } else {
        if (this.retained.size >= 8) throw new Error('Eight cloud workbenches are open. Reconnect to release inactive pages.')
        const partition = session.fromPartition(`cloud-workbench-${randomUUID()}`)
        partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
        partition.setPermissionCheckHandler(() => false)
        const view = new WebContentsView({ webPreferences: { session: partition, sandbox: true, contextIsolation: true,
          nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false } })
        item = { view, partition, connectionKey: launch.connectionKey, appId: launch.appId, renewedAt: Date.now() }
        this.retained.set(cacheKey, item)
        created = true
        const entry = new URL(launch.entryUrl)
        const allowed = (url: string): boolean => {
          try { const next = new URL(url); return next.origin === entry.origin && next.pathname.startsWith(entry.pathname) } catch { return false }
        }
        view.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
          return { action: 'deny' }
        })
        view.webContents.on('will-navigate', (event, url) => {
          if (allowed(url)) return
          event.preventDefault()
          let target: URL
          try { target = new URL(url) } catch { return }
          if (target.origin === entry.origin && /\/(?:admin|login)(?:\/|$)/u.test(target.pathname) && this.active?.view === view) {
            parent.webContents.send('enterprise-cloud:access-required', { owner: this.owner, appId: launch.appId })
            this.hide()
          }
        })
        view.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
        view.webContents.on('will-attach-webview', event => event.preventDefault())
        await this.refreshCookie(item, launch)
        await view.webContents.loadURL(launch.entryUrl)
      }
      if (generation !== this.generation || this.retained.get(cacheKey) !== item) {
        superseded = true
        throw new Error('Cloud workbench opening was cancelled.')
      }
      if (currentKey() !== launch.connectionKey) {
        this.close()
        throw new Error('Enterprise account changed.')
      }
      this.active = item
      this.owner = owner
      parent.contentView.addChildView(item.view)
      this.resize(bounds)
    } catch (error) {
      // Superseded opens may share a retained page with the newer open.
      if (!superseded && created && item && this.retained.get(cacheKey) === item) {
        this.retained.delete(cacheKey)
        if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
        void item.partition.clearStorageData()
      }
      if (generation === this.generation) this.hide()
      throw error
    }
  }

  private async refreshCookie(item: RetainedView, launch: CloudLaunch): Promise<void> {
    const response = await item.partition.fetch(launch.launchUrl, { method: 'POST',
      body: new URLSearchParams({ ticket: launch.ticket }).toString(),
      // Electron session.fetch rejects a manual 303 with "Redirect was cancelled".
      // Negotiate a non-navigating exchange; the HttpOnly cookie stays in this
      // app's isolated session, including when renewing a retained page.
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, redirect: 'error', credentials: 'include' })
    await response.body?.cancel()
    if (response.status !== 204) throw new Error(`Cloud application access expired (HTTP ${response.status}). Reconnect and retry.`)
    item.renewedAt = Date.now()
  }

  resize(bounds: unknown): void {
    if (!this.active || !this.parent || this.parent.isDestroyed()) return
    const [width, height] = this.parent.getContentSize()
    this.active.view.setBounds(cloudBounds(bounds, width ?? 0, height ?? 0))
  }
  resizeFor(owner: unknown, bounds: unknown): void { if (owner === this.owner) this.resize(bounds) }
  closeFor(owner: unknown): void { if (owner === this.owner) { this.generation++; this.hide() } }

  release(appId: string, connectionKey: string): void {
    const key = `${connectionKey}:${appId}`
    const item = this.retained.get(key)
    if (!item) return
    this.retained.delete(key)
    if (this.active === item) this.hide()
    if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
    void item.partition.clearStorageData()
  }

  private hide(): void {
    if (this.active && this.parent && !this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.active.view)
    this.active = undefined
    this.owner = undefined
  }

  close(): void {
    this.generation++
    this.hide()
    this.parent?.removeListener('closed', this.onParentClosed)
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const item of this.retained.values()) {
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close()
      void item.partition.clearStorageData()
    }
    this.retained.clear()
    this.parent = undefined
    this.connectionKey = undefined
  }
}
