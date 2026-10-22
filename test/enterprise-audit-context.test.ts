import { describe, expect, it } from 'vitest'
import { normalizeAuditContext, parseConfig } from '../packages/dsh-desktop-enterprise/contract.js'

const root = { enabled: true, client_id: 'dsh-desktop', contract_version: '0.5.0' }
const fields = ['conversation_id', 'request_kind'] as const

describe('optional model audit context', () => {
  it('negotiates only known fields without requiring a new contract version', () => {
    expect(parseConfig({ ...root, audit_context: { fields: [...fields, 'version', 'request_kind'] } }))
      .toMatchObject({ audit_context: { fields: [...fields] } })
    for (const audit_context of [null, [], {}, { fields: 'conversation_id' }, { fields: [123] }]) {
      expect(parseConfig({ ...root, audit_context })).toEqual(root)
    }
    expect(parseConfig(root)).toEqual(root)
    expect(() => parseConfig({ ...root, client_id: 'bad' })).toThrow()
  })

  it('preserves independent fields and never sends extra identity or source fields', () => {
    const raw = { conversation_id: ' 会话A ', request_kind: 'chat', user_id: 1, version: 1 }
    expect(normalizeAuditContext(raw, fields)).toEqual({ conversation_id: ' 会话A ', request_kind: 'chat' })
    expect(normalizeAuditContext(raw, ['request_kind'])).toEqual({ request_kind: 'chat' })
    expect(normalizeAuditContext(raw, [])).toBeUndefined()
    expect(normalizeAuditContext({ conversation_id: '', request_kind: 'compaction' }, fields))
      .toEqual({ request_kind: 'compaction' })
    expect(normalizeAuditContext({ conversation_id: 'abc', request_kind: 'unknown' }, fields))
      .toEqual({ conversation_id: 'abc' })
  })

  it('checks Unicode IDs and excludes unknown values from the independent budgets', () => {
    expect(normalizeAuditContext({ conversation_id: '😀'.repeat(256) }, fields)).toBeDefined()
    expect(normalizeAuditContext({ conversation_id: '😀'.repeat(257) }, fields)).toBeUndefined()
    const raw = { request_kind: 'chat', padding: '' }
    const overhead = Buffer.byteLength(JSON.stringify(raw))
    expect(normalizeAuditContext({ ...raw, padding: 'x'.repeat(4096 - overhead) }, fields))
      .toEqual({ request_kind: 'chat' })
    expect(normalizeAuditContext({ ...raw, padding: 'x'.repeat(4097 - overhead) }, fields)).toEqual({ request_kind: 'chat' })
    for (const value of [null, 1, [], 'bad']) expect(normalizeAuditContext(value, fields)).toBeUndefined()
  })
})
