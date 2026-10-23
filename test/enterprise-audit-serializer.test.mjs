import { expect, it } from 'vitest'
import { EnterpriseLlmAdapter, serializeEnterpriseRequest } from '../packages/dsh-desktop-enterprise/openai.js'

it('maps inserted system and split tool-result messages to final indices', () => {
  const annotations = []
  const request = serializeEnterpriseRequest({ model: 'bisheng:1', system: 'system', messages: [
    { role: 'user', source: { kind: 'runtime-context', form: 'snapshot' }, content: [
      { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'tool text' }] },
      { type: 'text', text: 'remaining text' }
    ] }
  ] }, { capabilities: { vision: false, tools: true } }, new Map(), (index, sources) => annotations.push({ index, sources }))
  expect(request.messages.map(message => message.role)).toEqual(['system', 'tool', 'user'])
  expect(annotations).toEqual([
    { index: 0, sources: [] },
    { index: 1, sources: [{ kind: 'runtime-context', form: 'snapshot' }] },
    { index: 2, sources: [{ kind: 'runtime-context', form: 'snapshot' }] }
  ])
  expect(request.messages.every(message => !('source' in message))).toBe(true)
})

it('retains both producers when consecutive tool images are merged into one wire message', () => {
  const ref = id => ({ attachmentId: id, mediaType: 'image/png', width: 100, height: 100, bytes: 4, name: 'synthetic.png' })
  const image = { url: 'data:image/png;base64,cG5n', mediaType: 'image/png', width: 100, height: 100 }
  const first = { kind: 'tool' }, second = { kind: 'runtime-context', form: 'snapshot' }
  const mapped = []
  const request = serializeEnterpriseRequest({ model: 'bisheng:1', messages: [
    { role: 'tool', toolCallId: 'call-1', source: first, content: [{ type: 'image', attachment: ref('sha256:aaaa') }] },
    { role: 'tool', toolCallId: 'call-2', source: second, content: [{ type: 'image', attachment: ref('sha256:bbbb') }] }
  ] }, { capabilities: { vision: true, tools: true } }, new Map([['sha256:aaaa', image], ['sha256:bbbb', image]]),
  (index, sources) => mapped.push({ index, sources }))
  expect(request.messages.map(message => message.role)).toEqual(['tool', 'tool', 'user'])
  expect(mapped[2]).toEqual({ index: 2, sources: [first, second] })
})

it.each([
  ['main', undefined, 'chat'], ['main', 'compaction', 'compaction'],
  ['subagent', undefined, 'chat'], ['subagent', 'compaction', 'compaction'],
  ['subagent', 'session-title', 'session-title']
])('keeps session origin %s independent from purpose %s', async (origin, purpose, kind) => {
  const sent = []
  const model = { id: 'bisheng:1', capabilities: { tools: true, vision: false } }
  const adapter = new EnterpriseLlmAdapter({
    models: () => [model], auditFields: () => ['conversation_id', 'request_kind', 'session_origin', 'parent_conversation_id', 'message_sources'],
    resolveAuditSession: () => ({ session_origin: origin, parent_conversation_id: origin === 'subagent' ? 'parent' : undefined }),
    request: async request => {
      sent.push(request)
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }
  })
  for await (const event of adapter.stream({ model: model.id, sessionId: 'current', purpose,
    system: 'system', messages: [{ role: 'user', source: { kind: 'skill-catalog', form: 'catalog', entries: ['private'] }, content: [{ type: 'text', text: 'catalog' }] }]
  })) void event
  expect(sent).toHaveLength(1)
  expect(sent[0].audit_context).toEqual({
    conversation_id: 'current', request_kind: kind, session_origin: origin,
    ...(origin === 'subagent' ? { parent_conversation_id: 'parent' } : {}),
    message_sources: { items: [{ message_index: 1, sources: [{ kind: 'skill-catalog', form: 'catalog' }] }], truncated: false }
  })
  expect(sent[0].messages).toEqual([{ role: 'system', content: 'system' }, { role: 'user', content: 'catalog' }])
})
