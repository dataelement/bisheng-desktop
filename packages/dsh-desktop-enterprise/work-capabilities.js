import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { withWorkMcp, readMcpPages } from './work-mcp.js'

const PREFIX = 'mcp__bisheng__'

/** Account-bound enterprise tools; no credential reaches Agent context. */
export function applyWorkCapabilities(ctx, { request, state, refreshState }) {
  let generation = 0, connectionKey, timer, stopped = false, syncing
  let signature = '', disposeTools = []
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
    generation++
    lifetime.abort()
    lifetime = new AbortController()
    for (const dispose of disposeTools) dispose()
    disposeTools = []; signature = ''; connectionKey = undefined
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
    const catalog = await rpc(key, undefined, async client => ({ tools: await readMcpPages(params => client.listTools(params), 'tools') }))
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
    for (const dispose of disposeTools) dispose()
    disposeTools = []
    try { for (const definition of definitions) disposeTools.push(ctx.tools.register(definition)) }
    catch (error) { clear(); throw error }
    connectionKey = key; signature = nextSignature
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
  const poll = async () => {
    if (stopped) return
    try { await sync() }
    catch (error) { clear(); ctx.logger.warn('Enterprise Work capabilities: %s', error.message) }
    if (!stopped) { timer = setTimeout(poll, 30_000); timer.unref?.() }
  }
  void poll()
  ctx.effect(() => async () => {
    stopped = true; clearTimeout(timer); clear()
  })
  return { sync, clear }
}
