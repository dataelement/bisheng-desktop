import { describe, expect, it } from 'vitest'
import { parseModels } from '../packages/dsh-desktop-enterprise/contract.js'
import { EnterpriseLlmAdapter, serializeEnterpriseRequest } from '../packages/dsh-desktop-enterprise/openai.js'
import { serializeResponsesRequest } from '../packages/dsh-desktop-enterprise/responses.js'

const entry = {
  id: 'bisheng:42', display_name: 'Duplicate upstream name', slug: ' upstream-model ',
  capabilities: { streaming: true, tools: true, reasoning_content: false },
  context_window: 500000, input_modalities: ['text', 'image'],
  supported_reasoning_levels: [{ effort: 'low', description: 'Low' }, { effort: 'high', description: 'High' }],
  default_reasoning_level: 'low'
}
const parse = (value) => parseModels({ object: 'list', data: [value] })
const options = { model: entry.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }

describe('enterprise sourced model metadata', () => {
  it('retains sourced fields and normalizes vision and reasoning without replacing route identity', async () => {
    const [model] = parse(entry)
    expect(model).toMatchObject({ id: entry.id, slug: 'upstream-model', context_window: 500000,
      capabilities: { vision: true, reasoning_content: false },
      reasoning: { efforts: [{ id: 'low', name: 'Low', description: 'Low' }, { id: 'high', name: 'High', description: 'High' }], defaultEffort: 'low' } })
    const adapter = new EnterpriseLlmAdapter({ providerName: () => 'BiSheng', models: () => [model] })
    expect(await adapter.listModels('enterprise')).toEqual([{
      provider: 'enterprise', id: entry.id, name: entry.display_name, reasoning: model.reasoning, inputModalities: ['text', 'image']
    }])
    expect(await adapter.resolveModel('enterprise', entry.id)).toMatchObject({
      id: entry.id, context: { contextWindow: 500000 }, inputModalities: ['text', 'image'], reasoning: model.reasoning
    })
    expect(() => adapter.resolveModel('enterprise', model.slug)).toThrow('no authorized model')
  })

  it.each([undefined, null, true, 0, -1, 1.5, '500000', Number.MAX_SAFE_INTEGER + 1])('does not invent context for %s', async (context_window) => {
    const [model] = parse({ ...entry, context_window })
    expect(model).not.toHaveProperty('context_window')
    const adapter = new EnterpriseLlmAdapter({ providerName: () => 'BiSheng', models: () => [model] })
    expect(await adapter.resolveModel('enterprise', entry.id)).not.toHaveProperty('context')
  })

  it('keeps absent metadata absent and reasoning text separate from effort', () => {
    const [model] = parse({ id: entry.id, capabilities: { ...entry.capabilities, reasoning_content: true } })
    for (const key of ['context_window', 'slug', 'input_modalities', 'reasoning', 'supported_reasoning_levels', 'default_reasoning_level']) expect(model).not.toHaveProperty(key)
    expect(serializeEnterpriseRequest(options, model)).not.toHaveProperty('reasoning_effort')
    expect(serializeResponsesRequest(options, model, new Map())).not.toHaveProperty('reasoning')
  })

  it.each([
    { capabilities: { ...entry.capabilities, vision: false } },
    { input_modalities: [] }, { input_modalities: ['text', 'audio'] }, { input_modalities: ['text', 'text'] },
    { supported_reasoning_levels: [] }, { supported_reasoning_levels: [{ effort: 'low', description: 'Low' }, { effort: 'low', description: 'Again' }] },
    { default_reasoning_level: 'unknown' },
    { reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
  ])('rejects conflicting or invalid authoritative metadata %j', (patch) => {
    expect(() => parse({ ...entry, ...patch })).toThrow('invalid model')
  })

  it('accepts matching legacy and OpenAI-style metadata', () => {
    const reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }
    const expected = { ...reasoning, efforts: reasoning.efforts.map((effort) => ({ ...effort, description: effort.name })) }
    expect(parse({ ...entry, reasoning, capabilities: { ...entry.capabilities, vision: true } })[0].reasoning).toEqual(expected)
    expect(parse({ ...entry, reasoning: { ...reasoning, efforts: [...reasoning.efforts].reverse() } })[0].reasoning).toEqual(expected)
  })

  it.each([false, true])('streams image input using disclosed modalities (Responses=%s)', async (responses) => {
    for (const vision of [false, true]) {
      const [model] = parse({ ...entry, capabilities: { ...entry.capabilities, responses }, input_modalities: vision ? ['text', 'image'] : ['text'] })
      let sent
      let reads = 0
      const adapter = new EnterpriseLlmAdapter({
        models: () => [model], connectionKey: () => '1234567890abcdef',
        readImage: async () => { reads += 1; return { data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mediaType: 'image/png', width: 1, height: 1 } },
        request: async (body) => { sent = body; return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) },
        requestResponses: async (body) => {
          sent = body
          const response = { id: 'resp_test', object: 'response', status: 'completed', model: entry.id, output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } }
          return new Response('event: response.completed\ndata: ' + JSON.stringify({ type: 'response.completed', sequence_number: 0, response }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
        }
      })
      const events = []
      for await (const event of adapter.stream({ ...options, reasoningEffort: 'high', messages: [{ role: 'user', content: [{ type: 'image', attachment: {
        attachmentId: 'sha256:aaaaaaaaaaaaaaaa', name: 'image.png', mediaType: 'image/png', width: 1, height: 1
      } }] }] })) events.push(event)
      expect(events.at(-1)?.reason?.kind).not.toBe('error')
      expect(sent.model).toBe(entry.id)
      expect(reads).toBe(vision ? 1 : 0)
      expect(JSON.stringify(sent)).toContain(responses ? '"effort":"high"' : '"reasoning_effort":"high"')
      expect(JSON.stringify(sent).includes('data:image/png;base64,')).toBe(vision)
      expect(sent).not.toHaveProperty('max_output_tokens')
      expect(sent).not.toHaveProperty('max_tokens')
    }
  })

  it.each([undefined, 'high'])('serializes default or selected effort %s in both request protocols', (reasoningEffort) => {
    const [model] = parse(entry)
    const request = { ...options, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
    expect(serializeEnterpriseRequest(request, model)).toMatchObject({ model: entry.id, reasoning_effort: reasoningEffort ?? 'low' })
    expect(serializeResponsesRequest(request, model, new Map())).toMatchObject({ model: entry.id, reasoning: { effort: reasoningEffort ?? 'low' } })
    expect(() => serializeEnterpriseRequest({ ...options, reasoningEffort: 'unknown' }, model)).toThrow('does not support reasoning effort')
    expect(() => serializeResponsesRequest({ ...options, reasoningEffort: 'unknown' }, model, new Map())).toThrow('does not support reasoning effort')
  })
})
