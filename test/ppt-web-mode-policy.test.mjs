import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { installWebModePolicy } from '../packages/ppt-runtime/core/lib/web-mode-policy.js'

const cleanups = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })

async function fixture({ office = true } = {}) {
  const root = new Context()
  const registry = root.plugin(SkillRegistry)
  await registry
  cleanups.push(() => registry.dispose())
  let body = 'original office body'
  if (office) root.skills.registerProvider(() => ({
    name: 'office',
    async list() { return [{ name: 'office-pptx', description: 'Ordinary PPT', provider: 'office', source: 'bundled', rank: 100, locator: 'pptx', invocation: { modelInvocable: true, userInvocable: true } }] },
    async get() { return { name: 'office-pptx', description: 'Ordinary PPT', content: body, source: 'bundled', provider: 'office', invocation: { modelInvocable: true, userInvocable: true } } },
  }))
  let listener
  let cwd = '/tmp/ppt-web-policy'
  const active = new Set()
  const ctx = {
    effect: root.effect.bind(root),
    workingDirectory: { ensure: async () => cwd },
    on(name, handler, options) {
      expect(name).toBe('agent/pre-step')
      expect(options).toEqual({ prepend: true })
      listener = handler
      return () => { listener = undefined }
    },
  }
  const stop = installWebModePolicy(ctx, { state: async id => ({ presentationMode: active.has(id) ? 'ppt' : undefined }) })
  cleanups.push(stop)
  const agent = id => {
    const a = { id }
    const scope = createScope(root, a)
    a.ctx = scope.ctx
    cleanups.push(() => scope.dispose())
    return a
  }
  return { root, active, agent, stop,
    body: value => { body = value }, cwd: value => { cwd = value },
    get: a => root.skills.get('office-pptx', { scope: a, cwd }),
    step: (a, next = async () => ({ kind: 'enter' }), signal = new AbortController().signal) => listener({ agent: a, signal }, next),
  }
}

it('applies policy before downstream catalog reads and restores after mode changes', async () => {
  const f = await fixture(), a = f.agent('a'), b = f.agent('b')
  f.active.add('a')
  await f.step(a, async () => {
    expect((await f.get(a)).invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect((await f.get(b)).invocation.modelInvocable).toBe(true)
    return { kind: 'enter' }
  })
  f.active.delete('a')
  await f.step(a)
  expect((await f.get(a)).invocation.modelInvocable).toBe(true)
})

it('refreshes the original definition for new steps and unregisters on plugin teardown', async () => {
  const f = await fixture(), a = f.agent('a')
  f.active.add('a')
  await f.step(a)
  expect((await f.get(a)).content).toBe('original office body')
  f.body('updated office body')
  f.cwd('/tmp/ppt-web-policy-next')
  await f.step(a)
  expect((await f.get(a)).content).toBe('updated office body')
  f.stop()
  expect((await f.get(a)).invocation.modelInvocable).toBe(true)
})

it('permits a Profile with no ordinary Office skill', async () => {
  const f = await fixture({ office: false }), a = f.agent('a')
  f.active.add('a')
  expect(await f.step(a)).toEqual({ kind: 'enter' })
  expect(await f.get(a)).toBeUndefined()
})

it('rejects cancelled refreshes and can retry on the next step', async () => {
  const f = await fixture(), a = f.agent('a')
  f.active.add('a')
  const abort = new AbortController()
  abort.abort(new Error('cancel refresh'))
  await expect(f.step(a, undefined, abort.signal)).rejects.toThrow('cancel refresh')
  await f.step(a)
  expect((await f.get(a)).invocation.modelInvocable).toBe(false)
})
