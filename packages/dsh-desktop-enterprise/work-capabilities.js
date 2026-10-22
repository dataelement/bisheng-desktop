import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { withWorkMcp, readMcpPages } from './work-mcp.js'
import { materializeWorkSkill } from './work-skill-bundle.js'

const PROVIDER = 'bisheng-enterprise'
const PREFIX = 'mcp__bisheng__'

/** Account-bound tools and a native Skill provider; no credential reaches Agent context. */
export function applyWorkCapabilities(ctx, { request, state, refreshState }) {
  let generation = 0, connectionKey, timer, stopped = false, syncing
  let signature = '', skillRows = [], disposeTools = [], invalidate = () => {}
  const bundles = new Map()
  const cleanupJobs = new Set()
  const releaseBundles = () => {
    const pending = [...bundles.values()]
    bundles.clear()
    const job = Promise.allSettled(pending.map(async value => (await value).dispose()))
    cleanupJobs.add(job)
    void job.then(results => {
      cleanupJobs.delete(job)
      if (results.some(result => result.status === 'rejected')) ctx.logger.warn('Enterprise Skill cache cleanup was incomplete.')
    })
    return job
  }
  let lifetime = new AbortController()
  const assertAccount = key => {
    const account = state()
    if (stopped || !account.connected || account.connectionKey !== key) throw new Error('Enterprise account changed.')
  }
  const mainSession = exec => {
    const session = exec.agent?.session
    return session && (session.header?.delegationDepth ?? 0) === 0 && ctx.sessions.get(session.id) === session
  }
  const clear = () => {
    const changed = Boolean(connectionKey || signature || skillRows.length || disposeTools.length)
    generation++
    lifetime.abort()
    lifetime = new AbortController()
    void releaseBundles()
    for (const dispose of disposeTools) dispose()
    disposeTools = []; signature = ''; skillRows = []; connectionKey = undefined
    if (changed) invalidate()
  }
  const rpc = async (key, signal, use) => {
    assertAccount(key)
    const result = await withWorkMcp(request, key, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal, use)
    assertAccount(key)
    return result
  }
  const synchronize = async () => {
    await refreshState()
    const account = state()
    if (!account.connected || !account.connectionKey) { clear(); return }
    if (connectionKey && connectionKey !== account.connectionKey) clear()
    const key = account.connectionKey, epoch = generation
    const catalog = await rpc(key, undefined, async client => ({
      tools: await readMcpPages(params => client.listTools(params), 'tools'),
      skills: await readMcpPages(params => client.listResources(params), 'resources')
    }))
    if (generation !== epoch || stopped) throw new Error('Enterprise capability synchronization expired.')
    const nextSignature = JSON.stringify([key, catalog])
    if (signature === nextSignature) return
    const names = new Set()
    const definitions = catalog.tools.map(tool => {
      if (!/^bisheng_tool_[1-9][0-9]*$/.test(tool.name) || names.has(tool.name)) throw new Error('Invalid enterprise tool name.')
      names.add(tool.name)
      return createMcpToolDefinition(ctx, {
        name: PREFIX + tool.name, rawName: tool.name, description: tool.description || tool.title || tool.name,
        inputSchema: tool.inputSchema,
        call: async (args, exec) => {
          if (!mainSession(exec)) throw new Error('An active main Work task is required.')
          await refreshState()
          return rpc(key, exec.signal, client => client.callTool({ name: tool.name, arguments: args }, { signal: exec.signal, timeout: 65_000 }))
        }
      })
    })
    if (catalog.skills.some(skill => !/^bisheng-skill:\/\/[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}$/.test(skill.uri) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name))) throw new Error('Invalid enterprise Skill catalog.')
    for (const dispose of disposeTools) dispose()
    disposeTools = []
    try { for (const definition of definitions) disposeTools.push(ctx.tools.register(definition)) }
    catch (error) { clear(); throw error }
    connectionKey = key; signature = nextSignature; skillRows = catalog.skills
    invalidate()
  }
  const sync = () => syncing ??= synchronize().finally(() => { syncing = undefined })

  ctx.tools.guard(exec => exec.name.startsWith(PREFIX) && !mainSession(exec) ? 'Enterprise tools require an active main Work task.' : undefined)
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (!exec.name.startsWith(PREFIX) || decision.kind !== 'allow') return decision
    if (!mainSession(exec)) return { kind: 'deny', reason: 'Enterprise tools require an active main Work task.' }
    return { kind: 'ask', reason: 'Use the enterprise tool with the displayed arguments.',
      displayReason: { en: 'Run this enterprise tool with these arguments?', zh: '使用这些参数调用企业工具？' } }
  })
  ctx.on('skills/invocation', async (policy, skill, options, next) => {
    const resolved = await next()
    if (skill.provider !== PROVIDER) return resolved
    const session = options.scope?.session ?? (options.sessionId ? ctx.sessions.get(options.sessionId) : undefined)
    if (!state().connected || (session && session.header?.delegationDepth > 0)) return { modelInvocable: false, userInvocable: false }
    return resolved
  })
  const disposeProvider = ctx.skills.registerProvider(control => {
    invalidate = control.invalidate
    return {
      name: PROVIDER,
      async list() {
        await sync()
        return { complete: true, candidates: skillRows.map(row => ({ name: row.name,
          description: `${row.title || row.name} · ${row.description || ''}`, provider: PROVIDER,
          source: 'enterprise', rank: 500, invocation: { modelInvocable: true, userInvocable: true },
          locator: { uri: row.uri, connectionKey }, metadata: { uri: row.uri } })) }
      },
      async get(candidate, options) {
        const { uri, connectionKey: key } = candidate.locator
        await refreshState()
        const epoch = generation
        const result = await rpc(key, options.signal, client => client.readResource({ uri }, { signal: options.signal }))
        const text = result.contents?.[0]?.text
        if (typeof text !== 'string') throw new Error('Invalid enterprise Skill response.')
        const bundle = JSON.parse(text)
        if (bundle.name !== candidate.name) throw new Error('Enterprise Skill identity changed.')
        const available = await rpc(key, options.signal, client => readMcpPages(params => client.listTools(params), 'tools'))
        if (!Array.isArray(bundle.tool_ids) || bundle.tool_ids.some(id => !available.some(tool => tool.name === `bisheng_tool_${id}`))) {
          throw new Error('Required enterprise tools are unavailable for this Skill.')
        }
        const cacheKey = `${key}:${uri}`
        let materialized = bundles.get(cacheKey)
        if (!materialized) {
          const pending = materializeWorkSkill(bundle, uri, lifetime.signal)
            .then(async value => {
              try { assertAccount(key); return value } catch (error) { await value.dispose(); throw error }
            })
          bundles.set(cacheKey, pending)
          try { materialized = await pending } catch (error) {
            if (bundles.get(cacheKey) === pending) bundles.delete(cacheKey)
            throw error
          }
        }
        materialized = await materialized
        options.signal?.throwIfAborted()
        assertAccount(key)
        if (generation !== epoch) throw new Error('Enterprise Skill loading expired; refresh the catalog.')
        const dependencies = bundle.tool_ids.map(id => `- Tool ${id}: ${PREFIX}bisheng_tool_${id}`).join('\n')
        return { ...candidate, content: dependencies ? `${bundle.content}\n\nEnterprise tools available in this Work task:\n${dependencies}` : bundle.content,
          path: `${materialized.root}/SKILL.md`, resourceBase: { kind: 'directory', path: materialized.root },
          metadata: { ...candidate.metadata, version: bundle.version, tool_ids: bundle.tool_ids } }
      }
    }
  })
  const poll = async () => {
    if (stopped) return
    try { await sync() }
    catch (error) { clear(); ctx.logger.warn('Enterprise Work capabilities: %s', error.message) }
    if (!stopped) { timer = setTimeout(poll, 30_000); timer.unref?.() }
  }
  void poll()
  ctx.effect(() => async () => {
    stopped = true; clearTimeout(timer); clear(); disposeProvider()
    await Promise.allSettled([...cleanupJobs])
  })
  return { sync, clear }
}
