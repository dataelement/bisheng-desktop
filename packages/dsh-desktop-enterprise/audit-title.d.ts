export interface AuditTitleUpdate { conversation_id: string; title: string; title_event_seq: number }
export declare function parseAuditTitleUpdate(value: unknown): AuditTitleUpdate
