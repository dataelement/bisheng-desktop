import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { saveManifest } from '@deepseek-ai/dsh-plugin-manager/operations'

vi.mock('@deepseek-ai/dsh-plugin-manager/operations', async importOriginal => {
  const original = await importOriginal()
  return { ...original, saveManifest: vi.fn(original.saveManifest) }
})
import { createWebPackageBackend, registerWebPackageBackend } from '../packages/dsh-desktop-workbenches/web-package-backend.mjs'

const roots = []
afterEach(async () => {
  vi.mocked(saveManifest).mockReset()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const name = 'fixture-workbench'
const artifact = { name, version: '1.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } } }
async function fixture(manifest = artifact, result = { exitCode: 0, output: '' }) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'web-packages-')))
  roots.push(home)
  const dir = join(home, 'profiles/web')
  initProfile(dir, [])
  const profile = { name: 'web', dir, home, cwd: home, installAnchor: resolve('node_modules/@deepseek-ai/dsh/package.json') }
  const runPnpm = vi.fn(async context => {
    const pkg = join(context.dir, 'node_modules', manifest.name)
    await mkdir(pkg, { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(pkg, 'cordis.patch.yml'), '[]\n')
    return result
  })
  const backend = createWebPackageBackend({ profile, runPnpm })
  const request = { spec: '/fixture.tgz', kind: 'tarball', path: '/fixture.tgz', expectedName: name,
    expectedVersion: '1.0.0', signal: new AbortController().signal, onOutput: vi.fn() }
  const manifestText = await readFile(join(dir, 'package.json'), 'utf8')
  return { backend, profile, runPnpm, request, manifestText }
}

it('stages outside profiles, verifies the physical package and projects only a persistent link', async () => {
  const f = await fixture()
  const mutation = await f.backend.install(f.request)
  const installed = await realpath(join(f.profile.dir, 'node_modules', name))
  expect(installed).toMatch(/workbench-packages.*package-/)
  expect(installed.startsWith(join(f.profile.home, 'profiles'))).toBe(false)
  const manifest = JSON.parse(await readFile(join(f.profile.dir, 'package.json'), 'utf8'))
  expect(manifest.dependencies[name]).toBe('link:' + installed)
  expect(manifest.dsh.profile.bundles).toEqual([])
  expect(mutation).toMatchObject({ bundle: name, replaced: false, packageResult: { exitCode: 0 } })
  expect(f.runPnpm.mock.calls[0][2]).toMatchObject({ execution: 'service', activateNewBundles: false, signal: f.request.signal })
  await mutation.rollback()
  await mutation.rollback()
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(f.manifestText)
  await expect(realpath(join(f.profile.dir, 'node_modules', name))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps the prior package intact on update and can restore its projection', async () => {
  const f = await fixture()
  await f.backend.install(f.request)
  const old = await realpath(join(f.profile.dir, 'node_modules', name))
  const before = await readFile(join(f.profile.dir, 'package.json'), 'utf8')
  const mutation = await f.backend.install(f.request)
  expect(await realpath(join(f.profile.dir, 'node_modules', name))).not.toBe(old)
  expect(JSON.parse(await readFile(join(old, 'package.json'), 'utf8')).version).toBe('1.0.0')
  await mutation.rollback()
  expect(await realpath(join(f.profile.dir, 'node_modules', name))).toBe(old)
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(before)
})

it.each([
  { ...artifact, name: 'wrong-workbench' }, { ...artifact, version: '9.0.0' }, { ...artifact, dsh: undefined },
  { ...artifact, scripts: { postinstall: 'node build.js' } }
])('rejects an incompatible artifact without altering the active profile (%j)', async manifest => {
  const f = await fixture(manifest)
  await expect(f.backend.install(f.request)).rejects.toThrow()
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(f.manifestText)
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
})

it.each([{ exitCode: 1, output: 'ERR_PNPM_FETCH_503' }, { exitCode: 0, timedOut: true, output: 'stalled' }])('leaves the profile unchanged when pnpm does not complete successfully', async result => {
  const f = await fixture(artifact, result)
  const mutation = await f.backend.install(f.request)
  expect(mutation.packageResult).toMatchObject(result)
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(f.manifestText)
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
})

it('does not run pnpm for cancelled or unverified requests or overwrite a real package directory', async () => {
  const f = await fixture()
  expect(await f.backend.install({ ...f.request, expectedName: undefined, expectedVersion: undefined })).toBeUndefined()
  await expect(f.backend.install({ ...f.request, signal: AbortSignal.abort() })).rejects.toThrow()
  await mkdir(join(f.profile.dir, 'node_modules', name), { recursive: true })
  await expect(f.backend.install(f.request)).rejects.toThrow('another installer')
  expect(f.runPnpm).not.toHaveBeenCalled()
})

it('cleans staging after cancellation during package preparation', async () => {
  const f = await fixture()
  const controller = new AbortController()
  f.runPnpm.mockImplementationOnce(async () => { controller.abort(); return { exitCode: 0, output: '' } })
  await expect(f.backend.install({ ...f.request, signal: controller.signal })).rejects.toThrow()
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(f.manifestText)
})

it('serves the real Plugin Manager verified install path and rolls back a malformed patch', async () => {
  const f = await fixture()
  const manager = Object.assign(Object.create(PluginManager.prototype), {
    profile: f.profile, ownerContext: { get: key => key === 'profileBundlePackageBackend' ? f.backend : undefined, emit() {} },
    abort: new AbortController(), installs: new Map(), installedFrom: new Map(), lockWaitMs: 2000,
    managementBundles: new Set(), protectsManager: () => false,
    publishAndReload: async () => ({ application: 'restart-required', restartReason: 'no-hmr' })
  })
  expect(await manager.installBundle(f.request.path, { expectedName: name, expectedVersion: '1.0.0', enabled: true }))
    .toMatchObject({ application: 'restart-required', stage: 'enable', bundle: name, version: '1.0.0' })
  const before = await readFile(join(f.profile.dir, 'package.json'), 'utf8')
  const old = await realpath(join(f.profile.dir, 'node_modules', name))
  const run = f.runPnpm.getMockImplementation()
  f.runPnpm.mockImplementationOnce(async (...args) => {
    const result = await run(...args)
    await writeFile(join(args[0].dir, 'node_modules', name, 'cordis.patch.yml'), '[broken')
    return result
  })
  expect(await manager.installBundle(f.request.path, { expectedName: name, expectedVersion: '1.0.0', replace: true }))
    .toMatchObject({ application: 'failed', stage: 'install' })
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(before)
  expect(await realpath(join(f.profile.dir, 'node_modules', name))).toBe(old)
})

it('registers the Web service with lifecycle ownership without replacing a host backend', () => {
  const callbacks = []
  registerWebPackageBackend({ inject: (deps, callback) => callbacks.push(callback) })
  const scoped = { profileContext: { name: 'desktop' }, get: () => undefined, effect: vi.fn(), reflect: { provide: vi.fn() } }
  callbacks[0](scoped)
  callbacks[0]({ ...scoped, profileContext: { name: 'web' }, get: () => ({ supportsVerifiedInstall: true }) })
  expect(scoped.effect).not.toHaveBeenCalled()
})

it('rejects unpublished Git prepare builds and pnpm pending dependency builds', async () => {
  const git = await fixture({ ...artifact, scripts: { prepare: 'node build.js' } })
  await expect(git.backend.install({ ...git.request, kind: 'git', path: undefined, spec: 'https://example.invalid/demo.git' })).rejects.toThrow('requires install scripts')
  const f = await fixture()
  const run = f.runPnpm.getMockImplementation()
  f.runPnpm.mockImplementationOnce(async (...args) => {
    const result = await run(...args)
    await writeFile(join(args[0].dir, 'node_modules', '.modules.yaml'), "pendingBuilds:\n  - native-private@1.0.0\n")
    return result
  })
  await expect(f.backend.install(f.request)).rejects.toThrow('native-private@1.0.0')
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
})

it('preserves full failed pnpm diagnostics outside the removed preparation directory', async () => {
  const f = await fixture()
  f.runPnpm.mockImplementationOnce(async context => {
    const logDir = join(context.dir, '.plugin-manager', 'logs', 'operation-fixture')
    await mkdir(logDir, { recursive: true })
    const logPath = join(logDir, 'pnpm.log')
    await writeFile(logPath, 'complete pnpm diagnostic')
    return { exitCode: 1, output: 'bounded tail', logPath }
  })
  const mutation = await f.backend.install(f.request)
  expect(mutation.packageResult.logPath).toContain('workbench-install-logs')
  expect(await readFile(mutation.packageResult.logPath, 'utf8')).toBe('complete pnpm diagnostic')
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
})

it('rejects private dependencies that remain linked to mutable source outside preparation', async () => {
  const f = await fixture()
  const source = join(f.profile.home, 'mutable-private')
  await mkdir(source)
  const run = f.runPnpm.getMockImplementation()
  f.runPnpm.mockImplementationOnce(async (...args) => {
    const result = await run(...args)
    await symlink(source, join(args[0].dir, 'node_modules', 'private-dependency'), process.platform === 'win32' ? 'junction' : 'dir')
    return result
  })
  await expect(f.backend.install(f.request)).rejects.toThrow('dependency links outside')
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(f.manifestText)
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toEqual([])
})

it('preserves private dependencies and valid internal package links', async () => {
  const f = await fixture()
  const run = f.runPnpm.getMockImplementation()
  f.runPnpm.mockImplementationOnce(async (...args) => {
    const result = await run(...args)
    const dependency = join(args[0].dir, 'node_modules', 'private-dependency')
    await mkdir(dependency)
    await writeFile(join(dependency, 'index.js'), 'export const privateValue = 42')
    await symlink(dependency, join(args[0].dir, 'node_modules', 'private-alias'), process.platform === 'win32' ? 'junction' : 'dir')
    return result
  })
  const mutation = await f.backend.install(f.request)
  const installed = await realpath(join(f.profile.dir, 'node_modules', name))
  expect(await readFile(join(installed, '..', 'private-alias', 'index.js'), 'utf8')).toContain('privateValue = 42')
  await mutation.rollback()
})

it('does not project a plugin through a shared node_modules symlink', async () => {
  const f = await fixture()
  const shared = join(f.profile.home, 'shared-host-modules')
  await mkdir(shared)
  await symlink(shared, join(f.profile.dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(f.backend.install(f.request)).rejects.toThrow('own dependency directory')
  expect(f.runPnpm).not.toHaveBeenCalled()
})

it('restores the old package link and manifest if publication cannot save the profile', async () => {
  const f = await fixture()
  await f.backend.install(f.request)
  const oldTarget = await realpath(join(f.profile.dir, 'node_modules', name))
  const before = await readFile(join(f.profile.dir, 'package.json'), 'utf8')
  vi.mocked(saveManifest).mockRejectedValueOnce(new Error('fixture profile write failure'))
  await expect(f.backend.install(f.request)).rejects.toThrow('fixture profile write failure')
  expect(await realpath(join(f.profile.dir, 'node_modules', name))).toBe(oldTarget)
  expect(await readFile(join(f.profile.dir, 'package.json'), 'utf8')).toBe(before)
  expect(await readdir(join(f.profile.home, 'workbench-packages'))).toHaveLength(1)
})
