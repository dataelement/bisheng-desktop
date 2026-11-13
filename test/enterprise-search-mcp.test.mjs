import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { applyEnterpriseSearchPolicy } from '../packages/dsh-desktop-enterprise/search-policy.js'
import { applyWorkCapabilities } from '../packages/dsh-desktop-enterprise/work-capabilities.js'

const contexts = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  for (const plugin of [Loader, SystemPrompt, ToolRuntime, WebRuntime]) await ctx.plugin(plugin)
  const add = async (id, config = {}) => {
    const entryId = await ctx.loader.create({ id, name: '@deepseek-ai/dsh-tool-web', config })
    const entry = ctx.loader.resolve(entryId)
    await entry.fiber.await()
    return entry
  }
  return { ctx, add }
}

it('removes existing native search, preserves fetch and restores on enterprise unload', async () => {
  const { ctx, add } = await fixture()
  const config = { search: true, fetch: true, searchTimeoutMs: 4321 }
  const entry = await add('existing', config)
  expect(ctx.tools.get('web_search')).toBeTruthy()
  const policy = ctx.plugin({ inject: ['loader'], apply: applyEnterpriseSearchPolicy })
  await policy
  await entry.fiber.await()
  expect(ctx.tools.get('web_search')).toBeUndefined()
  expect(ctx.tools.get('web_fetch')).toBeTruthy()
  expect(entry.options.config).toEqual({ ...config, search: false })
  await policy.dispose()
  await entry.fiber.await()
  expect(entry.options.config).toBe(config)
  expect(ctx.tools.get('web_search')).toBeTruthy()
})

it('enforces search policy on later preset entries and configuration updates', async () => {
  const { ctx, add } = await fixture()
  await ctx.plugin({ inject: ['loader'], apply: applyEnterpriseSearchPolicy })
  const entry = await add('later', { fetch: true })
  expect(ctx.tools.get('web_search')).toBeUndefined()
  expect(ctx.tools.get('web_fetch')).toBeTruthy()
  await entry.update({ config: { search: true, fetch: false, searchMaxResults: 3 } })
  await entry.fiber.await()
  expect(ctx.tools.get('web_search')).toBeUndefined()
  expect(ctx.tools.get('web_fetch')).toBeUndefined()
  expect(entry.options.config.searchMaxResults).toBe(3)
})

it('provides web search only from the account MCP catalog, calls it and clears on logout', async () => {
  const { ctx, add } = await fixture()
  await ctx.plugin({ inject: ['loader'], apply: applyEnterpriseSearchPolicy })
  await add('native')
  const session = { id: 'main', header: { delegationDepth: 0 } }
  let account = { connected: true, connectionKey: 'account-a' }, enabled = true, fail = false, api
  const request = vi.fn(async ({ message, connectionKey }) => {
    expect(connectionKey).toBe('account-a')
    if (message.method.startsWith('notifications/')) return null
    let result
    if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bisheng', version: '1' } }
    else if (message.method === 'tools/list') result = { tools: enabled ? [{ name: 'web_search', title: '网页搜索',
      description: 'Search public webpages and cite returned URLs.', _meta: { 'bisheng.tool_id': 123 },
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] : [] }
    else if (message.method === 'tools/call') {
      expect(message.params).toEqual({ name: 'web_search', arguments: { query: '毕昇' } })
      result = { isError: fail, content: [{ type: 'text', text: fail ? 'Search unavailable' : JSON.stringify([{ title: '毕昇', url: 'https://example.com', snippet: 'Search result' }]) }] }
    } else throw new Error('Unexpected MCP operation')
    return { jsonrpc: '2.0', id: message.id, result }
  })
  await ctx.plugin({ inject: ['tools'], apply(scoped) {
    api = applyWorkCapabilities({ tools: scoped.tools, logger: scoped.logger,
      sessions: { get: id => id === session.id ? session : undefined },
      on: scoped.on.bind(scoped), effect: scoped.effect.bind(scoped),
      connection: { fetch: { register: vi.fn() } } }, {
      state: () => account, refreshState: async () => {}, request
    })
  } })
  await api.sync()
  expect(ctx.tools.get('web_search')).toBeUndefined()
  expect(ctx.tools.get('web_fetch')).toBeTruthy()
  const name = 'mcp__bisheng__web_search'
  const tool = ctx.tools.get(name)
  expect(tool).toBeTruthy()
  const exec = { name, agent: { session }, signal: new AbortController().signal }
  expect(JSON.stringify(await tool.execute({ query: '毕昇' }, exec))).toContain('https://example.com')
  fail = true
  await expect(tool.execute({ query: '毕昇' }, exec)).rejects.toThrow('Search unavailable')
  enabled = false
  await api.refresh()
  expect(ctx.tools.get(name)).toBeUndefined()
  expect(ctx.tools.get('web_search')).toBeUndefined()
  enabled = true
  await api.refresh()
  account = { connected: false }
  api.clear()
  expect(ctx.tools.get(name)).toBeUndefined()
  await expect(tool.execute({ query: '毕昇' }, exec)).rejects.toThrow()
  expect(ctx.tools.get('web_search')).toBeUndefined()
})


it('disables search in real retained preset compositions and later revisions', async () => {
  const { ctx } = await fixture()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresetRegistry, { default: 'enterprise' })
  const id = await ctx.loader.create({ name: '@deepseek-ai/dsh-agent-preset', config: {
    id: 'enterprise', plugins: [{ id: 'web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true } }]
  } })
  await ctx.loader.await()
  const policy = ctx.plugin({ inject: ['loader'], apply: applyEnterpriseSearchPolicy })
  await policy
  await ctx.loader.await()
  const lease = await ctx.agentPresets.acquireScope('enterprise')
  try {
    expect(ctx.tools.get('web_search', lease.key)).toBeUndefined()
    expect(ctx.tools.get('web_fetch', lease.key)).toBeTruthy()
  } finally { await lease[Symbol.asyncDispose]() }
  await policy.dispose()
  await ctx.loader.await()
  const restored = await ctx.agentPresets.acquireScope('enterprise')
  try { expect(ctx.tools.get('web_search', restored.key)).toBeTruthy() }
  finally { await restored[Symbol.asyncDispose]() }
})
