export { validateEnterpriseAppId, assertEnterprisePublicRequestPath } from './enterprise-apps-contract.js'

export interface EnterpriseAppAccessOptions {
  appId: string
  path: string
  /** Trusted host identity; never read these fields from a plugin request body. */
  plugin: { pluginId: string; instanceId: string }
  base: string
  accessToken: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  assertCurrent: () => void
}
/** Host-only result. Never serialize its application credential to plugins or renderers. */
export declare function resolveEnterpriseAppAccess(options: EnterpriseAppAccessOptions): Promise<{ endpoint: string; accessToken: string }>
