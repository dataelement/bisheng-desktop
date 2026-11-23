import { randomUUID } from 'node:crypto'
import { session, type Session } from 'electron'
import type { EnterpriseDesktopRuntime } from './enterprise-desktop'

export type HostedAppAccount = Pick<EnterpriseDesktopRuntime, 'snapshot' | 'subscribe' | 'webSession'>
export interface HostedAppIdentity { session: Session; origin: string; connectionKey: string }
interface Signed extends HostedAppIdentity { expiresAt: number }

// Web sessions live 30–600 s. Renew on the same margin as Desktop Chat; a
// cookie this close to expiry is re-signed before a new page is opened with it.
const RENEW_BEFORE_MS = 30_000
const REUSE_MARGIN_MS = 10_000

/**
 * The browser session every hosted app page runs in, one per enterprise account.
 * It holds the user's own web login cookie, minted by the same Desktop → web
 * exchange Desktop Chat uses. Hosted apps are served at `{origin}/apps/{slug}/`,
 * where the platform's app proxy admits that cookie exactly as it does for a
 * browser tab, so Desktop needs no launch ticket or app-specific session.
 *
 * The session is kept apart from Chat's own so opening an app never depends on
 * Chat having been shown, and Chat recovery never reloads an open app.
 */
export class HostedAppSession {
  private current?: Signed
  private pending?: { connectionKey: string; promise: Promise<HostedAppIdentity> }
  private generation = 0
  private timer?: NodeJS.Timeout
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void

  constructor(private readonly account: HostedAppAccount, private readonly note: (line: string) => void) {
    this.unsubscribe = account.subscribe(state => {
      const signed = this.current ?? this.pending
      if (signed && (!state.connected || state.connectionKey !== signed.connectionKey)) this.reset()
    })
  }

  /** Pages opened with an earlier identity belong to that account and must close when it ends. */
  onReset(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  acquire(): Promise<HostedAppIdentity> {
    const state = this.account.snapshot()
    const connectionKey = state.connected ? state.connectionKey : undefined
    if (!connectionKey) return Promise.reject(new Error('Enterprise login required.'))
    const current = this.current
    if (current && current.connectionKey !== connectionKey) this.reset()
    else if (current && current.expiresAt - Date.now() > REUSE_MARGIN_MS) return Promise.resolve(identity(current))
    if (this.pending?.connectionKey === connectionKey) return this.pending.promise
    const promise = this.sign(connectionKey).finally(() => { if (this.pending?.promise === promise) this.pending = undefined })
    this.pending = { connectionKey, promise }
    return promise
  }

  private async sign(connectionKey: string): Promise<HostedAppIdentity> {
    const generation = this.generation
    const assertCurrent = () => {
      const state = this.account.snapshot()
      if (generation !== this.generation || !state.connected || state.connectionKey !== connectionKey) throw new Error('Enterprise account changed.')
    }
    const credential = await this.account.webSession(connectionKey)
    assertCurrent()
    const origin = new URL(credential.base).origin
    let signed = this.current
    if (!signed || signed.origin !== origin) {
      if (signed) this.dropSession(signed)
      const partition = session.fromPartition(`enterprise-hosted-apps-${randomUUID()}`)
      // Same grant as Chat: sanitized clipboard writes from this enterprise only.
      partition.setPermissionRequestHandler((_contents, permission, callback, details) => {
        callback(permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith(origin + '/'))
      })
      partition.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === origin)
      signed = { session: partition, origin, connectionKey, expiresAt: 0 }
      this.current = signed
    }
    await signed.session.cookies.set({ url: credential.base, name: credential.cookieName, value: credential.cookie, path: '/', httpOnly: true,
      secure: new URL(credential.base).protocol === 'https:', sameSite: 'lax', expirationDate: credential.expiresAt / 1000 })
    assertCurrent()
    signed.expiresAt = credential.expiresAt
    this.schedule(Math.max(1000, credential.expiresAt - Date.now() - RENEW_BEFORE_MS), connectionKey)
    return identity(signed)
  }

  /** Keeps the cookie fresh for pages that stay open, without reloading them. */
  private schedule(delayMs: number, connectionKey: string): void {
    clearTimeout(this.timer)
    const generation = this.generation
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (generation !== this.generation || this.current?.connectionKey !== connectionKey) return
      this.current.expiresAt = 0
      void this.acquire().catch(error => {
        // Open pages keep working until the cookie lapses; the next open signs again.
        if (generation === this.generation) this.note(`[hosted-app] session_renew_failed ${error instanceof Error ? error.message : 'unknown'}`)
      })
    }, delayMs)
    this.timer.unref?.()
  }

  private dropSession(signed: Signed): void {
    void signed.session.clearStorageData().then(() => signed.session.closeAllConnections())
      .catch(() => this.note('[hosted-app] session_cleanup_failed'))
  }

  reset(): void {
    this.generation++
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
    const signed = this.current
    this.current = undefined
    if (signed) this.dropSession(signed)
    for (const listener of this.listeners) {
      try { listener() }
      catch { this.note('[hosted-app] reset_listener_failed') }
    }
  }

  dispose(): void {
    this.unsubscribe()
    this.reset()
    this.listeners.clear()
  }
}

function identity(signed: Signed): HostedAppIdentity {
  return { session: signed.session, origin: signed.origin, connectionKey: signed.connectionKey }
}
