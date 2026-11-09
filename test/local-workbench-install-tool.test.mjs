import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as workbenches from '../packages/dsh-desktop-workbenches/index.js'
import { localWorkbenchInstallTool } from '../packages/dsh-desktop-workbenches/local-install-tool.mjs'
import { readPackedManifest } from '../packages/dsh-desktop-workbenches/market-install.mjs'

// Deliberately do not mock dsh-tools, dsh-sandbox or local-archive: their installed
// validation, escalation ordering and real archive snapshot are the contract.
const roots = []
const staged = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([...roots.splice(0), ...staged.splice(0).map(dirname)].map(root => rm(root, { recursive: true, force: true })))
})
async function archive() {
  const root = await mkdtemp(join(tmpdir(), 'local-install-tool-test-'))
  roots.push(root)
  const manifest = { name: 'local-install-probe', version: '1.0.0', exports: { './client': './client.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['dsh-desktop-workbenches'] } } }
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package/package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'package/client.js'), 'export default {}')
  await writeFile(join(root, 'package/cordis.patch.yml'), '[]')
  const path = join(root, 'workbench.tgz')
  await promisify(execFile)('tar', ['-czf', path, '-C', root, 'package'])
  return { path, manifest }
}
function fixture({ application = 'applied', mode = 'workspace-write', approver = { request: vi.fn(async () => 'allowed-once') } } = {}) {
  const manager = {
    installBundle: vi.fn(async spec => {
      staged.push(spec)
      expect(readPackedManifest(await readFile(spec)).name).toBe('local-install-probe')
      return { application }
    }),
    cancelInstall: vi.fn(async () => ({ status: 'cancelled' }))
  }
  const policy = { mode }
  const ctx = { pluginManager: manager, sandboxPolicy: { resolve: vi.fn(() => policy) },
    get: vi.fn(name => name === 'approval' ? approver : undefined), logger: { warn: vi.fn() } }
  const tool = localWorkbenchInstallTool(ctx)
  const controller = new AbortController()
  const exec = { signal: controller.signal, callId: 'probe-call', agent: { session: { id: 'session-probe' } } }
  return { tool, manager, ctx, approver, exec, controller, policy }
}
async function expectClean(spec) {
  await expect(readFile(spec)).rejects.toMatchObject({ code: 'ENOENT' })
}

it.each([
  [{}, /path/], [{ path: 12 }, /path/], [{ path: '/unused.tgz', replace: 'true' }, /replace/],
  [{ path: '/unused.tgz', approvedBuilds: [12] }, /approvedBuilds/]
])('uses installed defineTool validation before approval or mutation (%j)', async (args, error) => {
  const f = fixture()
  await expect(f.tool.execute(args, f.exec)).rejects.toThrow(error)
  expect(f.approver.request).not.toHaveBeenCalled()
  expect(f.ctx.sandboxPolicy.resolve).not.toHaveBeenCalled()
  expect(f.manager.installBundle).not.toHaveBeenCalled()
  expect(f.tool.presentCall(args)).toBeUndefined()
})

it.each(['rejected', 'cancelled', 'unavailable'])('fails closed on %s before reading the archive', async outcome => {
  let approvalReached = false
  const f = fixture({ approver: { request: vi.fn(async () => { approvalReached = true; return outcome }) } })
  const readPath = vi.fn(() => {
    if (approvalReached) throw new Error('archive path accessed after refusal')
    return '/nonexistent.tgz'
  })
  const args = Object.defineProperty({}, 'path', { enumerable: true, get: readPath })
  // The installed defineTool validator accesses path; execution must not access
  // it again after approval has refused the operation.
  await expect(f.tool.execute(args, f.exec)).rejects.toThrow(/rejected|cancelled|no approval channel/)
  expect(approvalReached).toBe(true)
  expect(f.manager.installBundle).not.toHaveBeenCalled()
  expect(f.manager.cancelInstall).not.toHaveBeenCalled()
})

it('fails closed without an approver or agent before trying a nonexistent archive', async () => {
  const missing = fixture({ approver: null })
  missing.ctx.get.mockReturnValue(undefined)
  await expect(missing.tool.execute({ path: '/nonexistent.tgz' }, missing.exec)).rejects.toThrow('no approval service')
  const noAgent = fixture()
  await expect(noAgent.tool.execute({ path: '/nonexistent.tgz' }, { ...noAgent.exec, agent: undefined })).rejects.toThrow('no agent')
  expect(missing.manager.installBundle).not.toHaveBeenCalled()
  expect(noAgent.manager.installBundle).not.toHaveBeenCalled()
})

it('requests one-call shared Profile approval and delegates the verified snapshot, without widening session policy', async () => {
  const { path, manifest } = await archive()
  const original = await readFile(path)
  const f = fixture()
  f.manager.installBundle.mockImplementation(async (spec, options) => {
    staged.push(spec)
    await writeFile(path, 'source changed')
    expect(await readFile(spec)).toEqual(original)
    expect(spec).not.toBe(path)
    expect(options).toEqual({ enabled: true, expectedName: manifest.name, expectedVersion: manifest.version,
      replace: false, requestId: 'workbench-probe-call' })
    return { application: 'applied' }
  })
  const result = await f.tool.execute({ path }, f.exec)
  expect(JSON.parse(result)).toEqual({ packageName: manifest.name, version: manifest.version, application: 'applied' })
  expect(f.approver.request).toHaveBeenCalledWith(expect.objectContaining({ agent: f.exec.agent,
    toolName: 'install_local_workbench', callId: 'probe-call', signal: f.exec.signal,
    reason: expect.stringMatching(/danger-full-access.*shared Desktop Profile/) }))
  expect(f.ctx.sandboxPolicy.resolve).toHaveBeenCalledWith({ session: f.exec.agent.session })
  expect(f.policy).toEqual({ mode: 'workspace-write' })
  expect(f.exec.agent.session).toEqual({ id: 'session-probe' })
  expect(f.tool.isConcurrencySafe({ path })).toBe(false)
  expect(f.tool.output.render({ path }, result)).toEqual([{ type: 'text', text: result }])
  await expectClean(staged[0])
})

it.each(['applied', 'restart-required', 'failed', 'cancelled', 'overridden'])('preserves manager %s lifecycle and diagnostic details', async application => {
  const { path } = await archive()
  const f = fixture()
  const outcome = { application, error: { code: 'fixture-code', diagnostic: 'original cause' }, pendingBuilds: ['needs-build'] }
  f.manager.installBundle.mockImplementation(async spec => { staged.push(spec); return outcome })
  expect(JSON.parse(await f.tool.execute({ path }, f.exec))).toMatchObject(outcome)
  await expectClean(staged[0])
})

it('requires explicit replacement, forwards approved builds, and reports replacement as requiring restart', async () => {
  const { path } = await archive()
  const f = fixture()
  expect(JSON.parse(await f.tool.execute({ path, replace: true, approvedBuilds: ['native-probe'] }, f.exec))).toMatchObject({
    application: 'restart-required', restartReason: 'package-moved'
  })
  expect(f.manager.installBundle.mock.calls[0][1]).toMatchObject({ enabled: true, replace: true, approvedBuilds: ['native-probe'] })
  await expectClean(staged[0])
})

it.each([undefined, {}, { application: 'unknown' }])('rejects absent/invalid manager lifecycle (%j) and cleans staging', async result => {
  const { path } = await archive()
  const f = fixture()
  f.manager.installBundle.mockImplementation(async spec => { staged.push(spec); return result })
  await expect(f.tool.execute({ path }, f.exec)).rejects.toThrow('no lifecycle outcome')
  await expectClean(staged[0])
})

it('cleans staging after manager rejection and removes the abort listener', async () => {
  const { path } = await archive()
  const f = fixture()
  f.manager.installBundle.mockImplementation(async spec => { staged.push(spec); throw new Error('manager failed') })
  await expect(f.tool.execute({ path }, f.exec)).rejects.toThrow('manager failed')
  await expectClean(staged[0])
  f.controller.abort()
  expect(f.manager.cancelInstall).not.toHaveBeenCalled()
})

it('does not read the archive when aborted during approval', async () => {
  const f = fixture()
  f.approver.request.mockImplementation(async () => { f.controller.abort(new Error('stop before read')); return 'allowed-once' })
  await expect(f.tool.execute({ path: '/nonexistent.tgz' }, f.exec)).rejects.toThrow('stop before read')
  expect(f.manager.installBundle).not.toHaveBeenCalled()
})

it('cancels exactly the manager request on abort, retaining snapshot until the manager settles', async () => {
  const { path } = await archive()
  const f = fixture()
  let finish
  let started
  const ready = new Promise(resolve => { started = resolve })
  f.manager.installBundle.mockImplementation(spec => {
    staged.push(spec)
    started()
    return new Promise(resolve => { finish = resolve })
  })
  const running = f.tool.execute({ path }, f.exec)
  await ready
  f.controller.abort()
  expect(f.manager.cancelInstall).toHaveBeenCalledExactlyOnceWith('workbench-probe-call')
  expect(readPackedManifest(await readFile(staged[0])).name).toBe('local-install-probe')
  finish({ application: 'cancelled' })
  expect(JSON.parse(await running).application).toBe('cancelled')
  await expectClean(staged[0])
})

it('rejects an approved invalid archive before invoking the manager', async () => {
  const { path } = await archive()
  await writeFile(path, 'invalid archive')
  const f = fixture()
  await expect(f.tool.execute({ path }, f.exec)).rejects.toThrow('valid .tgz')
  expect(f.approver.request).toHaveBeenCalledTimes(1)
  expect(f.manager.installBundle).not.toHaveBeenCalled()
})

it('fails closed before archive reads when a Web manager lacks the verified-install contract', async () => {
  const f = fixture()
  f.ctx.get.mockImplementation(name => name === 'profileContext' ? { name: 'web' } : f.approver)
  await expect(f.tool.execute({ path: '/nonexistent.tgz' }, f.exec)).rejects.toThrow('verified-install capable Web Plugin Manager')
  expect(f.manager.installBundle).not.toHaveBeenCalled()
  expect(f.approver.request).toHaveBeenCalledTimes(1)
})

it('accepts a Web manager with the verified-install contract', async () => {
  const { path } = await archive()
  const f = fixture()
  f.manager.verifiedInstallContract = 1
  f.ctx.get.mockImplementation(name => name === 'profileContext' ? { name: 'web' } : f.approver)
  expect(JSON.parse(await f.tool.execute({ path }, f.exec)).application).toBe('applied')
  await expectClean(staged[0])
})

it('optionally registers through real Cordis injection and installed ToolRuntime, including disposal and reactivation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-tool-registration-'))
  roots.push(root)
  const ctx = new Context()
  const routes = []
  try {
    await ctx.plugin({ apply(owner) {
      owner.provide('connection', { fetch: { register(route) { routes.push(route) } } })
    } })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const mounted = ctx.plugin(workbenches, { root })
    await mounted
    expect(routes.length).toBeGreaterThan(0)
    expect(ctx.get('desktopWorkbenchOwnership')).toBeTruthy()
    expect(ctx.tools.wireSchemas().knownNames).not.toContain('install_local_workbench')
    const f = fixture()
    const manager = ctx.plugin({ apply(owner) { owner.provide('pluginManager', f.manager) } })
    await manager
    expect(ctx.tools.wireSchemas().knownNames).not.toContain('install_local_workbench')
    const policy = ctx.plugin({ apply(owner) {
      owner.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
    } })
    await policy
    await vi.waitFor(() => expect(ctx.tools.wireSchemas().knownNames).toContain('install_local_workbench'))
    expect(ctx.tools.wireSchemas().schemas.filter(tool => tool.name === 'install_local_workbench')).toHaveLength(1)
    await policy.dispose()
    await vi.waitFor(() => expect(ctx.tools.wireSchemas().knownNames).not.toContain('install_local_workbench'))
    await ctx.plugin({ apply(owner) {
      owner.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
    } })
    await vi.waitFor(() => expect(ctx.tools.wireSchemas().knownNames).toContain('install_local_workbench'))
    await mounted.dispose()
    expect(ctx.tools.wireSchemas().knownNames).not.toContain('install_local_workbench')
  } finally { await ctx.fiber.dispose() }
})
