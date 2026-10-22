import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { applyWorkCapabilities } from '../packages/dsh-desktop-enterprise/work-capabilities.js'
import { withWorkMcp, readMcpPages } from '../packages/dsh-desktop-enterprise/work-mcp.js'
import { materializeWorkSkill, validateWorkSkillBundle } from '../packages/dsh-desktop-enterprise/work-skill-bundle.js'

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
  const skill = bundle(), messages = [], catalog = { tools: [{ name: 'bisheng_tool_7', description: 'Search customers',
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

it('negotiates the real SDK protocol and follows all catalog pages', async () => {
  const f = fixture()
  const result = await withWorkMcp(f.request, 'account-a', undefined, client => client.listTools())
  expect(result.tools[0].name).toBe('bisheng_tool_7')
  expect(f.messages.map(row => row.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  const fetchPage = vi.fn(async params => params?.cursor ? { tools: [2] } : { tools: [1], nextCursor: 'next' })
  expect(await readMcpPages(fetchPage, 'tools')).toEqual([1, 2])
  await expect(readMcpPages(async () => ({ tools: [], nextCursor: 'same' }), 'tools')).rejects.toThrow('cursor')
})

it('materializes a complete binary-safe package and rejects tampering and path escape', async () => {
  const source = bundle()
  const loaded = await materializeWorkSkill(source, source.uri)
  cleanups.push(loaded.dispose)
  expect(await readFile(`${loaded.root}/templates/report.bin`)).toEqual(Buffer.from([0, 255, 128, 10]))
  for (const path of ['../escape', '/absolute', 'x\\escape', 'C:/escape', 'a/../x', 'NUL', 'x.']) {
    const bad = structuredClone(source); bad.files[1].path = path
    expect(() => validateWorkSkillBundle(bad, bad.uri)).toThrow()
  }
  const bad = structuredClone(source); bad.files[1].data = Buffer.from('changed').toString('base64')
  expect(() => validateWorkSkillBundle(bad, bad.uri)).toThrow('integrity')
})

it('registers native tools and skills, enforces approval, isolates children and clears identity', async () => {
  const f = fixture(), tools = new Map(), events = new Map()
  const session = { id: 'main', header: { delegationDepth: 0 } }
  let account = { connected: true, connectionKey: 'account-a' }, provider, guard
  const ctx = {
    logger: { warn: vi.fn() }, sessions: { get: id => id === 'main' ? session : undefined },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard: fn => { guard = fn } },
    skills: { registerProvider: factory => { provider = factory({ invalidate: vi.fn(), signal: new AbortController().signal }); return vi.fn() } },
    on: (name, fn) => events.set(name, fn), effect: fn => cleanups.push(fn())
  }
  const api = applyWorkCapabilities(ctx, { request: f.request, state: () => account, refreshState: async () => {} })
  await api.sync()
  const tool = tools.get('mcp__bisheng__bisheng_tool_7')
  const exec = { name: tool.name, agent: { session }, signal: new AbortController().signal }
  expect(guard(exec)).toBeUndefined()
  expect(guard({ ...exec, agent: { session: { id: 'child', header: { delegationDepth: 1 } } } })).toContain('main')
  expect(await events.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }))).toMatchObject({ kind: 'ask' })
  expect(await events.get('tools/pre-execute')(exec, async () => ({ kind: 'deny' }))).toEqual({ kind: 'deny' })
  expect((await tool.execute({ query: 'customer' }, exec)).content[0].text).toBe('customer result')
  f.fail()
  await expect(tool.execute({ query: 'customer' }, exec)).rejects.toThrow('denied')
  const candidate = (await provider.list()).candidates[0]
  const loaded = await provider.get(candidate, {})
  expect(loaded.content).toContain('Use the template.')
  expect(loaded.content).toContain('mcp__bisheng__bisheng_tool_7')
  expect(await readFile(`${loaded.resourceBase.path}/templates/report.bin`)).toEqual(Buffer.from([0, 255, 128, 10]))
  f.catalog.tools = []
  await expect(provider.get(candidate, {})).rejects.toThrow('Required enterprise tools')
  account = { connected: true, connectionKey: 'account-b' }
  await expect(tool.execute({ query: 'customer' }, exec)).rejects.toThrow('account changed')
  api.clear()
  expect(tools.size).toBe(0)
})
