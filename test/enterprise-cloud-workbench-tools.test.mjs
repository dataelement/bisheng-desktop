import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerCloudTools } from '../packages/dsh-desktop-enterprise/cloud-tools.js'

function fixture(mode = 'workspace-write', projectId) {
  let tool, preStep
  const request = vi.fn(async input => ({ operation: input.operation, items: [] }))
  const scoped = { desktopCloud: { request }, tools: { register: value => { tool = value } },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: process.cwd() }) }, on: (_name, callback) => { preStep = callback } }
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
  for (const operation of ['create', 'checkout', 'resume', 'publish']) await expect(tool.execute({ operation }, { agent: { session: {} } })).rejects.toThrow('writable')
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
  await expect(scoped.tool.execute({ operation: 'publish', projectId: 'project' }, { agent: { session: {} } })).rejects.toThrow('resume')
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

it('delivers the fetched enterprise Markdown to the Agent without a public web-fetch step', async () => {
  const { tool, request } = fixture('read-only')
  const protocol = {
    guideUrl: 'http://192.168.50.10/private/api/v1/dev-toolkit/workbench-guide.md',
    guideMarkdown: '# 企业工作台协议\n\n需要持续运行和多人协作时采用云端托管。\n',
    guideSha256: 'a'.repeat(64)
  }
  request.mockResolvedValueOnce(protocol)
  const result = await tool.execute({ operation: 'guide' }, { agent: { session: {} } })
  expect(result).toEqual(protocol)
  const rendered = tool.output.render({ operation: 'guide' }, result)
  expect(JSON.parse(rendered[0].text).guideMarkdown).toBe(protocol.guideMarkdown)
  expect(tool.description).toContain('read the complete returned guideMarkdown')
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
    expect(request).toHaveBeenLastCalledWith({ operation: 'create', workspaceRoot: await realpath(workspace) })
    expect(created.developmentWorkspace.instruction).toContain('resolve the directory authorization')
    expect(created.developmentWorkspace.instruction).toContain('does not require switching conversations')
    request.mockResolvedValueOnce({ projectId: 'editable-project', path: inside })
    const checkedOut = await tool.execute({ operation: 'checkout' }, { agent: { session: {} } })
    expect(checkedOut.developmentWorkspace.ready).toBe(true)
    expect(request.mock.calls.map(([input]) => input.operation)).toEqual(['create', 'checkout'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})


it('exposes schema-change confirmation and forwards only the explicitly supplied value', async () => {
  const { tool, request } = fixture('danger-full-access')
  expect(tool.parameters.properties.confirmSchemaChange).toMatchObject({ type: 'boolean' })
  expect(tool.description).toContain('explicit confirmation')
  const release = { operation: 'publish', projectId: 'prepared-project', confirmSchemaChange: true }
  await tool.execute(release, { agent: { session: {} } })
  expect(request).toHaveBeenCalledExactlyOnceWith(release)
  request.mockClear()
  const unconfirmed = { operation: 'publish', projectId: 'prepared-project' }
  await tool.execute(unconfirmed, { agent: { session: {} } })
  expect(request).toHaveBeenCalledExactlyOnceWith(unconfirmed)
  expect(request.mock.calls[0][0]).not.toHaveProperty('confirmSchemaChange')
  request.mockClear()
  await expect(tool.execute({ ...release, confirmSchemaChange: 'true' }, { agent: { session: {} } })).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})

it.each(['workspace-write', 'danger-full-access'])('uses the effective %s session workspace rather than model-provided paths', async mode => {
  const { realpath } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'cloud-current-session-'))
  try {
    let tool
    const request = vi.fn(async input => ({ projectId: 'prepared', path: input.workspaceRoot }))
    registerCloudTools({ inject: (_names, callback) => callback({
      desktopCloud: { request }, tools: { register: value => { tool = value } },
      sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: directory }) }, on() {}
    }) }, {})
    for (const operation of ['create', 'checkout', 'resume']) {
      const result = await tool.execute({ operation, projectId: 'prepared', workspaceRoot: '/model-supplied-directory' }, { agent: { session: {} } })
      expect(request).toHaveBeenLastCalledWith({ operation, projectId: 'prepared', workspaceRoot: await realpath(directory) })
      expect(result.developmentWorkspace.ready).toBe(true)
      expect(result.developmentWorkspace.instruction).toContain('Continue in this conversation')
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('creates, writes and publishes through the real Desktop broker in the same restricted session', async () => {
  const { writeFile, readFile, realpath } = await import('node:fs/promises')
  const { CloudWorkbenchService } = await import('../packages/dsh-desktop-enterprise/desktop/cloud-workbench.ts')
  const { startEnterpriseCredentialBroker } = await import('../packages/dsh-desktop-enterprise/desktop/credential-broker.ts')
  const directory = await mkdtemp(join(tmpdir(), 'cloud-workspace-broker-'))
  let broker
  try {
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const uploads = []
    const fetchEnterprise = async (path, init) => {
      if (path.endsWith('/deploy')) uploads.push(init.body)
      return { base: 'https://enterprise.test', connectionKey: 'c'.repeat(16), response: Response.json({ status_code: 200,
        data: { app_id: 'a'.repeat(32), deployment_id: 'b'.repeat(32) } }) }
    }
    const registry = join(directory, 'registry')
    let cloud = new CloudWorkbenchService(fetchEnterprise, registry, async () => true)
    broker = await startEnterpriseCredentialBroker({ cloudRequest: input => cloud.request(input) })
    const request = async input => {
      const response = await fetch(new URL('/v1/cloud', broker.url), { method: 'POST',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      return result
    }
    const session = { header: { cwd: workspace } }
    let tool
    registerCloudTools({ inject: (_names, callback) => callback({ desktopCloud: { request },
      tools: { register: value => { tool = value } },
      sandboxPolicy: { resolve: ({ session: current }) => {
        expect(current).toBe(session)
        return { mode: 'workspace-write', workspaceRoot: current.header.cwd }
      } }, on() {}
    }) }, {})
    const project = await tool.execute({ operation: 'create' }, { agent: { session } })
    expect(project.developmentWorkspace.ready).toBe(true)
    expect(project.path.startsWith(await realpath(workspace))).toBe(true)
    await writeFile(join(project.path, 'main.py'), 'print("same conversation")')
    // Restarting the privileged service must resolve the registered source path.
    cloud = new CloudWorkbenchService(fetchEnterprise, registry, async () => true)
    const result = await tool.execute({ operation: 'publish', projectId: project.projectId }, { agent: { session } })
    expect(result.app_id).toBe('a'.repeat(32))
    expect(uploads).toHaveLength(1)
    expect(uploads[0].get('package')).toBeInstanceOf(Blob)
    expect(await readFile(join(project.path, 'main.py'), 'utf8')).toContain('same conversation')
    expect(session.header.cwd).toBe(workspace)
  } finally {
    await broker?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps source and publishing requests out of the browser-facing cloud route', async () => {
  const { applyCloudBrowse } = await import('../packages/dsh-desktop-enterprise/cloud-browse.js')
  const directory = await mkdtemp(join(tmpdir(), 'cloud-browser-route-'))
  try {
    const routes = []
    const request = vi.fn(async () => ({ items: [] }))
    const connection = { fetch: { register: route => routes.push(route) } }
    applyCloudBrowse({ connection }, { state: () => ({ connected: true, connectionKey: 'account' }) }, input => request(input))
    const route = routes.find(route => route.path === '/api/enterprise.workbenches/cloud')
    for (const operation of ['create', 'checkout', 'resume', 'publish', 'project']) {
      const result = await route.fetch(new Request('http://127.0.0.1/api/enterprise.workbenches/cloud', {
        method: 'POST', body: JSON.stringify({ operation, workspaceRoot: '/caller-path' })
      }))
      expect(result.status).toBe(400)
      expect(request).not.toHaveBeenCalled()
    }
    const result = await route.fetch(new Request('http://127.0.0.1/api/enterprise.workbenches/cloud', {
      method: 'POST', body: JSON.stringify({ operation: 'list' })
    }))
    expect(result.status).toBe(200)
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'list' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('updates a resumed project binding while preserving concurrent workbench state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-resume-binding-'))
  try {
    let tool
    let stored = { revision: 1, state: { favorites: [], cloudDevelopmentSessions: { conversation: 'old-project' } } }
    let conflicted = false
    const store = {
      read: async () => structuredClone(stored),
      write: vi.fn(async saved => {
        if (!conflicted) {
          conflicted = true
          stored = { revision: 2, state: { favorites: ['new-favorite'], cloudDevelopmentSessions: { conversation: 'old-project' } } }
          throw Object.assign(new Error('state changed'), { status: 409 })
        }
        stored = saved
      })
    }
    registerCloudTools({ inject: (_names, callback) => callback({
      desktopCloud: { request: async () => ({ projectId: 'new-project', path: directory }) },
      tools: { register: value => { tool = value } },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: directory }) }, on() {}
    }) }, store)
    const result = await tool.execute({ operation: 'resume', projectId: 'old-project' }, { agent: { id: 'conversation', session: {} } })
    expect(result.developmentWorkspace.ready).toBe(true)
    expect(stored.state.favorites).toEqual(['new-favorite'])
    expect(stored.state.cloudDevelopmentSessions.conversation).toBe('new-project')
    expect(store.write).toHaveBeenCalledTimes(2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
