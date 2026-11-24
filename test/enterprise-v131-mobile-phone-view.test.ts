import { describe, expect, it } from 'vitest'
import { boundedMobileResponse, chunkFramePieces, MAX_CHUNK_FRAME_BYTES, MAX_MOBILE_FRAME_BYTES } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-access-client'
import { projectLiveAssistantFrame, projectMobileOfficeCatalog, projectTranscriptFrame, projectTranscriptHistory } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-phone-view'

describe('phone transcript projection', () => {
  it('keeps the fields the phone parser uses and drops tool output', () => {
    const full = {
      events: [
        { type: 'turn/start', time: 10, data: { turn: 1 } },
        {
          type: 'user/message',
          time: 10,
          data: {
            source: { kind: 'user' },
            content: [{ type: 'text', text: '你好' }]
          }
        },
        {
          type: 'user/message',
          data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'hidden' }] }
        },
        {
          type: 'assistant/chunk',
          data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'think' } }
        },
        {
          type: 'assistant/chunk',
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '回' } }
        },
        {
          type: 'assistant/message',
          time: 20,
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [
                { type: 'reasoning', text: 'think' },
                { type: 'text', text: '回复' }
              ]
            },
            usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4, cacheReadTokens: 0, secret: true },
            toolResult: 'x'.repeat(1000)
          }
        },
        { type: 'turn/end', time: 21, data: { turn: 1, reason: { kind: 'completed' }, extra: true } },
        { type: 'tool/result', data: { output: 'y'.repeat(1000) } }
      ],
      projections: { turnOutline: 'secret' },
      hasMore: false
    }
    expect(projectTranscriptHistory(full)).toEqual({
      events: [
        { type: 'turn/start', time: 10 },
        {
          type: 'user/message',
          time: 10,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] }
        },
        {
          type: 'assistant/chunk',
          data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'think' } }
        },
        {
          type: 'assistant/chunk',
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '回' } }
        },
        {
          type: 'assistant/message',
          time: 20,
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [
                { type: 'reasoning', text: 'think' },
                { type: 'text', text: '回复' }
              ]
            },
            usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4, cacheReadTokens: 0 }
          }
        },
        { type: 'turn/end', time: 21, data: { reason: { kind: 'completed' } } }
      ],
      hasMore: false
    })
  })

  it('keeps reasoning on the latest turns and drops it from earlier ones', () => {
    const turn = (index: number, thinking: string) => [
      { type: 'turn/start', time: index },
      {
        type: 'assistant/chunk',
        data: { turn: index, step: 1, chunk: { type: 'reasoning-delta', text: thinking, index: 0 } }
      },
      {
        type: 'assistant/message',
        time: index + 1,
        data: {
          turn: index,
          step: 1,
          message: {
            content: [
              { type: 'reasoning', text: thinking },
              { type: 'text', text: `答案${index}` }
            ]
          }
        }
      },
      { type: 'turn/end', time: index + 2, data: { reason: { kind: 'completed' } } }
    ]
    const events = [1, 2, 3, 4].flatMap((index) => turn(index, `思考${index}`))
    const projected = projectTranscriptHistory({ events, hasMore: false }) as {
      events: Array<{
        data?: {
          message?: { content?: Array<{ type: string; text: string }> }
          chunk?: { type: string; text?: string }
        }
      }>
    }
    const thinking = projected.events.flatMap((event) => {
      const chunk = event.data?.chunk
      if (chunk?.type === 'reasoning-delta') return [`chunk:${chunk.text}`]
      const blocks = event.data?.message?.content ?? []
      return blocks.filter((block) => block.type === 'reasoning').map((block) => `message:${block.text}`)
    })
    expect(thinking).toEqual([
      'chunk:思考2',
      'message:思考2',
      'chunk:思考3',
      'message:思考3',
      'chunk:思考4',
      'message:思考4'
    ])
    const answers = projected.events.flatMap((event) => {
      const blocks = event.data?.message?.content ?? []
      return blocks.filter((block) => block.type === 'text').map((block) => block.text)
    })
    expect(answers).toEqual(['答案1', '答案2', '答案3', '答案4'])
  })

  it('replays the in-progress assistant stream on a snapshot and forwards later deltas', () => {
    expect(projectTranscriptFrame({
      type: 'snapshot',
      records: [{ type: 'turn/start', time: 1 }],
      hasMore: false,
      assistantStream: {
        activeAttempt: {
          turn: 2,
          step: 1,
          stream: [
            { type: 'reasoning-chunks', index: 0, texts: ['先', '想'] },
            { type: 'text-chunks', index: 0, texts: ['正', '文'] },
            { type: 'tool-call-chunks', index: 1, args: ['{}'] }
          ]
        }
      }
    })).toEqual({
      type: 'snapshot',
      hasMore: false,
      records: [
        { type: 'turn/start', time: 1 },
        {
          type: 'assistant/chunk',
          data: { turn: 2, step: 1, chunk: { type: 'reasoning-delta', text: '先想', index: 0 } }
        },
        {
          type: 'assistant/chunk',
          data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: '正文', index: 0 } }
        }
      ]
    })
    const turn: { turn?: number; step?: number } = {}
    expect(projectLiveAssistantFrame({ type: 'start', turn: 2, step: 1 }, turn)).toBeUndefined()
    expect(projectLiveAssistantFrame({
      type: 'chunk',
      time: 5,
      chunk: { type: 'reasoning-delta', index: 0, text: '下一步' }
    }, turn)).toEqual({
      type: 'event',
      event: {
        type: 'assistant/chunk',
        time: 5,
        data: { turn: 2, step: 1, chunk: { type: 'reasoning-delta', text: '下一步', index: 0 } }
      }
    })
    expect(projectLiveAssistantFrame({
      type: 'chunk',
      chunk: { type: 'tool-call-delta', index: 1, argumentsDelta: '{}' }
    }, turn)).toBeUndefined()
  })

  it('drops a snapshot header and a follow event the phone does not render', () => {
    expect(projectTranscriptFrame({
      type: 'snapshot',
      header: { title: 'secret' },
      projections: { turnOutline: 'secret' },
      assistantStream: { text: 'partial' },
      records: [{ event: { type: 'tool/result', data: { output: 'big' } } }],
      hasMore: false
    })).toEqual({ type: 'snapshot', records: [], hasMore: false })
    expect(projectTranscriptFrame({
      type: 'event',
      event: { type: 'tool/result', data: { output: 'big' } }
    })).toBeUndefined()
  })
})

describe('mobile response frame cap', () => {
  it('rejects a frame whose UTF-8 size reaches the gateway margin', () => {
    const chinese = '中'.repeat(300_000)
    expect(chinese.length).toBeLessThan(MAX_MOBILE_FRAME_BYTES)
    const bounded = boundedMobileResponse({
      type: 'response',
      id: 'req-1',
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: chinese
    })
    expect(bounded.tooLarge).toBe(true)
    expect(bounded.bytes).toBeGreaterThanOrEqual(MAX_MOBILE_FRAME_BYTES)
    expect(bounded.frame).toEqual({
      type: 'response',
      id: 'req-1',
      status: 502,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"response_too_large"}'
    })
    expect(Buffer.byteLength(JSON.stringify(bounded.frame), 'utf8')).toBeLessThan(MAX_MOBILE_FRAME_BYTES)
  })

  it('cuts a long chinese chunk by serialized bytes and keeps an emoji intact', () => {
    const text = `${'中'.repeat(200_000)}😀`
    const pieces = chunkFramePieces('req-1', text)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(Buffer.byteLength(JSON.stringify(piece), 'utf8')).toBeLessThanOrEqual(MAX_CHUNK_FRAME_BYTES)
      const data = String(piece.data)
      const last = data.charCodeAt(data.length - 1)
      expect(last < 0xd800 || last > 0xdbff).toBe(true)
    }
    expect(pieces.map((piece) => piece.data).join('')).toBe(text)
  })
})

describe('phone office catalogue projection', () => {
  it('keeps the fields the template sheet renders', () => {
    expect(projectMobileOfficeCatalog({
      mode: null,
      templates: [{
        id: 'minutes',
        title: '会议纪要',
        revision: '9',
        mode: 'word',
        description: '不应下发',
        thumbnail: 'data:image/webp;base64,AAAA',
        pageAspectRatios: [1.4]
      }]
    })).toEqual({
      templates: [{ id: 'minutes', title: '会议纪要', revision: '9', mode: 'word' }]
    })
  })
})
