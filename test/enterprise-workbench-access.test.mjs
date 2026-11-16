// F022: installed enterprise workbenches follow the administrator's grants.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchMarketController } from '../packages/dsh-desktop-enterprise/workbench-market.js'
import { checkEnterpriseWorkbenchAccess, createEnterpriseInstallStore } from '../packages/dsh-desktop-workbenches/enterprise-access.mjs'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-access-'))
  roots.push(root)
  return { root, installs: createEnterpriseInstallStore(root) }
}
// The host-side Plugin Manager service answers ChangeResult values directly.
function manager() {
  return { setBundleEnabled: vi.fn(async () => ({ application: 'applied' })) }
}

describe('installed workbench access request', () => {
  const account = (marketRequest) => ({ state: () => ({ connected: true, connectionKey: 'account-a' }), marketRequest })

  it('posts the installed ids and returns one boolean per id', async () => {
    const marketRequest = vi.fn(async () => ({ status_code: 200, data: { [A]: true, [B]: false } }))
    const result = await createWorkbenchMarketController(account(marketRequest)).checkAccess([A, B])
    expect(result).toEqual({ [A]: true, [B]: false })
    expect(marketRequest).toHaveBeenCalledWith('/api/v1/dsh/market/workbenches/access', { workbench_ids: [A, B] })
  })

  it('rejects malformed ids and oversized requests before asking the server', async () => {
    const marketRequest = vi.fn()
    const controller = createWorkbenchMarketController(account(marketRequest))
    await expect(controller.checkAccess(['../etc'])).rejects.toThrow(/identifier/)
    await expect(controller.checkAccess(Array.from({ length: 501 }, (_, index) => index.toString(16).padStart(32, '0')))).rejects.toThrow(/at most/)
    expect(marketRequest).not.toHaveBeenCalled()
  })

  it('treats any answer without a boolean for every id as a failure', async () => {
    for (const data of [{ [A]: true }, { [A]: 'yes', [B]: false }, null]) {
      const controller = createWorkbenchMarketController(account(async () => ({ status_code: 200, data })))
      await expect(controller.checkAccess([A, B])).rejects.toThrow(/access/)
    }
    const failing = createWorkbenchMarketController(account(async () => { throw new Error('Enterprise market request failed (404).') }))
    await expect(failing.checkAccess([A])).rejects.toThrow()
  })
})

describe('enterprise install records', () => {
  it('persists each installed enterprise workbench by its catalog id', async () => {
    const { root, installs } = await store()
    await installs.record({ id: A, pluginName: 'mind-workbench', version: '1.0.0' })
    expect(await installs.read()).toMatchObject({ [A]: { id: A, pluginName: 'mind-workbench', version: '1.0.0' } })
    expect(JSON.parse(await readFile(join(root, 'enterprise-installs.json'), 'utf8'))[A].pluginName).toBe('mind-workbench')
  })

  it('ignores a damaged record file instead of failing the workbench page', async () => {
    const { root, installs } = await store()
    await writeFile(join(root, 'enterprise-installs.json'), '{ not json')
    expect(await installs.read()).toEqual({})
    await writeFile(join(root, 'enterprise-installs.json'), JSON.stringify({ [A]: { id: B, pluginName: 'x' }, bad: 1 }))
    expect(await installs.read()).toEqual({})
  })
})

describe('installed workbench access check', () => {
  it('disables a revoked workbench without uninstalling it and remembers why', async () => {
    const { installs } = await store()
    await installs.record({ id: A, pluginName: 'kept', version: '1.0.0' })
    await installs.record({ id: B, pluginName: 'revoked', version: '1.0.0' })
    const plugins = manager()
    const result = await checkEnterpriseWorkbenchAccess({ installs, access: async () => ({ [A]: true, [B]: false }), manager: plugins })
    expect(result).toEqual({ status: 'checked', revoked: ['revoked'] })
    expect(plugins.setBundleEnabled).toHaveBeenCalledTimes(1)
    expect(plugins.setBundleEnabled).toHaveBeenCalledWith('revoked', false)
    expect((await installs.read())[B]).toMatchObject({ pluginName: 'revoked', revoked: true })
  })

  it('clears the reason when access returns but leaves the workbench off for the employee to enable', async () => {
    const { installs } = await store()
    await installs.record({ id: B, pluginName: 'revoked', version: '1.0.0' })
    const plugins = manager()
    await checkEnterpriseWorkbenchAccess({ installs, access: async () => ({ [B]: false }), manager: plugins })
    const result = await checkEnterpriseWorkbenchAccess({ installs, access: async () => ({ [B]: true }), manager: plugins })
    expect(result).toEqual({ status: 'checked', revoked: [] })
    expect(plugins.setBundleEnabled).toHaveBeenCalledTimes(1)
    expect((await installs.read())[B]).not.toHaveProperty('revoked')
  })

  it('keeps every workbench as it was when access cannot be confirmed', async () => {
    const { installs } = await store()
    await installs.record({ id: A, pluginName: 'kept', version: '1.0.0' })
    await installs.record({ id: B, pluginName: 'revoked', version: '1.0.0' })
    await checkEnterpriseWorkbenchAccess({ installs, access: async () => ({ [A]: true, [B]: false }), manager: manager() })
    const plugins = manager()
    const result = await checkEnterpriseWorkbenchAccess({ installs, access: async () => { throw new Error('offline') }, manager: plugins })
    expect(result).toEqual({ status: 'unknown', revoked: ['revoked'] })
    expect(plugins.setBundleEnabled).not.toHaveBeenCalled()
    expect((await installs.read())[A]).not.toHaveProperty('revoked')
  })

  it('does not ask the server when nothing came from the enterprise', async () => {
    const { installs } = await store()
    const access = vi.fn()
    expect(await checkEnterpriseWorkbenchAccess({ installs, access, manager: manager() })).toEqual({ status: 'checked', revoked: [] })
    expect(access).not.toHaveBeenCalled()
  })

  it('reports a failed disable instead of marking the workbench revoked', async () => {
    const { installs } = await store()
    await installs.record({ id: B, pluginName: 'revoked', version: '1.0.0' })
    const plugins = { setBundleEnabled: vi.fn(async () => ({ application: 'failed', error: { diagnostic: 'busy' } })) }
    await expect(checkEnterpriseWorkbenchAccess({ installs, access: async () => ({ [B]: false }), manager: plugins })).rejects.toThrow(/busy/)
    expect((await installs.read())[B]).not.toHaveProperty('revoked')
  })
})
