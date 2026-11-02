import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../packages/dsh-desktop-client-ui/index.js'
import { completionProjection } from '../packages/dsh-desktop-client-ui/completion-projection.js'

const dispose = []
afterEach(async () => { for (const fn of dispose.splice(0).reverse()) await fn() })
async function host(origin) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(plugin)
  dispose.push(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('completion-fixture'), origin ? { meta: { origin } } : undefined)
  const snapshot = () => ctx.sessionProjections.snapshot(session).values.desktopWorkCompletion
  return { ctx, session, snapshot }
}
function finish(session, turn, reason = { kind: 'completed' }, step = true) {
  session.append('turn/start', { turn })
  if (step) session.append('step/start', { turn, step: 1 })
  session.append('turn/end', { turn, reason })
}
function client(sessions) {
  const bridge = { completed: vi.fn(async () => 'requested'), onClicked: vi.fn(() => vi.fn()) }
  let definition
  vm.runInNewContext(readFileSync(process.env.DSH_WORK_NOTIFICATION_SOURCE || new URL('../packages/dsh-desktop-client-ui/client.js', import.meta.url), 'utf8'), {
    window: { dshDesktopNotifications: bridge, __ModuleLoader__: { load: value => { definition = value } } },
    console, Date
  })
  const exported = definition.factory(() => ({}))
  const listeners = new Set()
  let state = { phase: 'pending', ids: [], byId: {}, projectionsBySession: {} }
  const openSession = vi.fn()
  const select = vi.fn()
  exported.installWorkCompletionNotifications({
    effect: fn => dispose.push(fn()), uiWorkspace: { openSession },
    sessions: sessions ?? { list: { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } } }
  }, { select })
  const publish = (rows, phase = 'ready', catalogIds = Object.keys(rows)) => {
    state = { phase, ids: catalogIds,
      byId: Object.fromEntries(catalogIds.map(id => [id, { projectionValues: { desktopWorkCompletion: rows[id] } }])),
      projectionsBySession: Object.fromEntries(Object.entries(rows).map(([id, completion]) => [id, { values: { desktopWorkCompletion: completion } }])) }
    for (const fn of listeners) fn()
  }
  return { bridge, publish, listeners, openSession, select }
}

// Expose the installed catalog implementation only inside this test VM. The
// manager, projection stores, notification scheduling and public list remain real.
function harnessSessions(catalog = 'failed') {
  // The browser store engine is supplied by the web bootstrap in production.
  // This adapter supplies its observable boundary without mounting a web UI.
  const stores = {
    notifySubscribers: listeners => { for (const fn of [...listeners]) fn() },
    createSnapshotStore: initial => {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        set: next => { value = next; for (const fn of [...listeners]) fn() }
      }
    }
  }

  let exported
  const source = readFileSync(new URL('../node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js', import.meta.url), 'utf8')
    .replace('exports.SessionManager = SessionManager;', 'exports.SessionManager = SessionManager; exports.ClientSessions = ClientSessions;')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { exported = value.factory(id => {
      if (id === '@deepseek-ai/cordis') return cordis
      if (id === '@deepseek-ai/dsh-api-gateway/client') return gateway
      if (id === '@deepseek-ai/dsh-client-store') return stores
      throw new Error(`Unexpected Harness dependency: ${id}`)
    }) } } }, console, queueMicrotask, setTimeout, clearTimeout, AbortController
  })
  const ctx = new Context()
  dispose.push(() => ctx.fiber.dispose())
  return new exported.ClientSessions(ctx, { session: { list: async () => catalog === 'empty' ? { ok: true, value: { items: [] } } : ({ ok: false, error: {
    code: 'gateway/internal', message: 'Fixture catalog unavailable', details: {}, isDSHRemoteError: true
  } }) } })
}

describe('Work completion producer through the installed Harness registry', () => {
  it('delivers two successive successful turns and consumes repeated snapshots once', async () => {
    const h = await host()
    const c = client()
    c.publish({ work: h.snapshot() })
    finish(h.session, 1)
    c.publish({ work: h.snapshot() })
    c.publish({ work: h.snapshot() })
    finish(h.session, 2)
    c.publish({ work: h.snapshot() })
    expect(c.bridge.completed.mock.calls.map(([v]) => [v.sessionId, v.turn, v.count])).toEqual([['work', 1, 1], ['work', 2, 1]])
    c.bridge.onClicked.mock.calls[0][0]('work')
    expect(c.select).toHaveBeenCalledWith('work')
    expect(c.openSession).toHaveBeenCalledWith('work')
  })
  it.each(['aborted', 'error', 'blocked', 'max-tokens', 'interrupted'])('keeps %s separate from successful completion', async kind => {
    const h = await host()
    const reason = kind === 'aborted' ? { kind, reason: { kind: 'user' } } : kind === 'error' ? { kind, error: { code: 'UNKNOWN', message: 'fixture' } } : { kind }
    finish(h.session, 1, reason)
    expect(h.snapshot().count).toBe(0)
    finish(h.session, 2)
    expect(h.snapshot().count).toBe(1)
  })
  it('suppresses subagent completions and turns that never entered a model step', async () => {
    const child = await host('subagent')
    finish(child.session, 1)
    expect(child.snapshot().count).toBe(0)
    const h = await host()
    finish(h.session, 1, { kind: 'completed' }, false)
    expect(h.snapshot().count).toBe(0)
  })
  it('suppresses inherited fork events using the exact inherited cursor', () => {
    let state = completionProjection.init({}, 3)
    for (const event of [{ seq: 0, type: 'turn/start', data: { turn: 1 } }, { seq: 1, type: 'step/start', data: { turn: 1 } }, { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: 10 }]) state = completionProjection.apply(state, event)
    expect(state.completion.count).toBe(0)
  })
  it('uses historical baselines, preserves reconnect progress and handles a first fast completion', () => {
    const c = client()
    const old = { count: 5, turn: 7, seq: 40, time: 1 }
    c.publish({ a: old })
    expect(c.bridge.completed).toHaveBeenCalledTimes(0)
    c.publish({ a: { ...old, count: 7, turn: 9, seq: 60 } })
    expect(c.bridge.completed).toHaveBeenLastCalledWith({ sessionId: 'a', count: 2, turn: 9, seq: 60 })
    c.publish({ a: old })
    expect(c.bridge.completed).toHaveBeenCalledTimes(1)
    c.publish({ fast: { count: 1, turn: 1, seq: 8, time: Date.now() } })
    expect(c.bridge.completed).toHaveBeenCalledTimes(2)
  })
  it.each(['pending', 'ready'])('delivers Work completion while the session catalog is %s and has no matching row', phase => {
    const c = client()
    c.publish({ work: { count: 0, turn: 0, seq: -1, time: 0 } }, phase, [])
    c.publish({ work: { count: 1, turn: 1, seq: 8, time: Date.now() } }, phase, [])
    expect(c.bridge.completed).toHaveBeenCalledExactlyOnceWith({ sessionId: 'work', turn: 1, seq: 8, count: 1 })
    c.publish({ work: { count: 1, turn: 1, seq: 8, time: Date.now() } }, 'ready')
    expect(c.bridge.completed).toHaveBeenCalledTimes(1)
  })
  it.each(['loading', 'failed', 'empty'])('delivers real Host projections through the installed ClientSessions while catalog RPC is %s', async phase => {
    const h = await host()
    const sessions = harnessSessions(phase)
    if (phase !== 'loading') await sessions.refresh()
    const c = client(sessions)
    // The authenticated control baseline is independent of the catalog RPC.
    sessions.handleControlFrame({ type: 'baseline', value: { projections: {
      work: { asOfSeq: h.session.seq - 1, values: { desktopWorkCompletion: h.snapshot() } }
    } } })
    h.ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      if (key === 'desktopWorkCompletion') sessions.handleControlFrame({ type: 'projection', sessionId: 'work', key, value, seq })
    })
    await Promise.resolve()
    expect(sessions.list.getSnapshot().phase).toBe(phase === 'empty' ? 'ready' : 'pending')
    expect(sessions.list.getSnapshot().ids).toEqual([])
    finish(h.session, 1)
    await vi.waitFor(() => expect(c.bridge.completed).toHaveBeenCalledExactlyOnceWith({ sessionId: 'work', turn: 1, seq: h.session.seq - 1, count: 1 }))
  })
  it('processes independent sessions while animation frames are absent and unsubscribes on disposal', async () => {
    const c = client()
    const start = { count: 0, turn: 0, seq: -1, time: 0 }
    c.publish({ a: start, b: start })
    c.publish({ a: { count: 1, turn: 1, seq: 8, time: Date.now() }, b: { count: 1, turn: 1, seq: 9, time: Date.now() } })
    expect(c.bridge.completed).toHaveBeenCalledTimes(2)
    await dispose.pop()()
    expect(c.listeners.size).toBe(0)
  })
})

it('runs the real AgentLoop for two text-only tasks and publishes completion through the host projection', async () => {
  const ctx = new Context()
  dispose.push(() => ctx.fiber.dispose())
  for (const service of [SessionStore, SessionProjectionRegistry, AgentRegistry, SystemPrompt, ToolRuntime, LlmRuntime, AgentLoop, plugin]) await ctx.plugin(service)
  ctx.llm.registerAdapter(['fixture'], new EnterpriseLlmAdapter({
    providerName: () => 'Fixture', connectionKey: () => 'fixture-connection',
    models: () => [{ id: 'bisheng:1', display_name: 'Fixture', capabilities: { streaming: true, tools: true } }],
    request: async () => new Response([
      'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'The Mars garden is complete.' }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]'
    ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }))
  const handle = await ctx.agents.create({ sessionId: SessionId('text-only-notice'), agentOptions: { provider: 'fixture', model: 'bisheng:1' } })
  dispose.push(() => handle.dispose())
  const c = client()
  const publish = () => c.publish({ 'text-only-notice': ctx.sessionProjections.snapshot(handle.agent.session).values.desktopWorkCompletion })
  ctx.sessionProjections.onChanged((_session, key) => { if (key === 'desktopWorkCompletion') publish() })
  publish()
  for (let turn = 1; turn <= 2; turn++) {
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write about a Mars garden.' }] }))
    await handle.agent.whenIdle()
    expect(ctx.sessionProjections.snapshot(handle.agent.session).values.desktopWorkCompletion.count).toBe(turn)
  }
  expect(c.bridge.completed).toHaveBeenCalledTimes(2)
})
