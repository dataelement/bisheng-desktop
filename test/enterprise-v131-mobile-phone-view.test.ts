import { describe, expect, it } from 'vitest'
import { boundedMobileResponse, chunkFramePieces, MAX_CHUNK_FRAME_BYTES, MAX_MOBILE_FRAME_BYTES } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-access-client'
import { projectChangesSummary, projectLiveAssistantFrame, projectMobileOfficeCatalog, projectTranscriptFrame, projectTranscriptHistory } from '../packages/dsh-desktop-enterprise/desktop/mobile/mobile-phone-view'

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
        { type: 'context/status', data: { kind: 'runtime-context' } },
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

  it('projects context rows and tool-list counts without their bodies', () => {
    const projected = projectTranscriptHistory({
      events: [
        {
          type: 'user/message',
          data: {
            source: { kind: 'skill-catalog' },
            content: [{ type: 'text', text: 'secret catalog' }]
          }
        },
        {
          type: 'developer/message',
          data: {
            turn: 1,
            message: {
              content: [
                { type: 'tool-addition', toolName: 'office_render' },
                { type: 'tool-addition', toolName: 'office_convert' },
                { type: 'tool-removal', toolName: 'old_tool' }
              ]
            }
          }
        },
        {
          type: 'developer/message',
          data: { message: { content: [{ type: 'text', text: 'secret note' }] } }
        }
      ],
      hasMore: false
    })
    expect(projected).toEqual({
      events: [
        { type: 'context/status', data: { kind: 'skill-catalog' } },
        { type: 'context/status', data: { kind: 'tools', added: 2, removed: 1, turn: 1 } }
      ],
      hasMore: false
    })
    const encoded = JSON.stringify(projected)
    expect(encoded).not.toContain('secret')
    expect(encoded).not.toContain('office_render')
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

  it('projects a compact tool row, presented files, and a change coordinate', () => {
    const history = projectTranscriptHistory({
      events: [
        {
          type: 'tool/call',
          data: {
            turn: 4,
            step: 2,
            callId: 'call-1',
            name: 'read',
            arguments: JSON.stringify({ path: 'notes/a.md', secret: 'do-not-copy' })
          }
        },
        {
          type: 'tool/result',
          data: {
            turn: 4,
            step: 2,
            message: { source: { kind: 'tool', callId: 'call-1' }, content: 'file body' },
            meta: { diff: 'secret' }
          }
        },
        {
          type: 'deliverables/presented',
          seq: 8,
          data: {
            turn: 4,
            callId: 'call-2',
            files: [{ path: 'out/纪要.docx', description: '会议纪要' }, { description: '缺路径' }, 'bad']
          }
        },
        { type: 'workspace/changes', seq: 9, data: { turn: 4, diff: 'secret' } },
        { type: 'workspace/changes', data: { turn: 4 } }
      ]
    }) as { events: Array<Record<string, unknown>> }
    expect(history.events).toEqual([
      {
        type: 'tool/status',
        data: {
          phase: 'calling',
          activity: 'read',
          name: 'read',
          callId: 'call-1',
          detail: 'notes/a.md',
          turn: 4,
          step: 2
        }
      },
      { type: 'tool/status', data: { phase: 'done', callId: 'call-1', turn: 4, step: 2 } },
      {
        type: 'deliverables/presented',
        seq: 8,
        data: {
          files: [{ path: 'out/纪要.docx', description: '会议纪要' }],
          turn: 4,
          callId: 'call-2'
        }
      },
      { type: 'workspace/changes', seq: 9, data: { turn: 4 } }
    ])
    expect(JSON.stringify(history)).not.toContain('do-not-copy')
    expect(JSON.stringify(history)).not.toContain('file body')
    const cursor: { turn?: number; step?: number } = { turn: 4, step: 2 }
    const first = projectLiveAssistantFrame({
      type: 'chunk',
      chunk: { type: 'tool-call-delta', index: 0, id: 'call-3', name: 'read', argumentsDelta: '{"path":"notes' }
    }, cursor)
    const second = projectLiveAssistantFrame({
      type: 'chunk',
      chunk: { type: 'tool-call-delta', index: 0, id: 'call-3', name: 'read', argumentsDelta: '/b.md"}' }
    }, cursor)
    expect(first).toMatchObject({ event: { type: 'tool/status', data: { phase: 'preparing', detail: 'notes' } } })
    expect(second).toMatchObject({ event: { data: { detail: 'notes/b.md', callId: 'call-3' } } })
    expect(projectLiveAssistantFrame({
      type: 'chunk',
      chunk: { type: 'tool-call-delta', index: 0, id: 'call-3', argumentsDelta: '' }
    }, cursor)).toBeUndefined()
    expect(projectChangesSummary({
      turn: 4,
      total: 1,
      files: [{ path: 'out/纪要.docx', display: '纪要.docx', added: 12, deleted: 3, hunks: ['secret'] }, { added: 1 }]
    })).toEqual({
      files: [{ path: 'out/纪要.docx', display: '纪要.docx', added: 12, deleted: 3 }],
      turn: 4,
      total: 1
    })
    expect(projectChangesSummary('bad')).toBeUndefined()
  })

  it('keeps a skill name and question answers, and drops the rest of the tool body', () => {
    const history = projectTranscriptHistory({
      events: [
        {
          type: 'tool/call',
          data: {
            turn: 4,
            callId: 'skill-1',
            name: 'skill',
            arguments: { name: 'bisheng-docx', instructions: 'secret instructions' }
          }
        },
        {
          type: 'tool/call',
          data: {
            turn: 4,
            callId: 'ask-1',
            name: 'ask_user_question',
            arguments: {
              timeout: 120,
              note: 'secret note',
              questions: [
                { id: 'city', question: '哪个城市？', header: '城市', options: [{ label: '北京', description: 'secret option' }] },
                { id: 'range', question: '哪个范围？' }
              ]
            }
          }
        },
        {
          type: 'tool/result',
          data: {
            turn: 4,
            message: {
              source: { kind: 'tool', callId: 'ask-1' },
              content: JSON.stringify({
                answers: [
                  { id: 'city', selected: ['北京'], note: 'secret result' },
                  { id: 'range', selected: [], custom: '' }
                ],
                message: 'secret pending notice'
              })
            }
          }
        }
      ]
    }) as { events: Array<Record<string, unknown>> }
    expect(history.events[0]).toMatchObject({
      type: 'tool/status',
      data: { name: 'skill', activity: 'tools', detail: 'bisheng-docx', callId: 'skill-1' }
    })
    expect(history.events[1]).toMatchObject({
      type: 'tool/status',
      data: {
        name: 'ask_user_question',
        activity: 'questions',
        asks: [
          { id: 'city', question: '哪个城市？', header: '城市' },
          { id: 'range', question: '哪个范围？' }
        ]
      }
    })
    expect(history.events[2]).toEqual({
      type: 'tool/status',
      data: {
        phase: 'done',
        callId: 'ask-1',
        turn: 4,
        asks: [
          { id: 'city', answer: '北京' },
          { id: 'range', answer: '' }
        ]
      }
    })
    const encoded = JSON.stringify(history)
    expect(encoded).not.toContain('secret')
    expect(encoded).toContain('哪个城市？')
    expect(encoded).toContain('北京')
  })

  it('keeps a turn failure message and drops the request id', () => {
    const history = projectTranscriptHistory({
      events: [
        {
          type: 'turn/end',
          time: 30,
          data: {
            reason: {
              kind: 'error',
              error: {
                message: 'Upstream model request failed',
                code: 'upstream_error',
                status: 200,
                requestId: 'secret-request'
              }
            }
          }
        }
      ]
    }) as { events: Array<Record<string, unknown>> }
    expect(history.events[0]).toEqual({
      type: 'turn/end',
      time: 30,
      data: {
        reason: {
          kind: 'error',
          message: 'Upstream model request failed',
          code: 'upstream_error'
        }
      }
    })
    expect(JSON.stringify(history)).not.toContain('secret-request')
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
