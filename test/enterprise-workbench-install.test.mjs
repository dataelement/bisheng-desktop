import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installEnterpriseWorkbench } from '../packages/dsh-desktop-enterprise/workbench-install.js'
import { applyEnterpriseWorkbenchInstall as apply } from '../packages/dsh-desktop-enterprise/workbench-install.js'

const id = 'a'.repeat(32)

describe('enterprise install route availability', () => {
  it('fails closed without the verified provider and follows service lifecycle', async () => {
    const routes = new Map()
    let activate
    const connection = { fetch: { register: route => routes.set(route.path, route) } }
    apply({ connection, effect: fn => fn(), reflect: { provide() {} }, inject(deps, callback) {
      if (deps.includes('enterpriseWorkbenchPackages')) activate = callback
    } }, { root: '/unused' })
    const route = routes.get('/api/desktop-workbenches/enterprise-install')
    const request = () => new Request('http://localhost/api/desktop-workbenches/enterprise-install', { method: 'POST', body: JSON.stringify({ id }) })
    const unavailable = await route.fetch(request())
    expect(unavailable.status).toBe(503)
    expect((await unavailable.json()).error).toMatch(/verified enterprise package service/)
    expect(unavailable.headers.get('cache-control')).toBe('no-store')
    const release = vi.fn()
    const packages = { open: vi.fn(async () => ({ path: '/tmp/verified.tgz', packageName: 'company-workbench', version: '1.0.0', release })) }
    const manager = { verifiedInstallContract: 1, listBundles: vi.fn(async () => []), installBundle: vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: 'company-workbench', version: '1.0.0' })) }
    const dispose = activate({ pluginManager: manager, enterpriseWorkbenchPackages: packages })
    expect((await route.fetch(request())).status).toBe(200)
    expect(packages.open).toHaveBeenCalledWith(id)
    expect(manager.installBundle).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    dispose()
    expect((await route.fetch(request())).status).toBe(503)
    expect(manager.installBundle).toHaveBeenCalledOnce()
  })
})

describe('enterprise workbench install outcome', () => {
  it.each([undefined, false, 0, 2, '1'])('rejects unsupported manager contract %s before preparation or mutation', async contract => {
    const manager = { verifiedInstallContract: contract, listBundles: vi.fn(), installBundle: vi.fn() }
    const packages = { open: vi.fn() }
    await expect(installEnterpriseWorkbench(manager, packages, id)).rejects.toThrow('does not support verified enterprise installs')
    expect(packages.open).not.toHaveBeenCalled()
    expect(manager.listBundles).not.toHaveBeenCalled()
    expect(manager.installBundle).not.toHaveBeenCalled()
  })

  it.each([
    { application: 'applied', stage: 'enable', bundle: 'other' },
    { application: 'restart-required', stage: 'install', bundle: 'company-workbench' }
  ])('rejects success without matching enable evidence: %o', async result => {
    const release = vi.fn()
    const packages = { open: vi.fn(async () => ({ path: '/tmp/verified.tgz', packageName: 'company-workbench', version: '1.0.0', release })) }
    const manager = { verifiedInstallContract: 1, listBundles: vi.fn(async () => []), installBundle: vi.fn(async () => result) }
    await expect(installEnterpriseWorkbench(manager, packages, id)).rejects.toThrow('unexpected installation outcome')
    expect(manager.installBundle).toHaveBeenCalledWith('/tmp/verified.tgz', { enabled: true, expectedName: 'company-workbench', expectedVersion: '1.0.0', replace: false })
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases the artifact when the Manager rejects the install', async () => {
    const release = vi.fn()
    const packages = { open: vi.fn(async () => ({ path: '/tmp/verified.tgz', packageName: 'company-workbench', version: '1.0.0', release })) }
    const manager = { verifiedInstallContract: 1, listBundles: vi.fn(async () => []), installBundle: vi.fn(async () => { throw new Error('backend unavailable') }) }
    await expect(installEnterpriseWorkbench(manager, packages, id)).rejects.toThrow('backend unavailable')
    expect(release).toHaveBeenCalledOnce()
  })
})

it('reports same-package replacement as restart-required even if the manager reports applied', async () => {
  const release = vi.fn()
  const packages = { open: async () => ({ path: '/tmp/verified.tgz', packageName: 'company-workbench', version: '1.1.0', release }) }
  const manager = { verifiedInstallContract: 1, listBundles: async () => [{ name: 'company-workbench', installed: true }],
    installBundle: vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: 'company-workbench', version: '1.1.0' })) }
  const response = await installEnterpriseWorkbench(manager, packages, id)
  expect(response).toMatchObject({ status: 200, body: { application: 'restart-required', restartRequired: true, restartReason: 'package-moved', install: { version: '1.1.0' } } })
  expect(manager.installBundle).toHaveBeenCalledWith('/tmp/verified.tgz', { enabled: true, expectedName: 'company-workbench', expectedVersion: '1.1.0', replace: true })
  expect(release).toHaveBeenCalledOnce()
})

describe('enterprise install input and cleanup boundary', () => {
  function fixture() {
    const release = vi.fn()
    const artifact = { path: '/tmp/verified.tgz', packageName: 'company-workbench', version: '1.0.0', release }
    const packages = { open: vi.fn(async () => artifact) }
    const manager = { verifiedInstallContract: 1, listBundles: vi.fn(async () => []), installBundle: vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: artifact.packageName, version: artifact.version })) }
    return { artifact, packages, manager, release }
  }

  it.each(['1.0.0', '2.0.0-rc.1', '1.0.0+build.1'])('preserves exact artifact version %s including prerelease/build metadata', async version => {
    const { manager, packages, artifact, release } = fixture()
    artifact.version = version
    const response = await installEnterpriseWorkbench(manager, packages, id)
    expect(manager.installBundle.mock.calls[0][1].expectedVersion).toBe(version)
    expect(response.body.install.version).toBe(version)
    expect(release).toHaveBeenCalledOnce()
  })

  it.each(['../file.tgz', '/tmp/file.tgz', 'company-workbench@1.0.0', 'A'.repeat(32), '', null])('rejects non-catalog identity %s without opening an artifact', async value => {
    const { manager, packages } = fixture()
    await expect(installEnterpriseWorkbench(manager, packages, value)).rejects.toThrow('workbench is required')
    expect(packages.open).not.toHaveBeenCalled()
    expect(manager.installBundle).not.toHaveBeenCalled()
  })

  it.each([{ path: 'relative.tgz' }, { path: 'https://example.test/a.tgz' }, { packageName: '../package' }, { packageName: 'name/subpath' }, { version: '^1.0.0' }, { version: '' }, { version: 'v1.0.0' }])('releases invalid provider metadata before package mutation: %o', async invalid => {
    const { manager, packages, artifact, release } = fixture()
    Object.assign(artifact, invalid)
    await expect(installEnterpriseWorkbench(manager, packages, id)).rejects.toThrow('could not be prepared')
    expect(manager.listBundles).not.toHaveBeenCalled()
    expect(manager.installBundle).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('binds service availability to real Cordis injection lifetime', async () => {
    const { manager, packages } = fixture()
    const routes = new Map()
    const ctx = new Context()
    ctx.provide('connection', { fetch: { register: route => routes.set(route.path, route) } })
    const registration = ctx.plugin(scope => apply(scope))
    await registration
    const route = routes.get('/api/desktop-workbenches/enterprise-install')
    const request = body => new Request('http://localhost/api/desktop-workbenches/enterprise-install', { method: 'POST', body: JSON.stringify(body) })
    expect((await route.fetch(request({ id }))).status).toBe(503)
    const provider = ctx.plugin(scope => {
      scope.provide('pluginManager', manager)
      scope.provide('enterpriseWorkbenchPackages', packages)
    })
    await provider
    await ctx.parallel('internal/runtime')
    expect((await route.fetch(request({ id }))).status).toBe(200)
    for (const payload of [{ id, spec: '/tmp/unverified.tgz' }, [], null, { id: '../artifact' }]) expect((await route.fetch(request(payload))).status).toBe(400)
    expect((await route.fetch(new Request('http://localhost/', { method: 'POST', body: 'not-json' }))).status).toBe(400)
    expect((await route.fetch(new Request('http://localhost/', { method: 'POST', body: ' '.repeat(4097) }))).status).toBe(413)
    expect(manager.installBundle).toHaveBeenCalledOnce()
    await provider.dispose()
    expect((await route.fetch(request({ id }))).status).toBe(503)
    await registration.dispose()
  })
})
