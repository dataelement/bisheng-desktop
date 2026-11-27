import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseAuthTransport } from './enterprise-auth-client.js'
export { EnterpriseAuthError } from './enterprise-auth-client.js'
export type { EnterpriseAuth, EnterpriseAuthState, EnterpriseAuthRequestInit, EnterpriseAuthErrorCode, EnterpriseAuthTransport } from './enterprise-auth-client.js'

export interface EnterpriseAuthHost {
  grant(identity: { pluginId: string; instanceId: string }): Promise<EnterpriseAuthTransport>
  revoke(transport: EnterpriseAuthTransport): Promise<void>
}
export declare function applyEnterpriseAuth(ctx: Context): void
/** Host-only observer: latest request completion, after full body consumption; cancellation is ignored. */
export declare function bindEnterpriseAuth(ctx: Context, transport: EnterpriseAuthTransport, onRequestSettled?: (error?: unknown) => void): Promise<() => void>
export declare function createEnterpriseAuthTransport(origin: string, capability: string): EnterpriseAuthTransport
export declare function inheritEnterpriseAuth(target: Context, source: Context): void
