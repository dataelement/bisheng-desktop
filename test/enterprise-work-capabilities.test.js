import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { applyWorkCapabilities } from '../packages/dsh-desktop-enterprise/work-capabilities.js'
import { withWorkMcp, readMcpPages } from '../packages/dsh-desktop-enterprise/work-mcp.js'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

function bundle() {
  const files = [{ path: 'SKILL.md', data: Buffer.from('---\nname: report\ndescription: Create a report\n---\nUse the template.') },
    { path: 'templates/report.bin', data: Buffer.from([0, 255, 128, 10]) }]
  const digest = createHash('sha256')
  for (const file of files) digest.update(file.path).update('\0').update(createHash('sha256').update(file.data).digest()).update('\0')
  const version = digest.digest('hex')
  return { name: 'bisheng-2-9-report', uri: `bisheng-skill://2/9/${version}`, version,
    content: 'Use the template.', tool_ids: [7], files: files.map(file => ({ path: file.path,
      data: file.data.toString('base64'), sha256: createHash('sha256').update(file.data).digest('hex') })) }
}

function fixture() {
  const skill = bundle(), messages = [], catalog = { tools: [{ name: 'customer_query', title: 'Customer lookup', _meta: { 'bisheng.tool_id': 7 }, description: 'Search customers',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }
  let failure = false
  const request = vi.fn(async ({ message, connectionKey }) => {
    expect(connectionKey).toBe('account-a')
    messages.push(message)
    if (message.method.startsWith('notifications/')) return null
    let result
    if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'bisheng', version: '1' } }
    else if (message.method === 'tools/list') result = catalog
    else if (message.method === 'resources/list') result = { resources: [{ name: skill.name, uri: skill.uri, description: 'A report', mimeType: 'application/json' }] }
    else if (message.method === 'resources/read') result = { contents: [{ uri: skill.uri, mimeType: 'application/json', text: JSON.stringify(skill) }] }
    else if (message.method === 'tools/call') result = { content: [{ type: 'text', text: failure ? 'denied' : 'customer result' }], isError: failure }
    else throw new Error(`Unexpected method ${message.method}`)
    return { jsonrpc: '2.0', id: message.id, result }
  })
  return { request, messages, skill, catalog, fail: () => { failure = true } }
}

it('synchronizes at startup and on demand without a periodic catalog request', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture(), routes = []
    const ctx = { connection: { fetch: { register: route => routes.push(route) } }, logger: { warn: vi.fn() },
      sessions: { get: () => undefined }, tools: { register: () => () => {}, guard: vi.fn() },
      on: vi.fn(), effect: fn => cleanups.push(fn()) }
    const api = applyWorkCapabilities(ctx, { request: f.request, state: () => ({ connected: true, connectionKey: 'account-a' }), refreshState: async () => {} })
    await api.sync()
    const count = () => f.messages.filter(message => message.method === 'tools/list').length
    expect(count()).toBe(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(count()).toBe(1)
    await routes[0].fetch(new Request('http://localhost/api/enterprise.work-tools', { method: 'POST', body: JSON.stringify({ operation: 'refresh' }) }))
    expect(count()).toBe(2)
  } finally { vi.useRealTimers() }
})

it('keeps conversation preparation available on catalog failure but rejects stale tool execution', async () => {
  const f = fixture(), events = new Map(), registered = new Map()
  const session = { id: 'main', header: { delegationDepth: 0 } }
  let failing = false
  const ctx = { connection: { fetch: { register: vi.fn() } }, logger: { warn: vi.fn() },
    sessions: { get: () => session }, tools: { register: tool => { registered.set(tool.name, tool); return () => registered.delete(tool.name) }, guard: vi.fn() },
    on: (name, fn) => events.set(name, fn), effect: fn => cleanups.push(fn()) }
  const api = applyWorkCapabilities(ctx, { request: (...args) => failing ? Promise.reject(new Error('network unavailable')) : f.request(...args),
    state: () => ({ connected: true, connectionKey: 'account-a' }), refreshState: async () => {} })
  await api.sync()
  const tool = registered.get('mcp__bisheng__customer_query')
  failing = true
  await expect(events.get('system-prompt/prepare')({ agent: { session } })).resolves.toBeUndefined()
  expect(registered.size).toBe(0)
  await expect(tool.execute({ query: 'x' }, { agent: { session }, signal: new AbortController().signal })).rejects.toThrow('authorization expired')
  const abort = new AbortController(); abort.abort()
  await expect(events.get('system-prompt/prepare')({ agent: { session }, signal: abort.signal })).rejects.toThrow()
})

it('does not clear a newer generation when an old refresh fails', async () => {
  let rejectOld, entered
  const gate = new Promise((resolve, reject) => { rejectOld = reject })
  const started = new Promise(resolve => { entered = resolve })
  let calls = 0
  const ctx = { connection: { fetch: { register: vi.fn() } }, logger: { warn: vi.fn() }, sessions: { get: () => undefined },
    tools: { register: vi.fn(() => vi.fn()), guard: vi.fn() }, on: vi.fn(), effect: fn => cleanups.push(fn()) }
  const api = applyWorkCapabilities(ctx, { request: vi.fn(), state: () => ({ connected: false }),
    refreshState: async () => { calls++; if (calls === 1) { entered(); await gate } } })
  await started
  const old = api.sync()
  api.clear()
  rejectOld(new Error('old request failed'))
  await expect(old).rejects.toThrow('old request failed')
  // A second refresh must succeed after the stale attempt has settled.
  await expect(api.sync()).resolves.toBeUndefined()
})

it.each(['bisheng_tool_7', 'Customer Query', 'a'.repeat(51), 'duplicate'])('rejects invalid or duplicate catalog names: %s', async name => {
  const f = fixture(), register = vi.fn(() => () => {})
  f.catalog.tools[0].name = name
  if (name === 'duplicate') f.catalog.tools.push({ ...f.catalog.tools[0] })
  const ctx = { connection: { fetch: { register: vi.fn() } }, logger: { warn: vi.fn() }, sessions: { get: () => undefined },
    tools: { register, guard: vi.fn() }, on: vi.fn(), effect: fn => cleanups.push(fn()) }
  const api = applyWorkCapabilities(ctx, { request: f.request, state: () => ({ connected: true, connectionKey: 'account-a' }), refreshState: async () => {} })
  await expect(api.sync()).rejects.toThrow('Invalid enterprise tool name')
  expect(register).not.toHaveBeenCalled()
})

it('negotiates the real SDK protocol and follows all catalog pages', async () => {
  const f = fixture()
  const result = await withWorkMcp(f.request, 'account-a', undefined, client => client.listTools())
  expect(result.tools[0].name).toBe('customer_query')
  expect(f.messages.map(row => row.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  const fetchPage = vi.fn(async params => params?.cursor ? { tools: [2] } : { tools: [1], nextCursor: 'next' })
  expect(await readMcpPages(fetchPage, 'tools')).toEqual([1, 2])
  await expect(readMcpPages(async () => ({ tools: [], nextCursor: 'same' }), 'tools')).rejects.toThrow('cursor')
})

it('registers native tools without overriding approval policy, isolates children and clears identity', async () => {
  const f = fixture(), tools = new Map(), events = new Map()
  const session = { id: 'main', header: { delegationDepth: 0 } }
  let account = { connected: true, connectionKey: 'account-a' }, provider, guard
  const ctx = {
    connection: { fetch: { register: vi.fn() } },
    logger: { warn: vi.fn() }, sessions: { get: id => id === 'main' ? session : undefined },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard: fn => { guard = fn } },
    skills: { registerProvider: factory => { provider = factory({ invalidate: vi.fn(), signal: new AbortController().signal }); return vi.fn() } },
    on: (name, fn) => events.set(name, fn), effect: fn => cleanups.push(fn())
  }
  const api = applyWorkCapabilities(ctx, { request: f.request, state: () => account, refreshState: async () => {} })
  await api.sync()
  const tool = tools.get('mcp__bisheng__customer_query')
  expect(await api.resolveToolName(7)).toBe('mcp__bisheng__customer_query')
  expect(await api.resolveToolName(8)).toBeUndefined()
  expect(tool.description).toContain('Customer lookup')
  const exec = { name: tool.name, agent: { session }, signal: new AbortController().signal }
  expect(guard(exec)).toBeUndefined()
  expect(guard({ ...exec, agent: { session: { id: 'child', header: { delegationDepth: 1 } } } })).toContain('main')
  // No enterprise-specific hook may override the shared policy (including full-access allow).
  expect(events.has('tools/pre-execute')).toBe(false)
  expect((await tool.execute({ query: 'customer' }, exec)).content[0].text).toBe('customer result')
  expect(f.messages.find(row => row.method === 'tools/call').params.name).toBe('customer_query')
  f.fail()
  await expect(tool.execute({ query: 'customer' }, exec)).rejects.toThrow('denied')
  account = { connected: true, connectionKey: 'account-b' }
  await expect(tool.execute({ query: 'customer' }, exec)).rejects.toThrow('account changed')
  api.clear()
  expect(tools.size).toBe(0)
})

it('serves fresh picker entries and rejects disabled tools and old-account drafts', async () => {
  const f = fixture(), tools = new Map()
  let route, account = { connected: true, connectionKey: 'account-a' }
  const ctx = {
    connection: { fetch: { register: value => { route = value } } },
    logger: { warn: vi.fn() }, sessions: { get: () => undefined },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard: vi.fn() },
    on: vi.fn(), effect: fn => cleanups.push(fn())
  }
  const api = applyWorkCapabilities(ctx, { request: f.request, state: () => account, refreshState: async () => {} })
  await api.sync()
  const send = body => route.fetch(new Request('http://localhost/api/enterprise.work-tools', { method: 'POST', body: JSON.stringify(body) }))
  const catalog = await (await send({ operation: 'catalog' })).json()
  expect(catalog.connectionKey).toBe('account-a')
  expect(catalog.tools).toEqual([{ name: 'mcp__bisheng__customer_query', label: 'Customer lookup', description: 'Search customers' }])
  const selection = { operation: 'validate', connectionKey: 'account-a', names: [catalog.tools[0].name] }
  expect((await send(selection)).status).toBe(200)
  expect((await send({ ...selection, connectionKey: 'old-account' })).status).toBe(400)
  f.catalog.tools = []
  expect((await send(selection)).status).toBe(400)
  expect(tools.size).toBe(0)
  expect((await (await send({ operation: 'catalog' })).json()).tools).toEqual([])
  expect((await send({ ...selection, names: 'all' })).status).toBe(400)
  account = { connected: false }
  expect((await send({ operation: 'catalog' })).status).toBe(400)
})
