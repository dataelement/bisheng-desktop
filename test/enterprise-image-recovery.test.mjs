import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import { apply as mountImageOffload } from '@deepseek-ai/dsh-compaction-image-offload'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { parseEnterpriseChatPayload } from '../src/main/enterprise/enterprise-chat.ts'

const model = { id: 'bisheng:42', display_name: 'Vision', capabilities: { streaming: true, tools: true, vision: true, reasoning_content: false } }
const image = (id) => ({ type: 'image', attachment: { attachmentId: `sha256:${id}`, mediaType: 'image/jpeg', name: `${id}.jpg`, bytes: 3, width: 1, height: 1 } })
function jpeg(bytes) {
  const data = new Uint8Array(bytes)
  data.set([255, 216, 255])
  return { data, mediaType: 'image/jpeg' }
}
async function drain(adapter, messages, signal) {
  for await (const _ of adapter.stream({ provider: 'enterprise', model: model.id, messages, signal })) { /* consume real adapter */ }
}
function fixture(blocks, readImage) {
  const projections = []
  const listeners = new Map()
  mountImageOffload({ sessions: { registerMessageProjection: (projection) => projections.push(projection) }, on: (event, handler) => listeners.set(event, handler) })
  const session = Session.create('image-recovery-test', undefined, undefined, undefined, projections)
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: blocks }), { surfaceOp: 'append' })
  const sent = []
  const adapter = new EnterpriseLlmAdapter({ models: () => [model], readImage, request: async (request) => {
    sent.push(parseEnterpriseChatPayload({ request }).request)
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  return { session, adapter, sent, recover: (failure) => listeners.get('agent/request-error')({ agent: { session }, failure, signal: new AbortController().signal }, () => undefined) }
}

describe('enterprise real Session image recovery', () => {
  it('logs an offload event, rederives placeholders and retries without rereading the dropped image', async () => {
    const reads = []
    const large = jpeg(6 * 1024 * 1024)
    const f = fixture([image('large'), image('small')], async (ref) => { reads.push(ref.attachmentId); return ref.name === 'large.jpg' ? large : jpeg(3) })
    let failure
    try { await drain(f.adapter, f.session.deriveMessages()) } catch (error) { failure = error.failure }
    expect(failure).toMatchObject({ code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 1 })
    expect(f.sent).toHaveLength(0)
    expect(await f.recover(failure)).toEqual({ kind: 'retry' })
    expect(f.session.deriveMessages()[0].content[0].offloaded).toBe(true)
    await drain(f.adapter, f.session.deriveMessages())
    expect(reads.filter((id) => id === 'sha256:large')).toHaveLength(1)
    expect(f.sent[0].messages[0].content.filter((part) => part.type === 'image_url')).toHaveLength(1)
    expect(f.sent[0].messages[0].content[0].type).toBe('text')
  })

  it('budgets every duplicate occurrence but reads its attachment only once per attempt', async () => {
    let reads = 0
    const version = jpeg(4 * 1024 * 1024)
    const f = fixture(Array.from({ length: 6 }, () => image('same')), async () => { reads++; return version })
    let failure
    try { await drain(f.adapter, f.session.deriveMessages()) } catch (error) { failure = error.failure }
    expect(reads).toBe(1)
    expect(failure.offloadImages).toBe(2)
    await f.recover(failure)
    await drain(f.adapter, f.session.deriveMessages())
    expect(reads).toBe(2)
    expect(f.sent[0].messages[0].content.filter((part) => part.type === 'image_url')).toHaveLength(4)
  })

  it('extends the oldest prefix through an individually oversized last image', async () => {
    const f = fixture([image('small'), image('large')], async (ref) => jpeg(ref.name === 'large.jpg' ? 6 * 1024 * 1024 : 3))
    await expect(drain(f.adapter, f.session.deriveMessages())).rejects.toMatchObject({ failure: { code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 2 } })
  })

  it('cancels after a pending image read without starting a network request', async () => {
    const controller = new AbortController()
    const f = fixture([image('small')], async () => { controller.abort(); return jpeg(3) })
    await expect(drain(f.adapter, f.session.deriveMessages(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.sent).toHaveLength(0)
  })

  it('treats missing and invalid attachments as unrecoverable', async () => {
    for (const version of [undefined, { data: new Uint8Array([0]), mediaType: 'image/jpeg' }]) {
      const f = fixture([image('small')], async () => version)
      await expect(drain(f.adapter, f.session.deriveMessages())).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
      expect(f.sent).toHaveLength(0)
    }
  })
})
