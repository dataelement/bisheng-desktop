import { scopeOf } from '@deepseek-ai/dsh-scope'

const registrations = new WeakMap()
const NAME = 'office-pptx'
const PROVIDER = 'dsh-ppt-office-pptx-scope-policy'

/**
 * Own mode policy registrations across agent scopes for one plugin instance.
 * Call sync at each pre-step boundary, after obtaining the current mode/cwd.
 * Each active sync reloads the effective source through the public registry,
 * so provider changes and project-specific overrides appear at the next step.
 * No private registry cache or provider method is patched.
 *
 * @returns {{ sync: (ctx: import('@deepseek-ai/cordis').Context, options: { active: boolean, cwd?: string, signal?: AbortSignal }) => Promise<void>, dispose: () => void }}
 */
export function createOfficePptxScopePolicyController() {
  const entries = new Map()
  let disposed = false
  return {
    async sync(agentCtx, options) {
      if (disposed) throw new Error('office-pptx policy controller is disposed')
      if (typeof options?.active !== 'boolean') throw new Error('office-pptx policy active must be boolean')
      const scope = scopeOf(agentCtx)
      if (!scope) throw new Error('office-pptx policy requires an agent scope')
      let entry = entries.get(scope)
      if (!entry && !options.active) return
      if (!entry) {
        entry = { revision: 0, policy: undefined, pending: Promise.resolve(), closed: false }
        entries.set(scope, entry)
        entry.dispose = agentCtx.effect(() => () => {
          entry.closed = true
          entry.revision++
          entry.loading?.abort(new Error('office-pptx policy owner disposed'))
          entry.policy?.dispose()
          entry.policy = undefined
          if (entries.get(scope) === entry) entries.delete(scope)
        })
      }
      const revision = ++entry.revision
      entry.loading?.abort(new Error('office-pptx policy sync superseded'))
      // Stop the old contribution immediately, including while a prior source
      // lookup is pending. Serial execution prevents same-layer duplicates.
      entry.policy?.dispose()
      entry.policy = undefined
      const operation = entry.pending.then(async () => {
        if (entry.closed || entry.revision !== revision || !options.active) return
        let policy
        const loading = new AbortController()
        entry.loading = loading
        const signal = options.signal ? AbortSignal.any([options.signal, loading.signal]) : loading.signal
        try {
          policy = await registerOfficePptxScopePolicy(agentCtx, { cwd: options.cwd, signal })
        } catch (error) {
          if (entry.closed || entry.revision !== revision) return
          // Ordinary Office is optional; PPT mode still works without this skill.
          if (error?.code === 'OFFICE_PPTX_SOURCE_UNAVAILABLE') return
          throw error
        } finally {
          if (entry.loading === loading) entry.loading = undefined
        }
        if (entry.closed || entry.revision !== revision) policy.dispose()
        else entry.policy = policy
      })
      // Keep this scope usable after a failed lookup; the original caller still
      // receives the rejection from operation below.
      entry.pending = operation.catch(() => {})
      await operation
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of [...entries.values()]) entry.dispose()
    },
  }
}

/**
 * Shadow office-pptx only in the supplied agent context's scope.
 * Uses the public scoped provider API of the newer Harness skill registry.
 * The body and resource base are a snapshot of the effective definition at
 * registration time. Re-register after source changes or workspace changes.
 *
 * @param {import('@deepseek-ai/cordis').Context} agentCtx Existing agent scope context.
 * @param {{ cwd?: string, signal?: AbortSignal }} [options] Source lookup options.
 * @returns {Promise<{ dispose: () => void }>} Idempotent registration teardown.
 * @throws When unscoped, already registered, missing a source, or disposed during loading.
 */
export async function registerOfficePptxScopePolicy(agentCtx, options = {}) {
  const scope = scopeOf(agentCtx)
  if (!scope) throw new Error('office-pptx policy requires an agent scope')
  if (registrations.has(scope)) throw new Error('office-pptx policy already registered in this scope')
  const skills = agentCtx.get('skills')
  if (!skills || typeof skills.registerProvider !== 'function') {
    throw new Error('office-pptx policy requires the scoped skill provider API')
  }
  const token = {}
  registrations.set(scope, token)
  let disposed = false
  let unregister
  const dispose = agentCtx.effect(() => () => {
    disposed = true
    unregister?.()
    if (registrations.get(scope) === token) registrations.delete(scope)
  })
  try {
    const source = await skills.get(NAME, { ...options, scope })
    options.signal?.throwIfAborted()
    if (disposed) throw new Error('office-pptx policy scope disposed during loading')
    if (!source) {
      throw Object.assign(new Error('office-pptx policy source skill is unavailable'), { code: 'OFFICE_PPTX_SOURCE_UNAVAILABLE' })
    }
    const definition = {
      ...source,
      provider: PROVIDER,
      invocation: { ...source.invocation, modelInvocable: false },
    }
    // Scope proximity wins over global ranks; this rank also precedes ordinary
    // project/runtime providers already present in the exact agent layer.
    const candidate = { ...definition, rank: Number.MIN_SAFE_INTEGER, locator: NAME }
    unregister = skills.registerProvider(() => ({
      name: PROVIDER,
      async list() { return [candidate] },
      async get(selected) { return selected.locator === NAME ? definition : undefined },
    }))
    return { dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
