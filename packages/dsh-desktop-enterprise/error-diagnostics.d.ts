export interface EnterpriseFailureContext {
  protocol?: string
  model?: string
  purpose?: string
  path?: string
  status?: number
  requestId?: string
}
export declare function serializeEnterpriseFailure(stage: string, error: unknown, context?: EnterpriseFailureContext): string
export declare function logEnterpriseFailure(logger: { debug?: (format: string, ...args: unknown[]) => void } | ((name: string) => { debug?: (format: string, ...args: unknown[]) => void }) | undefined, stage: string, error: unknown, context?: EnterpriseFailureContext): void
