export interface EnterpriseAuthState {
  connected: boolean
  enterpriseId?: string
  userId?: string
  /** Host session generation; never a bearer credential. */
  sessionVersion: string
}
export interface EnterpriseAuthRequestInit {
  method?: string
  headers?: HeadersInit
  body?: string | ArrayBuffer | ArrayBufferView
  signal?: AbortSignal
}
export interface EnterpriseAppClient {
  readonly appId: string
  /** Host exchanges app-scoped credentials and proxies to the administrator-registered application. */
  request(path: string, init?: EnterpriseAuthRequestInit): Promise<Response>
}
export interface EnterpriseAuth {
  /** No URLs, tokens, plugin IDs or user identities are supplied by the caller. */
  app(appId: string): EnterpriseAppClient
  /** Cached public state; use refresh() when a fresh snapshot is needed. */
  getState(): EnterpriseAuthState
  /** Read the existing host session without opening a login page. */
  refresh(): Promise<EnterpriseAuthState>
  /** Changes only; call getState() for the initial snapshot. */
  subscribe(listener: (state: EnterpriseAuthState) => void): () => void
  /** No automatic replay of business requests, including HTTP 401. */
  request(path: string, init?: EnterpriseAuthRequestInit): Promise<Response>
}
export type EnterpriseAuthErrorCode = 'app_unavailable' | 'authorization_denied' | 'invalid_request' | 'session_changed' | 'not_connected' | 'too_many_requests' | 'request_aborted' | 'request_timeout' | 'request_failed' | 'response_too_large' | 'request_too_large' | 'redirect_rejected'
export declare class EnterpriseAuthError extends Error {
  readonly errorCode: EnterpriseAuthErrorCode
  readonly status: number
  constructor(errorCode: EnterpriseAuthErrorCode, message: string, status?: number)
}
export interface EnterpriseAuthTransport {
  state(signal?: AbortSignal): Promise<EnterpriseAuthState>
  /** Optional capability: missing support fails closed, never falls back to an enterprise-origin request. */
  requestApp?(appId: string, path: string, init?: EnterpriseAuthRequestInit & { sessionVersion?: string }): Promise<Response>
  /** Trusted host validates sessionVersion and cancels requests/streams when it is invalidated. */
  request(path: string, init?: EnterpriseAuthRequestInit & { sessionVersion?: string }): Promise<Response>
}
export interface EnterpriseAuthClient extends EnterpriseAuth {
  /** Local cleanup; the owning host must also revoke the plugin grant. */
  dispose(): void
}
export interface EnterpriseAuthClientOptions {
  /** Default 1000; 0 disables polling for hosts that refresh on their own events. */
  pollIntervalMs?: number
  onRequestSettled?: (error?: unknown) => void
}
export declare function createEnterpriseAuthClient(transport: EnterpriseAuthTransport, options?: EnterpriseAuthClientOptions): Promise<EnterpriseAuthClient>
export declare function enterpriseAuthState(value: unknown): EnterpriseAuthState
