import { describe, expect, it, vi } from 'vitest'
import { installEnterpriseWorkbench } from '../packages/dsh-desktop-workbenches/enterprise-install.mjs'
import { apply } from '../packages/dsh-desktop-workbenches/index.js'

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
    const manager = { verifiedInstallContract: 1, listBundles: vi.fn(async () => []), installBundle: vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: 'company-workbench' })) }
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
