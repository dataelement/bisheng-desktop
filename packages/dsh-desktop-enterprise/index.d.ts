import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseAuth } from './enterprise-auth.js'
export { EnterpriseToolError } from './enterprise-tools.js'
export type { EnterpriseToolOptions, EnterpriseToolErrorCode, EnterpriseToolDiagnostics, JsonValue } from './enterprise-tools.js'
export { EnterpriseAuthError } from './enterprise-auth.js'
export type { EnterpriseAuth, EnterpriseAuthState, EnterpriseAuthRequestInit, EnterpriseAuthErrorCode } from './enterprise-auth.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseAuth: EnterpriseAuth
  }
}

export declare const name = "dsh-desktop-enterprise"
export declare const inject: readonly ["connection", "llm", "loader"]
export declare const BISHENG_PROVIDER_ROUTE = "bisheng-enterprise"
export declare function apply(ctx: Context): void
