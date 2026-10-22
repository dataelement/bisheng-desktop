import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

let plugin
vm.runInNewContext(readFileSync(new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } }
})

function setup() {
  // Detect coordinates count each native reference as one editor node.
  let nodes = ['hello '], rev = 0, phase = 'plain'
  const snapshot = () => {
    let offset = 0
    const occurrences = []
    const draft = nodes.map(node => {
      if (typeof node === 'string') { offset += node.length; return node }
      const text = node.clipboardText
      occurrences.push({ ...node, offset, length: text.length })
      offset += text.length
      return text
    }).join('')
    return { draft, occurrences, draftRev: rev, phase }
  }
  const input = {
    state: { getSnapshot: snapshot },
    insertReference: (reference, span) => {
      if (span.draftRev !== rev) return false
      nodes.push(reference, ' '); rev++; return true
    }
  }
  const scope = { bail: (_scope, _event, { span }) => {
    let offset = 0
    const index = nodes.findIndex(node => {
      const start = offset
      offset += typeof node === 'string' ? node.length : 1
      return start === span.start && typeof node !== 'string'
    })
    if (index < 0 || span.draftRev !== rev) return false
    nodes.splice(index, 1); rev++; return true
  } }
  const request = vi.fn(async () => ({ spaces: [] }))
  const ensureSession = vi.fn(async () => {})
  const composer = plugin.createWorkKnowledgeComposer({ inputFor: () => ({ input, scope }), request, ensureSession })
  const capture = () => ({ start: 0, end: 0, draftRev: rev })
  const update = spaces => composer.update('one', spaces, capture)
  const enter = () => composer.prepare({ sessionId: 'one', references: snapshot().occurrences, signal: new AbortController().signal })
  return { composer, request, update, enter, input, setNodes: value => { nodes = value; rev++ }, setPhase: value => { phase = value } }
}
const a = { id: 7, name: '研发知识库' }
const b = { id: 9, name: '团队资料' }

describe('Work inline knowledge references', () => {
  it('inserts native blue-reference data with a stable ID and no preview action', async () => {
    const { composer, update, input } = setup()
    update([a])
    const [ref] = input.state.getSnapshot().occurrences
    expect(ref).toMatchObject({ source: 'desktop-knowledge', label: a.name, clipboardText: `@${a.name}` })
    expect(ref.appearance).toBeUndefined()
    expect(composer.source.openReference()).toBe(false)
    expect(await composer.source.codec.serialize(ref.ref)).toBe(`@${a.name}`)
    expect(composer.read('one')).toEqual([a])
  })
  it('removes references by editor coordinates while retaining prose and other source references', () => {
    const { composer, update, input, setNodes } = setup()
    update([a, b])
    const [ra, rb] = input.state.getSnapshot().occurrences
    setNodes(['before ', { source: 'files', ref: 'long-file', clipboardText: '@very-long-file.pdf' }, ' ', ra, ' middle ', rb, ' after'])
    update([b])
    expect(composer.read('one')).toEqual([b])
    expect(input.state.getSnapshot().draft).toBe('before @very-long-file.pdf  middle @团队资料 after')
    update([])
    expect(input.state.getSnapshot().occurrences.map(ref => ref.source)).toEqual(['files'])
  })
  it('deduplicates IDs, keeps same-name spaces distinct and commits exactly the draft selection', async () => {
    const { update, enter, request } = setup()
    update([a, a, { ...b, name: a.name }])
    await enter()
    expect(request).toHaveBeenLastCalledWith('select', 'one', [7, 9], expect.any(AbortSignal))
  })
  it('keyboard deletion/undo follows native document occurrences', async () => {
    const { update, input, setNodes, composer, enter, request } = setup()
    update([a, b])
    const [ra, rb] = input.state.getSnapshot().occurrences
    setNodes(['question ', rb])
    expect(composer.read('one')).toEqual([b])
    await enter()
    expect(request.mock.calls.at(-1)[2]).toEqual([9])
    setNodes(['question ', ra, rb])
    await enter()
    expect(request.mock.calls.at(-1)[2]).toEqual([7, 9])
  })
  it('keeps the running task scope on sent-draft cleanup and clears it on the next send without references', async () => {
    const { update, enter, request, setNodes } = setup()
    update([a]); await enter()
    setNodes([])
    expect(request).toHaveBeenCalledTimes(1)
    setNodes(['next question']); await enter()
    expect(request.mock.calls.at(-1)[2]).toEqual([])
  })
  it('leaves ordinary local Work submissions independent of enterprise login', async () => {
    const { enter, request } = setup()
    await enter()
    expect(request).not.toHaveBeenCalled()
  })
  it('surfaces revoked access before sending and retains the draft', async () => {
    const { update, enter, request, composer } = setup()
    update([a]); request.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(enter()).rejects.toThrow('Forbidden')
    expect(composer.read('one')).toEqual([a])
  })
  it('refuses modal edits while a command owns the input', () => {
    const { update, setPhase, composer } = setup()
    setPhase('claimed')
    expect(() => update([a])).toThrow('Finish editing')
    expect(composer.read('one')).toEqual([])
  })
})

const native = readFileSync(new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url), 'utf8')
const sinkFactory = new Function('actx', 'session', `return ${native.match(/defaultSink: (async \(text, attachmentIds, mode, signal, references = \[\]\) => \{[\s\S]*?\n\s*\}),/)[1]}`)

it('native send waits for the submitted reference snapshot for prose, slash prompts and attachment-only messages', async () => {
  const trace = [], session = { sessionId: 'one' }
  const sink = vi.fn(async () => { trace.push('sent'); return { kind: 'success' } })
  const actx = { serial: vi.fn(async (_scope, event, payload) => { trace.push('scope'); expect(event).toBe('conversation/input-before-submit'); expect(payload.sessionId).toBe('one') }) }
  const submit = sinkFactory.call({ sink }, actx, session)
  const refs = [{ source: 'desktop-knowledge', ref: JSON.stringify(a) }]
  for (const text of ['question @研发知识库', '/skill question', '']) {
    trace.length = 0
    await submit(text, ['attachment'], 'next-turn', new AbortController().signal, text ? refs : undefined)
    expect(trace).toEqual(['scope', 'sent'])
    expect(actx.serial.mock.calls.at(-1)[2].references).toEqual(text ? refs : [])
  }
  expect(native).toContain('defaultSink(out.trim(), attachmentIds, mode, attempt.signal, occurrences)')
})

it('native send blocks on revoked permission or cancellation instead of dispatching', async () => {
  const sink = vi.fn()
  const actx = { serial: vi.fn(async () => { throw new Error('Forbidden') }) }
  const submit = sinkFactory.call({ sink }, actx, { sessionId: 'one' })
  await expect(submit('question', [], 'next-turn', new AbortController().signal, [])).rejects.toThrow('Forbidden')
  const abort = new AbortController(); abort.abort()
  await expect(submit('question', [], 'next-turn', abort.signal, [])).rejects.toThrow()
  expect(sink).not.toHaveBeenCalled()
})
