import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseAuth } from './enterprise-auth.js'
import type { AuditContextField } from './contract.js'
export { EnterpriseAuthError } from './enterprise-auth.js'
export type { EnterpriseAuth, EnterpriseAuthState, EnterpriseAuthRequestInit, EnterpriseAuthErrorCode } from './enterprise-auth.js'

export interface EnterpriseAuditCapability {
  fields: AuditContextField[]
}

export interface EnterpriseBrokerEndpoint {
  origin: string
  capability: string
}

export interface EnterpriseBrokerInput {
  origin?: string
  url?: string
  capability: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseAuth: EnterpriseAuth
    enterpriseBroker?: EnterpriseBrokerEndpoint
  }
}

export declare const name = "dsh-desktop-enterprise"
export declare const inject: readonly ["connection", "llm", "loader"]
export declare const BISHENG_PROVIDER_ROUTE = "bisheng-enterprise"
export declare function provideEnterpriseBroker(
  ctx: unknown,
  broker: EnterpriseBrokerInput
): EnterpriseBrokerEndpoint | null
export declare function apply(ctx: Context, config?: { broker?: EnterpriseBrokerInput }): void
