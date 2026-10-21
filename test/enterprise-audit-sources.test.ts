import { expect, it } from 'vitest'
import { normalizeAuditContext } from '../packages/dsh-desktop-enterprise/contract.js'

const fields = ['conversation_id', 'request_kind', 'session_origin', 'parent_conversation_id', 'message_sources'] as const

it('preserves child compaction and bounded sources without copying source payloads', () => {
  expect(normalizeAuditContext({
    conversation_id: 'child', request_kind: 'compaction', session_origin: 'subagent', parent_conversation_id: 'parent',
    message_sources: { items: [{ message_index: 0, sources: [{ kind: 'skill-catalog', form: 'catalog', entries: ['private'] }] }], truncated: false }
  }, fields, 1)).toEqual({
    conversation_id: 'child', request_kind: 'compaction', session_origin: 'subagent', parent_conversation_id: 'parent',
    message_sources: { items: [{ message_index: 0, sources: [{ kind: 'skill-catalog', form: 'catalog' }] }], truncated: false }
  })
})

it('isolates source budget and does not infer subagent from a parent ID', () => {
  expect(normalizeAuditContext({ conversation_id: 'ok', parent_conversation_id: 'parent', message_sources: 'x'.repeat(20000) }, fields, 1))
    .toEqual({ conversation_id: 'ok' })
  expect(normalizeAuditContext({ conversation_id: 'ok', unknown: 'x'.repeat(100000) }, fields)).toEqual({ conversation_id: 'ok' })
})

it('drops all scanned duplicate indices and refuses boolean or out-of-range positions', () => {
  const items = [0, 0, 1, true, -1, 99].map(message_index => ({ message_index, sources: [{ kind: 'user' }] }))
  expect(normalizeAuditContext({ message_sources: { items, truncated: false } }, fields, 2))
    .toEqual({ message_sources: { items: [{ message_index: 1, sources: [{ kind: 'user' }] }], truncated: true } })
})

it('rejects trailing line terminators in producer identifiers', () => {
  for (const ending of ['\n', '\r', '\u2028', '\u2029']) {
    expect(normalizeAuditContext({ conversation_id: 'ok', message_sources: {
      items: [{ message_index: 0, sources: [{ kind: 'user' + ending }] }], truncated: false
    } }, fields, 1)).toEqual({ conversation_id: 'ok' })
  }
})
