import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopPnpmService } from '../packages/dsh-desktop-market-installer/market-executor.mjs'
import { createPublicCapabilityPolicy } from '../packages/dsh-desktop-market-installer/index.js'

describe('injected market executor', () => {
  it('requires both authorization callbacks', () => {
    const options = { binDirectory: '/tmp/bin', dshEntryPath: '/tmp/bin.js' }
    expect(() => createDesktopPnpmService(options)).toThrow('complete market operation policy')
    expect(() => createDesktopPnpmService({ ...options, policy: { authorizePluginMutation() {} } })).toThrow('complete market operation policy')
  })

  it('provides an open capability policy for public mode', async () => {
    const policy = createPublicCapabilityPolicy()
    expect(policy.snapshot()).toMatchObject({
      allowThirdPartyPlugins: true,
      allowThirdPartyWorkbenches: true,
      authoritative: true
    })
    await expect(policy.authorizePluginMutation()).resolves.toBeUndefined()
    await expect(policy.authorizeWorkbenchMarketInstall()).resolves.toBeUndefined()
  })

  it('rechecks authorization before a shared market mutation', async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'market-policy-')))
    let checks = 0
    let spawned = false
    const service = createDesktopPnpmService({
      home, binDirectory: join(home, 'bin'), dshEntryPath: join(home, 'bin.js'),
      policy: {
        authorizePluginMutation() { if (++checks === 2) throw new Error('revoked') },
        authorizeWorkbenchMarketInstall() {}
      },
      spawnProcess() { spawned = true; throw new Error('unexpected spawn') }
    })
    const handle = service.runExternalMarketPluginInstall(['add', 'dshmarket@1.0.0'], home)
    let error = ''
    handle.stderr.on('data', chunk => { error += chunk })
    expect(await handle.done).toEqual({ exitCode: 1, signal: null })
    expect(checks).toBe(2)
    expect(error).toContain('revoked')
    expect(spawned).toBe(false)
    await service.dispose()
  })

  it('denies market workbenches while retaining the local archive exception', async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'workbench-policy-')))
    const archive = join(home, 'workbench.tgz')
    await writeFile(archive, 'fixture')
    let installs = 0
    const service = createDesktopPnpmService({
      home, binDirectory: join(home, 'bin'), dshEntryPath: join(home, 'bin.js'),
      policy: {
        authorizePluginMutation() { throw new Error('denied') },
        authorizeWorkbenchMarketInstall() { throw new Error('denied') }
      },
      runGenerationInstall: async () => { installs++; return { code: 1, output: 'fixture stop' } }
    })
    const base = { expectedPluginName: 'example', expectedVersion: '1.0.0' }
    const denied = service.installWorkbenchGeneration({ ...base, pluginSpec: 'example@1.0.0' }, home)
    expect((await denied.done).exitCode).toBe(1)
    expect(installs).toBe(0)
    const local = service.installWorkbenchGeneration({ ...base, source: 'enterprise', path: archive, pluginSpec: archive }, home)
    expect((await local.done).exitCode).toBe(1)
    expect(installs).toBe(1)
    await service.dispose()
  })
})
