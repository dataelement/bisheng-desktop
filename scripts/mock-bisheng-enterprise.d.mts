export interface MockEnterpriseServer {
  state: Record<string, unknown>
  listen(): Promise<string>
  close(): Promise<void>
}
export declare function createMockEnterpriseServer(options?: {
  host?: string
  port?: number
  contractVersion?: '0.4.0' | '0.5.0'
  auditContext?: unknown
}): MockEnterpriseServer
