import { createOfficePptxScopePolicyController } from './office-pptx-scope-policy.js'

/**
 * Refresh the Web bundle's session workflow policy before each model step.
 * The Desktop bundle keeps its existing skills/invocation policy hook.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin lifetime context.
 * @param {{ state: (id: string) => Promise<{ presentationMode?: string }> }} modes
 * @returns {() => void} Remove the listener and all live registrations.
 */
export function installWebModePolicy(ctx, modes) {
  const controller = createOfficePptxScopePolicyController()
  const cleanup = ctx.effect(() => () => controller.dispose())
  const off = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    signal.throwIfAborted()
    const state = await modes.state(agent.id)
    const active = state.presentationMode === 'ppt'
    const cwd = active ? await ctx.workingDirectory.ensure(agent, signal) : undefined
    await controller.sync(agent.ctx, { active, cwd, signal })
    signal.throwIfAborted()
    return next()
  }, { prepend: true })
  return () => { off(); cleanup() }
}
