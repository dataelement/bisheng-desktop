import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManager, parseInstallSpec } from '@deepseek-ai/dsh-plugin-manager'
import { bundleManifest } from '@deepseek-ai/dsh-plugin-manager/operations'
import { readProfileManifest, resolveBundleDir, evaluatePluginCompatibility, readProfileVersionExemptions, bundlePatchPaths, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { addWebVerifiedInstalls, applyWebPluginManagerPatch } from '../scripts/web-plugin-manager.mjs'

// Verbatim alpha.3 install method. Keep this fixture independent of ignored local runtime staging.
import { pluginManagerAlpha3Source as upstream, pluginManagerAlpha3IndexTypes, pluginManagerAlpha3OptionsTypes } from './fixtures/plugin-manager-alpha3.mjs'
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

class ManagementFailure extends Error {}
class InstallCancelledError extends Error {}
function alphaClass() {
  const deps = { randomUUID, withFileLock, join: path.join, managementError: error => ({ diagnostic: error.message }), diagnosticVersion: value => value, installOperationTarget: value => value, parseInstallSpec, readProfileManifest, resolveBundleDir, bundleManifest, evaluatePluginCompatibility, readProfileVersionExemptions, bundlePatchPaths, loadOverlayPatches, ManagementFailure, InstallCancelledError,
    specPackageName: () => undefined,
    parsedForRegistry: parseInstallSpec, checkGithubConnection: async () => undefined, chooseGitTransport: async parsed => parsed.spec, registryPlan: () => [null], registryArguments: () => [], attributeFailure: () => 'other',
    incompatiblePlugin: value => value,
    bundleSelection: manifest => manifest.dsh?.profile?.bundles ?? [],
    recordPendingBuilds: async () => [] }
  // Evaluate the actual upstream method, retaining its native enable/configure tail.
  return new Function(...Object.keys(deps), 'return ' + addWebVerifiedInstalls(upstream))(...Object.values(deps))
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'web-manager-'))
  roots.push(root)
  const modules = path.join(root, 'node_modules')
  const dir = path.join(modules, '@deepseek-ai/dsh-plugin-manager')
  await mkdir(path.join(dir, 'lib/types'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-plugin-manager', version: '0.2.2-alpha.3' }))
  await writeFile(path.join(dir, 'lib/index.js'), upstream)
  await writeFile(path.join(dir, 'lib/types/index.d.ts'), pluginManagerAlpha3IndexTypes)
  await writeFile(path.join(dir, 'lib/types/types.d.ts'), pluginManagerAlpha3OptionsTypes)
  return { root, modules, dir }
}

async function managerFixture(backendOptions = {}) {
  const { root } = await fixture()
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
  const rollback = vi.fn()
  const events = []
  const install = vi.fn(async request => {
    request.onOutput('staging package', 'stdout')
    const target = path.join(root, 'node_modules', 'company-demo')
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'company-demo', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(path.join(target, 'cordis.patch.yml'), '[]\n')
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    manifest.dependencies['company-demo'] = 'link:./stage'
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
    return { bundle: 'company-demo', rollback, packageResult: { exitCode: 0, output: '', truncated: false, logPath: '/diagnostic' } }
  })
  const backend = { supportsVerifiedInstall: true, install, ...backendOptions }
  const manager = Object.assign(Object.create(PluginManager.prototype), {
    installBundle: alphaClass().prototype.installBundle, change: alphaClass().prototype.change,
    operationTarget: (_reason, target) => target, operationVersion: () => undefined, reportOperation: vi.fn(),
    profile: { dir: root, name: 'web', installAnchor: path.resolve('node_modules/@deepseek-ai/dsh/package.json'), startedBundles: [] },
    ownerContext: { get: name => name === 'profileBundlePackageBackend' ? backend : undefined, emit: (...args) => events.push(args), logger: { warn: vi.fn() } },
    abort: new AbortController(), installs: new Map(), installedFrom: new Map(), packageOperations: new Set(), lockWaitMs: 1000,
    managementBundles: new Set(), protectsManager: () => false,
    registries: vi.fn(async () => ({})),
    publishAndReload: vi.fn(async () => ({ warnings: [] })), runPnpm: vi.fn(() => { throw new Error('unexpected unverified pnpm') })
  })
  return { manager, backend, install, rollback, events, root }
}
const options = { expectedName: 'company-demo', expectedVersion: '1.0.0' }

describe('alpha.3 Web Plugin Manager patch', () => {
  it('replays JS and types without duplicate changes', async () => {
    const { modules, dir } = await fixture()
    await applyWebPluginManagerPatch(modules)
    const first = await readFile(path.join(dir, 'lib/index.js'), 'utf8')
    await applyWebPluginManagerPatch(modules)
    expect(await readFile(path.join(dir, 'lib/index.js'), 'utf8')).toBe(first)
    expect(await readFile(path.join(dir, 'lib/types/index.d.ts'), 'utf8')).toContain('readonly verifiedInstallContract: 1;')
    expect(await readFile(path.join(dir, 'lib/types/types.d.ts'), 'utf8')).toContain('expectedVersion?: string;')
    expect(addWebVerifiedInstalls(first)).toBe(first)
  })

  it('refuses rc.2 even when its package already advertises a verified contract', async () => {
    const { modules, dir } = await fixture()
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-plugin-manager', version: '0.2.1-rc.2' }))
    await expect(applyWebPluginManagerPatch(modules)).rejects.toThrow('expected 0.2.2-alpha.3')
    expect(await readFile(path.join(dir, 'lib/index.js'), 'utf8')).toBe(upstream)
  })

  it('rejects missing/ambiguous anchors and incomplete prior patches', () => {
    expect(() => addWebVerifiedInstalls(upstream.replace('version = manifest.version;', 'version = upstream.version;'))).toThrow('anchor')
    expect(() => addWebVerifiedInstalls(upstream + upstream)).toThrow('anchor')
    expect(() => addWebVerifiedInstalls(addWebVerifiedInstalls(upstream).replace('await mutation?.rollback?.();', ''))).toThrow('Incomplete')
  })

  it('validates declarations before changing JavaScript', async () => {
    const { modules, dir } = await fixture()
    await writeFile(path.join(dir, 'lib/types/types.d.ts'), 'upstream moved')
    await expect(applyWebPluginManagerPatch(modules)).rejects.toThrow('anchor')
    expect(await readFile(path.join(dir, 'lib/index.js'), 'utf8')).toBe(upstream)
  })

  it('forwards verified identity, logs, output and then selects the bundle', async () => {
    const { manager, install, events, rollback } = await managerFixture()
    const result = await manager.installBundle('/verified.tgz', { ...options, requestId: 'request-1' })
    expect(result).toMatchObject({ application: 'restart-required', stage: 'enable', bundle: 'company-demo', version: '1.0.0', packageResult: { logPath: '/diagnostic' } })
    expect(install.mock.calls[0][0]).toMatchObject({ ...options, kind: 'tarball', spec: '/verified.tgz', signal: expect.any(AbortSignal) })
    expect(events).toContainEqual(['plugin-manager/install-log', expect.objectContaining({ requestId: 'request-1', text: 'staging package' })])
    expect(manager.publishAndReload).toHaveBeenCalledOnce()
    expect(manager.packageOperations.size).toBe(0)
    expect(rollback).not.toHaveBeenCalled()
  })

  it.each([{ expectedName: 'different' }, { expectedVersion: '2.0.0' }])('rolls back a mismatched verified artifact: %o', async mismatch => {
    const { manager, rollback, root } = await managerFixture()
    const before = await readFile(path.join(root, 'package.json'), 'utf8')
    const result = await manager.installBundle('/verified.tgz', { ...options, ...mismatch })
    expect(result).toMatchObject({ application: 'failed', stage: 'install' })
    expect(result.error.diagnostic).toContain('identity does not match')
    expect(rollback).toHaveBeenCalledOnce()
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(before)
    expect(manager.publishAndReload).not.toHaveBeenCalled()
  })

  it.each([{}, { supportsVerifiedInstall: true, install: async () => undefined }])('never falls back when the verified backend is absent or declines', async backend => {
    const { manager } = await managerFixture(backend)
    manager.ownerContext.get = name => name === 'profileBundlePackageBackend' ? backend : undefined
    expect(await manager.installBundle('/verified.tgz', options)).toMatchObject({ application: 'failed', stage: 'install' })
    expect(manager.runPnpm).not.toHaveBeenCalled()
  })

  it('retains the installed package on native enable failure', async () => {
    const { manager, rollback, root } = await managerFixture()
    manager.publishAndReload.mockRejectedValueOnce(new Error('required service missing'))
    expect(await manager.installBundle('/verified.tgz', options)).toMatchObject({ application: 'failed', stage: 'enable', bundle: 'company-demo' })
    expect(rollback).not.toHaveBeenCalled()
    expect(readProfileManifest('test', root).dependencies['company-demo']).toBe('link:./stage')
  })

  it('checks cancellation after backend completion and restores package files', async () => {
    const { manager, install, rollback } = await managerFixture()
    const original = install.getMockImplementation()
    install.mockImplementationOnce(async request => { const result = await original(request); manager.abort.abort(); return result })
    expect(await manager.installBundle('/verified.tgz', options)).toMatchObject({ application: 'cancelled', stage: 'install' })
    expect(rollback).toHaveBeenCalledOnce()
    expect(manager.publishAndReload).not.toHaveBeenCalled()
  })
  it('keeps ordinary installs on the native pnpm path with a backend registered', async () => {
    const { manager, install } = await managerFixture()
    const stage = install.getMockImplementation()
    manager.runPnpm.mockImplementationOnce(async () => (await stage({ onOutput() {} })).packageResult)
    expect(await manager.installBundle('/ordinary.tgz')).toMatchObject({ application: 'restart-required', stage: 'enable' })
    expect(manager.runPnpm).toHaveBeenCalledOnce()
    expect(install).not.toHaveBeenCalled()
  })

  it.each([{ exitCode: 1 }, { timedOut: true }, { incompatible: [{ name: 'company-demo' }] }])('rolls back backend failure without activating: %o', async outcome => {
    const { manager, install, rollback } = await managerFixture()
    const stage = install.getMockImplementation()
    install.mockImplementationOnce(async request => {
      const mutation = await stage(request)
      return { ...mutation, pendingBuilds: ['native-addon'], packageResult: { ...mutation.packageResult, ...outcome } }
    })
    const result = await manager.installBundle('/verified.tgz', options)
    expect(result).toMatchObject({ application: 'failed', stage: 'install', packageResult: outcome })
    expect(rollback).toHaveBeenCalledOnce()
    expect(manager.publishAndReload).not.toHaveBeenCalled()
    if (!outcome.incompatible) expect(result.pendingBuilds).toEqual(['native-addon'])
  })

  it('requires explicit replacement then accepts a same-name verified update', async () => {
    const { manager, install, root } = await managerFixture()
    await manager.installBundle('/verified.tgz', options)
    install.mockClear()
    expect(await manager.installBundle('/verified.tgz', options)).toMatchObject({ application: 'failed', stage: 'install' })
    expect(install).not.toHaveBeenCalled()
    expect(await manager.installBundle('/verified.tgz', { ...options, replace: true })).toMatchObject({ application: 'restart-required', stage: 'enable' })
    expect(install).toHaveBeenCalledOnce()
    expect(readProfileManifest('test', root).dsh.profile.bundles).toEqual(['company-demo'])
  })

  it('checks manifest name as well as projection name', async () => {
    const { manager, install, rollback, root } = await managerFixture()
    const stage = install.getMockImplementation()
    install.mockImplementationOnce(async request => {
      const mutation = await stage(request)
      const file = path.join(root, 'node_modules/company-demo/package.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...manifest, name: 'alias-target' }))
      return mutation
    })
    expect(await manager.installBundle('/verified.tgz', options)).toMatchObject({ application: 'failed', stage: 'install' })
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('supports CLI replay and returns sanitized nonzero failures', async () => {
    const { modules, dir } = await fixture()
    const cli = (...args) => spawnSync(process.execPath, [path.resolve('scripts/web-plugin-manager.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    expect(cli(modules).status).toBe(0)
    expect(cli(modules).status).toBe(0)
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-plugin-manager', version: '0.2.1-rc.2' }))
    const rejected = cli(modules)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('unsupported or incomplete runtime package')
    expect(rejected.stderr).not.toContain(modules)
    expect(cli('relative/node_modules').status).toBe(1)
  })

})
