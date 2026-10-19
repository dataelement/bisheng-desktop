import type { EnterpriseAuthRequestInit, EnterpriseAuthState } from './enterprise-auth.js'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface EnterpriseToolOptions {
  signal?: AbortSignal
  /** Positive safe integer; default 60000. Covers headers and body consumption. */
  timeoutMs?: number
  /** Positive safe integer; default 65536, measured over serialized { arguments }. */
  maxInputBytes?: number
  /** Positive safe integer; default 4194304. */
  maxResponseBytes?: number
}
export type EnterpriseToolErrorCode = 'invalid_request' | 'invalid_response' | 'not_connected' | 'authorization_denied' | 'session_changed' | 'request_aborted' | 'request_timeout' | 'request_failed' | 'tool_not_found'
export interface EnterpriseToolDiagnostics {
  status?: number
  backendCode?: string
  requestId?: string
}
export declare class EnterpriseToolError extends Error {
  readonly errorCode: EnterpriseToolErrorCode
  readonly status?: number
  readonly backendCode?: string
  readonly requestId?: string
  /** Diagnostics are whitelisted; arbitrary backend messages are never retained. */
  constructor(errorCode: EnterpriseToolErrorCode, details?: EnterpriseToolDiagnostics)
}
/** Service implementors must supply callbacks retaining the invoking Cordis receiver. */
export declare function invokeEnterpriseTool(channel: {
  getState(): EnterpriseAuthState
  request(path: string, init: EnterpriseAuthRequestInit): Promise<Response>
}, toolName: string, arguments: JsonValue, options?: EnterpriseToolOptions): Promise<JsonValue>
