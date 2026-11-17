import { describe, expect, it } from 'vitest'
import { boundedMobileResponse, chunkFramePieces, MAX_CHUNK_FRAME_BYTES, MAX_MOBILE_FRAME_BYTES } from '../src/main/mobile/mobile-access-client'
import { projectTranscriptFrame, projectTranscriptHistory } from '../src/main/mobile/mobile-phone-view'

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
          data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '回' } }
        },
        {
          type: 'assistant/message',
          time: 20,
          data: {
            turn: 1,
            step: 1,
            message: { content: [{ type: 'text', text: '回复' }] },
            usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4, cacheReadTokens: 0 }
          }
        },
        { type: 'turn/end', time: 21, data: { reason: { kind: 'completed' } } }
      ],
      hasMore: false
    })
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
