import { describe, expect, it } from 'vitest'
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { EnterpriseLlmAdapter, parseSseEvents } from '../packages/dsh-desktop-enterprise/openai.js'
import { parseEnterpriseResponsesPayload } from '../src/main/enterprise/enterprise-responses.ts'

const key = '1234567890abcdef'
const model = { id: 'bisheng:42', display_name: 'Native', capabilities: { streaming: true, tools: true, responses: true }, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }
const message = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }
const reasoning = { id: 'rs_test', type: 'reasoning', summary: [], encrypted_content: 'opaque-encrypted-content' }
const call = { id: 'fc_test', type: 'function_call', call_id: 'call_test', name: 'lookup', arguments: '{}' }
const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 8 } }

function response(output = [message], knownUsage = true) {
  const final = { id: 'resp_test', object: 'response', status: 'completed', model: model.id, output, usage: knownUsage ? usage : null }
  const events = [{ type: 'response.created', response: { ...final, status: 'in_progress', output: [], usage: null } }]
  for (const [output_index, item] of output.entries()) {
    if (item.type === 'reasoning') continue // encrypted reasoning exists only in the terminal response
    events.push({ type: 'response.output_item.added', output_index, item: { ...item, ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } })
    events.push({ type: 'response.output_item.done', output_index, item })
  }
  events.push({ type: 'response.completed', response: final })
  return new Response(events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

function fixture(reply = () => response()) {
  const sent = []
  let connectionKey = key
  const adapter = new EnterpriseLlmAdapter({
    models: () => [model], connectionKey: () => connectionKey,
    request: () => { throw new Error('Chat must not run') },
    requestResponses: async (request, _signal, attribution, connectionKey) => {
      sent.push(parseEnterpriseResponsesPayload({ request, attribution, connectionKey }))
      return reply()
    }
  })
  return { adapter, sent, switchAccount: () => { connectionKey = 'fedcba0987654321' } }
}

const options = (messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] })]) => ({ provider: 'enterprise', model: model.id, sessionId: 'conv-1', messages })
async function collect(adapter, input) {
  const chunks = []
  for await (const chunk of adapter.stream(input)) chunks.push(chunk)
  return chunks
}

describe('native enterprise Responses', () => {
  it('keeps CRLF boundaries and UTF-8 intact when every byte is a separate chunk', async () => {
    const bytes = new TextEncoder().encode('event: response.output_text.delta\r\ndata: {"text":"思考"}\r\n\r\n')
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } })
    const events = []
    for await (const event of parseSseEvents(body, undefined, { event: 1024, total: 1024 })) events.push(event)
    expect(events).toEqual([{ event: 'response.output_text.delta', data: '{"text":"思考"}' }])
  })
  it('uses real pi-ai conversion and the controlled broker payload', async () => {
    const { adapter, sent } = fixture()
    const chunks = await collect(adapter, options())
    expect(sent[0].request).toMatchObject({ store: false, reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content'] })
    expect(sent[0].attribution).toMatchObject({ 'x-dsh-conversation-id': 'conv-1', 'x-dsh-request-purpose': 'chat' })
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 2, totalTokens: 12, cacheReadTokens: 8 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('carries negotiated session metadata in the Responses body and sanitizes it at the broker boundary', async () => {
    const sent = []
    const fields = ['conversation_id', 'request_kind', 'session_origin', 'parent_conversation_id']
    const adapter = new EnterpriseLlmAdapter({
      models: () => [model], connectionKey: () => key, auditFields: () => fields,
      resolveAuditSession: () => ({ session_origin: 'subagent', parent_conversation_id: 'parent-session' }),
      requestResponses: async (request, _signal, attribution, connectionKey) => {
        sent.push(parseEnterpriseResponsesPayload({ request, attribution, connectionKey }, fields))
        return response()
      }
    })
    await collect(adapter, { ...options(), purpose: 'compaction' })
    expect(sent[0].request.audit_context).toEqual({
      conversation_id: 'conv-1', request_kind: 'compaction', session_origin: 'subagent', parent_conversation_id: 'parent-session'
    })
    expect(JSON.stringify(sent[0].request.input)).not.toContain('audit_context')
    const raw = { ...sent[0], request: { ...sent[0].request, audit_context: { ...sent[0].request.audit_context, user_id: 99, title: 'untrusted' } } }
    delete raw.protocol
    delete raw.model
    expect(parseEnterpriseResponsesPayload(raw, ['conversation_id']).request.audit_context).toEqual({ conversation_id: 'conv-1' })
    expect(parseEnterpriseResponsesPayload(raw).request).not.toHaveProperty('audit_context')
  })

  it('omits body metadata for an older platform and ignores an unsupported request purpose', async () => {
    const { adapter, sent } = fixture()
    await collect(adapter, options())
    expect(sent[0].request).not.toHaveProperty('audit_context')
    const requests = []
    const supported = new EnterpriseLlmAdapter({
      models: () => [model], connectionKey: () => key, auditFields: () => ['conversation_id', 'request_kind'],
      requestResponses: async request => { requests.push(request); return response() }
    })
    await collect(supported, { ...options(), purpose: 'future-purpose' })
    expect(requests[0].audit_context).toEqual({ conversation_id: 'conv-1' })
  })

  it('persists full terminal-only encrypted reasoning and replays after JSON roundtrip', async () => {
    const { adapter, sent } = fixture(() => response([reasoning, message]))
    const first = await collect(adapter, options())
    const content = first.filter((chunk) => chunk.type === 'block-end').map((chunk) => chunk.block)
    expect(JSON.stringify(content)).not.toContain('opaque-encrypted-content')
    const assembler = new BlockAssembler()
    first.forEach((chunk) => assembler.push(chunk))
    const assistant = JSON.parse(JSON.stringify(assembler.message({ provider: 'enterprise', model: model.id, replayState: assembler.replayState })))
    await collect(adapter, options([options().messages[0], assistant, ...options().messages]))
    expect(sent[1].request.input).toContainEqual(reasoning)
    expect(sent[1].request.input).toContainEqual(message)
  })

  it('preserves tool IDs and typed tool results across turns', async () => {
    const { adapter, sent } = fixture(() => response([reasoning, call]))
    const input = { ...options(), tools: [{ name: 'lookup', parameters: { type: 'object', properties: {} } }] }
    const first = await collect(adapter, input)
    expect(first.at(-1).reason).toEqual({ kind: 'tool-calls' })
    const content = first.filter((chunk) => chunk.type === 'block-end').map((chunk) => chunk.block)
    const assistant = createAssistantMessage({ source: { kind: 'model', provider: 'enterprise', model: model.id, replayState: first.at(-1).replayState }, content })
    await collect(adapter, { ...input, messages: [assistant, { role: 'tool', toolCallId: content[0].id, content: [{ type: 'text', text: 'done' }] }] })
    expect(sent[1].request.input).toContainEqual(call)
    expect(sent[1].request.input).toContainEqual({ type: 'function_call_output', call_id: 'call_test', output: [{ type: 'input_text', text: 'done' }] })
  })

  it('does not replay encryption after switching accounts or editing visible content', async () => {
    const { adapter, sent, switchAccount } = fixture(() => response([reasoning, message]))
    const first = await collect(adapter, options())
    const content = first.filter((chunk) => chunk.type === 'block-end').map((chunk) => chunk.block)
    const assistant = createAssistantMessage({ source: { kind: 'model', provider: 'enterprise', model: model.id, replayState: first.at(-1).replayState }, content })
    switchAccount()
    await collect(adapter, options([assistant, ...options().messages]))
    expect(JSON.stringify(sent[1].request)).not.toContain('opaque-encrypted-content')
    await collect(adapter, options([{ ...assistant, content: [{ type: 'text', text: 'changed' }] }, ...options().messages]))
    expect(JSON.stringify(sent[2].request)).not.toContain('opaque-encrypted-content')
  })

  it('does not fabricate zero usage when the server has unknown usage', async () => {
    const { adapter } = fixture(() => response([message], false))
    expect((await collect(adapter, options())).some((chunk) => chunk.type === 'usage')).toBe(false)
  })

  it('rejects abrupt EOF and does not silently switch to Chat', async () => {
    const { adapter } = fixture(() => new Response('event: response.created\ndata: {"type":"response.created","sequence_number":0,"response":{"id":"resp_test","output":[]}}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    await expect(collect(adapter, options())).rejects.toBeDefined()
  })

  it.each(['previous_response_id', 'base_url', 'extra_headers', 'conversation'])('broker rejects forbidden %s', (field) => {
    expect(() => parseEnterpriseResponsesPayload({ request: { model: model.id, input: [{ type: 'message', role: 'user', content: 'hi' }], stream: true, store: false, include: ['reasoning.encrypted_content'], [field]: 'untrusted' }, connectionKey: key })).toThrow('Invalid enterprise Responses')
  })
})
