export { validateEnterpriseAppId, assertEnterprisePublicRequestPath } from './enterprise-apps-contract.js'

export interface EnterpriseAppContext {
  base: string
  userId: string
  tenantId: string
  sessionVersion: string
}
export interface EnterpriseAppAccessOptions {
  appId: string
  appBaseUrl: string
  appScopes?: string[]
  path: string
  /** Trusted, active plugin instance; not an application allowlist. */
  plugin: { pluginId: string; instanceId: string }
  base: string
  /** Sent only to BiSheng; never sent directly to the business application. */
  accessToken: string
  context: EnterpriseAppContext
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  assertCurrent: () => void
}
/** Host-only result. BiSheng authorizes the audience before any business request. */
export declare function resolveEnterpriseAppAccess(options: EnterpriseAppAccessOptions): Promise<{ endpoint: string; accessToken: string }>
