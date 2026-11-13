export interface AuditFeedbackUpdate {
  conversation_id: string
  message_id: string
  event_seq: number
  op: 'put' | 'delete'
  rating?: 'positive' | 'negative'
  category?: string
  note?: string
}
export declare function parseAuditFeedbackUpdate(value: unknown): AuditFeedbackUpdate
export declare function createAuditFeedbackSync(options: {
  ctx: {
    on?: (name: string, listener: (...args: unknown[]) => void, options?: { global?: boolean }) => (() => void) | void
    get?: (name: string) => { get?: (id: string) => { header?: { id?: string }, snapshotEvents?: () => unknown[] } | undefined } | undefined
  }
  send: (body: unknown, signal: AbortSignal) => Promise<{ status?: string, event_seq?: number }>
  note?: (reason: string, details?: Record<string, unknown>) => void
  reread?: () => Promise<unknown> | unknown
}): {
  ingest(state: unknown): void
  track(id: string): void
  dispose(): void
}
