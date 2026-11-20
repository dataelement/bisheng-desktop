import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

const bundle = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js', 'utf8')
const sessionId = 'blank-work'

function store(snapshot) {
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    set(value) { snapshot = value; for (const listener of listeners) listener() },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
  }
}

// Activate the installed client factory: the chip's injected callbacks, shared stage,
// per-binding controllers and list-change applier all come from the real plugin.
function setup(initialPreset, select) {
  let plugin
  runInNewContext(bundle, { window: { __ModuleLoader__: { load({ factory }) {
    plugin = factory(name => name === '@deepseek-ai/dsh-client-store' ? { createSnapshotStore: store } : {})
  } } } })
  const slots = new Map()
  const effect = start => start()
  const retainedBy = { mainView: 1 }
  const session = { id: sessionId, blank: true, retainedBy, projectionValues: { agentPreset: initialPreset } }
  const list = store({ byId: { [sessionId]: session } })
  const binding = { sessionId, ctx: { effect } }
  const noop = () => {}
  const ctx = {
    effect,
    inject: (_deps, activate) => activate(ctx),
    provide: (key, service) => { ctx[key] = service },
    slots: {
      register(slot) { slots.set(slot.name, slot); return () => slots.delete(slot.name) },
      inject: (_key, register) => register()
    },
    configForms: { get: () => store({ value: { enabled: true } }), developerTools: { enabled: store(true) } },
    locale: { register: () => noop },
    on: () => noop,
    sessions: { list, binding: id => id === sessionId ? binding : undefined, retainInfo: () => store({ retainedBy }) },
    remote: { $on: () => noop, agentPresets: { select } }
  }
  plugin.apply(ctx)
  return {
    ctx,
    chip: id => slots.get('conversation.hero.agentPreset').inject(id),
    publish(preset) {
      list.set({ byId: { [sessionId]: { ...session, projectionValues: { agentPreset: preset } } } })
    }
  }
}

it('waits for an older bound chip write and selects the case even when the session projection still shows it', async () => {
  const older = Promise.withResolvers()
  let hostPreset = 'case'
  const select = vi.fn(async (_id, preset) => {
    if (preset === 'old') await older.promise
    hostPreset = preset
    return { ok: true, value: preset }
  })
  const { ctx, chip, publish } = setup(hostPreset, select)
  const bound = chip(sessionId)
  const pendingChip = bound.select('old')
  expect(select.mock.calls).toEqual([[sessionId, 'old']])
  let caseSettled = false
  const pendingCase = ctx.desktopCasePreset.select(sessionId, 'case').then(() => { caseSettled = true })
  await Promise.resolve()
  expect(caseSettled).toBe(false)
  expect(select.mock.calls).toEqual([[sessionId, 'old']])
  older.resolve()
  await Promise.all([pendingChip, pendingCase])
  expect(select.mock.calls).toEqual([[sessionId, 'old'], [sessionId, 'case']])
  expect(hostPreset).toBe('case')
  publish(hostPreset)
  expect(bound.hooks.agentPresetSeat.getSnapshot().current).toBe('case')
})

it('discards an unapplied new-session chip choice so a later list update cannot overwrite the case', async () => {
  let hostPreset = 'default'
  const select = vi.fn(async (_id, preset) => {
    hostPreset = preset
    return { ok: true, value: preset }
  })
  const { ctx, chip, publish } = setup(hostPreset, select)
  await chip(undefined).select('old')
  expect(select).not.toHaveBeenCalled()
  const bound = chip(sessionId)
  await ctx.desktopCasePreset.select(sessionId, 'case')
  publish(hostPreset)
  expect(select.mock.calls).toEqual([[sessionId, 'case']])
  expect(hostPreset).toBe('case')
  expect(bound.hooks.agentPresetSeat.getSnapshot().current).toBe('case')
})
