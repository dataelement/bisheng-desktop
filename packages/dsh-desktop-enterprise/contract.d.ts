export declare const CONTRACT_VERSION = "0.5.0"
export { parseAuditTitleUpdate } from './audit-title.js'
export declare const CLIENT_ID = "dsh-desktop"
export declare const CALLBACK_PATH = "/dsh/callback"
export declare const ACCESS_REFRESH_SKEW_MS = 60000
export type AuditContextField = 'conversation_id' | 'request_kind' | 'session_origin' | 'parent_conversation_id' | 'message_sources'
export interface EnterpriseAuditContext {
  conversation_id?: string
  request_kind?: 'chat' | 'compaction' | 'session-title'
  session_origin?: 'main' | 'subagent'
  parent_conversation_id?: string
  message_sources?: { items: { message_index: number; sources: { kind: string; form?: string }[] }[]; truncated: boolean }
}
export declare const AUDIT_CONTEXT_FIELDS: readonly AuditContextField[]
export declare function parseAuditContextFields(value: unknown): AuditContextField[]
export declare function normalizeAuditContext(value: unknown, allowedFields?: readonly string[], messageCount?: number): EnterpriseAuditContext | undefined
export declare const COMPATIBLE_CONTRACT_VERSIONS: readonly ['0.4.0', '0.5.0']
export declare const API_PATHS: Readonly<Record<'config' | 'authorizations' | 'token' | 'logout' | 'models' | 'chat' | 'responses' | 'usage' | 'auditTitle', string>>

export interface EnterpriseModelReasoning {
  efforts: Array<{ id: string; name: string }>
  defaultEffort?: string
}

export interface EnterpriseModel {
  id: string
  object: string
  created: number
  owned_by: string
  display_name: string
  reasoning?: EnterpriseModelReasoning
  capabilities: { streaming: boolean; tools: boolean; reasoning_content: boolean; vision?: boolean; responses?: boolean }
  usage?: {
    source: 'live' | 'persisted' | 'unavailable'
    quota_state: 'available' | 'exhausted' | 'unavailable'
    used: number | null
    limit: number | null
    remaining: number | null
    as_of: string | null
  }
}

export declare class EnterpriseApiError extends Error {
  status?: number
  code?: string
  type?: string
  requestId?: string
  uncertain: boolean
}

export declare function createPkceTransaction(): {
  codeVerifier: string
  codeChallenge: string
  state: string
}
export declare function pkceChallenge(codeVerifier: string): string
export declare function parseThirdPartyPolicy(value: unknown): {
  allowThirdPartyPlugins: boolean
  allowThirdPartyWorkbenches: boolean
  syncSeconds: number
}
export declare function parseConfig(value: unknown): { enabled: false } | {
  enabled: true
  client_id: 'dsh-desktop'
  contract_version: '0.4.0' | '0.5.0'
  audit_context?: { fields: AuditContextField[] }
  audit_conversation_title?: { version: 1 }
}
export declare function parseAuthorization(value: unknown, base: string): {
  auth_id: string
  authorize_url: string
  expires_in: number
}
export declare function parseToken(value: unknown, base: string, receivedAt?: number): Record<string, unknown> & {
  base: string
  access_token: string
  refresh_token: string
  session_id: string
}
export declare function parseModels(value: unknown): EnterpriseModel[]
export declare function parseModelsLenient(value: unknown): EnterpriseModel[]
export declare function unavailableUsage(): {
  source: 'unavailable'
  quota_state: 'unavailable'
  used: null
  limit: null
  remaining: null
  as_of: null
}
export declare function parseUsage(value: unknown): Record<string, unknown> & {
  source: 'live' | 'persisted' | 'unavailable'
  quota_state: 'available' | 'exhausted' | 'unavailable'
  used: number | null
  limit: number | null
  remaining: number | null
  as_of: string | null
}
export declare function parseUsageLenient(value: unknown): {
  source: 'live' | 'persisted' | 'unavailable'
  quota_state: 'available' | 'exhausted' | 'unavailable'
  used: number | null
  limit: number | null
  remaining: number | null
  as_of: string | null
  month?: string
  billing_timezone?: string
  period_start?: string
  reset_at?: string
}
export declare function accessNeedsRefresh(session: { access_expires_at: string }, now?: number): boolean
export declare function requestJson(base: string, path: string, options?: Record<string, unknown>): Promise<{
  body: unknown
  requestId?: string
}>
