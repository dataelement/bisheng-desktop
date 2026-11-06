import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerCloudTools } from '../packages/dsh-desktop-workbenches/cloud-tools.mjs'

function fixture(mode = 'workspace-write', projectId) {
  let tool, preStep
  const request = vi.fn(async input => ({ operation: input.operation, items: [] }))
  const scoped = { desktopCloud: { request }, tools: { register: value => { tool = value } },
    sandboxPolicy: { resolve: () => ({ mode }) }, on: (_name, callback) => { preStep = callback } }
  const state = { cloudDevelopmentSessions: projectId ? { conversation: projectId } : {}, sessionBindings: { conversation: 'cloud-entry' }, cloudWorkbenches: {
    'cloud-entry': { appId: 'a'.repeat(32), title: 'Shared board', versionId: 'b'.repeat(32) }
  } }
  registerCloudTools({ inject: (_names, callback) => callback(scoped) }, { read: async () => ({ state }) })
  return { tool, preStep, request }
}

it('discovery does not implicitly fetch source or ask for publishing credentials', async () => {
  const { tool, request } = fixture()
  await tool.execute({ operation: 'list' }, { agent: { session: {} } })
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'list' })
})

it('a read-only Agent session cannot create or publish a cloud project', async () => {
  const { tool, request } = fixture('read-only')
  for (const operation of ['create', 'checkout', 'publish']) await expect(tool.execute({ operation }, { agent: { session: {} } })).rejects.toThrow('writable')
  expect(request).not.toHaveBeenCalled()
})

it('cloud-owned conversations receive app identity and source-on-demand instructions', async () => {
  const { preStep, request } = fixture()
  const result = await preStep({ agent: { id: 'conversation', session: { surface: { nodes: [] } } }, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  expect(JSON.stringify(result.messages)).toContain('a'.repeat(32))
  expect(JSON.stringify(result.messages)).toContain('do not download source')
  expect(JSON.stringify(result.messages)).toContain('obtain user authorization in the conversation')
  expect(JSON.stringify(result.messages)).toContain('never ask the user to click a publishing button')
  expect(request).not.toHaveBeenCalled()
})

it('cannot package a development project outside the Agent workspace', async () => {
  const { request } = fixture()
  request.mockResolvedValue({ path: process.cwd() })
  // The root is a real parent directory; use a sibling project as the denied target.
  const scoped = { desktopCloud: { request }, tools: { register: value => { scoped.tool = value } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: import.meta.dirname }) }, on() {} }
  registerCloudTools({ inject: (_names, callback) => callback(scoped) }, {})
  await expect(scoped.tool.execute({ operation: 'publish', projectId: 'project' }, { agent: { session: {} } })).rejects.toThrow('workspace')
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'project', projectId: 'project' })
})


it('a prepared development session supplies its project identity without downloading source again', async () => {
  const { preStep, request } = fixture('workspace-write', '12345678-1234-1234-1234-123456789abc')
  const result = await preStep({ agent: { id: 'conversation', session: { surface: { nodes: [] } } }, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  expect(JSON.stringify(result.messages)).toContain('12345678-1234-1234-1234-123456789abc')
  expect(JSON.stringify(result.messages)).toContain('Do not create or checkout another copy')
  expect(request).not.toHaveBeenCalled()
})

it('submits and tracks a release from the Agent without a manual publishing page', async () => {
  const { tool, request } = fixture('danger-full-access')
  const receipt = { app_id: 'a'.repeat(32), deployment_id: 'b'.repeat(32), status: 'received' }
  request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ status: 'waiting_approval' })
  const release = { operation: 'publish', projectId: 'prepared-project', releaseNotes: 'Confirmed release scope' }
  expect(await tool.execute(release, { agent: { session: {} } })).toEqual(receipt)
  expect(await tool.execute({ operation: 'progress', appId: receipt.app_id, deploymentId: receipt.deployment_id }, { agent: { session: {} } })).toEqual({ status: 'waiting_approval' })
  expect(request.mock.calls.map(([input]) => input.operation)).toEqual(['publish', 'progress'])
  expect(request).toHaveBeenCalledWith(release)
})

it('resolves the protocol URL through the current enterprise instead of reading a local file', async () => {
  const { tool, request } = fixture('read-only')
  request.mockResolvedValueOnce({ guideUrl: 'https://enterprise.test/prefix/api/v1/dev-toolkit/workbench-guide.md' })
  const result = await tool.execute({ operation: 'guide' }, { agent: { session: {} } })
  expect(result).toEqual({ guideUrl: 'https://enterprise.test/prefix/api/v1/dev-toolkit/workbench-guide.md' })
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'guide' })
})

it('reports the actual writable workspace boundary when preparing source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-workspace-'))
  try {
    const workspace = join(directory, 'workspace')
    const inside = join(workspace, 'source')
    const outside = join(directory, 'other-source')
    await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside)])
    const request = vi.fn()
    let tool
    registerCloudTools({ inject: (_names, callback) => callback({
      desktopCloud: { request }, tools: { register: value => { tool = value } },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) }, on() {}
    }) }, {})
    request.mockResolvedValueOnce({ projectId: 'new-project', path: outside })
    const created = await tool.execute({ operation: 'create' }, { agent: { session: {} } })
    expect(created.developmentWorkspace.ready).toBe(false)
    expect(created.developmentWorkspace.path).toBe(outside)
    expect(created.developmentWorkspace.instruction).toContain('Stop before writing')
    expect(created.developmentWorkspace.instruction).toContain('Changing working_directory does not change')
    request.mockResolvedValueOnce({ projectId: 'editable-project', path: inside })
    const checkedOut = await tool.execute({ operation: 'checkout' }, { agent: { session: {} } })
    expect(checkedOut.developmentWorkspace.ready).toBe(true)
    expect(request.mock.calls.map(([input]) => input.operation)).toEqual(['create', 'checkout'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
