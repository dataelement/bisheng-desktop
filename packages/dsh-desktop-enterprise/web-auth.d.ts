import type { EnterpriseAuthHost } from './enterprise-auth.js'

export interface WebEnterpriseAccount {
  connected: boolean
  connectionKey?: string
  base?: string
  user?: { id: string }
  tenant?: { id: string }
}
export interface WebEnterpriseSession {
  base: string
  tokens: { access_token: string }
  user: { id: string }
  tenant: { id: string }
}
export interface WebEnterpriseAuthHost extends EnterpriseAuthHost {
  /** Synchronously revoke every old-session instance and abort its requests. */
  invalidate(): void
}
/** Trusted host only. Use one host per user session, never one shared account across Web users. */
export declare function createWebEnterpriseAuth(options: {
  getAccount(): WebEnterpriseAccount
  /** Refreshes credentials silently; must not return another user's session. */
  getSessionAuth(): Promise<WebEnterpriseSession | null>
  refreshSession?(failedToken: string, sessionVersion: string): Promise<WebEnterpriseSession | null>
  fetchImpl?: typeof fetch
}): WebEnterpriseAuthHost
