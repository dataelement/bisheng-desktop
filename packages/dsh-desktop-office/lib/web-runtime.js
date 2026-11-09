/**
 * Adapt only registration ownership; validation, skill bodies and tools stay upstream.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('../index.js').OfficeRuntimeModules} upstream
 * @returns {import('../index.js').OfficeRuntimeModules}
 */
export function webRuntime(ctx, upstream) {
  const disposers = new Set()
  const agents = new WeakMap()
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); disposers.clear() })
  return {
    officeSkills: { name: 'office-web-skills', inject: ['skills'], apply(owner, config) {
      const skills = { registerProvider(create) {
        return owner.skills.registerProvider(control => {
          const provider = create(control)
          const name = 'office-web-official'
          const rewrite = candidate => ({ ...candidate, provider: name, rank: candidate.rank - 1 })
          return { ...provider, name,
            list: async options => (await provider.list(options)).map(rewrite),
            get: async (candidate, options) => {
              const definition = await provider.get(candidate, options)
              return definition && { ...definition, provider: name }
            }
          }
        })
      } }
      upstream.officeSkills.apply({ skills }, config)
    } },
    workspaceDependencies: { ...upstream.workspaceDependencies, name: 'office-web-dependencies', inject: ['tools', 'agents'], apply(owner, config) {
      upstream.workspaceDependencies.apply({ effect: owner.effect.bind(owner), tools: { register(tool) {
        // Always agent-local: stock may activate before or after this plugin.
        // Scope-local registration shadows stock only for the executing agent.

        const register = agent => {
          if (!agents.has(agent)) {
            const dispose = agent.ctx.get('tools').register(tool)
            agents.set(agent, dispose); disposers.add(dispose)
          }
        }
        owner.on('agent/created', ({ agent }) => { register(agent) })
        owner.on('agent/disposed', ({ agent }) => {
          const dispose = agents.get(agent)
          if (dispose) { dispose(); disposers.delete(dispose); agents.delete(agent) }
        })
        for (const agent of owner.agents.list()) register(agent)
      } } }, config)
    } }
  }
}
