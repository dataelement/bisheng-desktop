import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { restrictCommunityPackageBackend } from '../packages/dsh-desktop-market-installer/enterprise-policy.mjs'

const localDirectory = join(tmpdir(), 'local-plugin')
const localArchive = join(tmpdir(), 'local-plugin.tgz')

describe('enterprise admission on the official package backend', () => {
  it.each(['registry', 'git'])('rejects a %s install before touching the backend', async kind => {
    const install = vi.fn()
    const backend = restrictCommunityPackageBackend({ install })
    await expect(backend.install({ kind, spec: 'demo-plugin@1.0.0' })).rejects.toThrow('POLICY_DISABLED')
    expect(install).not.toHaveBeenCalled()
  })

  it('rejects a remote tarball and a path that is not absolute', async () => {
    const install = vi.fn()
    const backend = restrictCommunityPackageBackend({ install })
    await expect(backend.install({ kind: 'path', spec: 'demo-plugin' })).rejects.toThrow('POLICY_DISABLED')
    await expect(backend.install({
      kind: 'tarball',
      spec: 'https://example.com/plugin.tgz',
      host: 'example.com'
    })).rejects.toThrow('POLICY_DISABLED')
    expect(install).not.toHaveBeenCalled()
  })

  it('does not trust a local archive path when the installed spec differs', async () => {
    const install = vi.fn()
    const backend = restrictCommunityPackageBackend({ install })
    for (const spec of ['https://example.com/plugin.tgz', 'example@1.0.0', join(tmpdir(), 'other.tgz'), undefined]) {
      const request = { kind: 'tarball', path: localArchive, spec }
      await expect(backend.install(request)).rejects.toThrow('POLICY_DISABLED')
      await expect(backend.authorizeSpec(request)).resolves.toMatchObject({ status: 'refused' })
    }
    expect(install).not.toHaveBeenCalled()
  })

  it('installs a local directory or local tarball without a network grant', async () => {
    const install = vi.fn(async () => ({ ok: true }))
    const backend = restrictCommunityPackageBackend({ install })
    await backend.install({ kind: 'path', path: localDirectory, spec: localDirectory })
    await backend.install({ kind: 'tarball', path: localArchive, spec: localArchive })
    await backend.install({ kind: 'tarball', path: localArchive, spec: `file:${localArchive}` })
    expect(install).toHaveBeenCalledTimes(3)
  })

  it('releases quarantine only after a successful backend result', async () => {
    const releaseQuarantine = vi.fn()
    const install = vi.fn()
    const backend = restrictCommunityPackageBackend({ install }, { authorizePluginMutation: async () => {} }, { releaseQuarantine })
    const request = { kind: 'registry', spec: 'demo@1.0.0', expectedName: 'demo' }
    for (const result of [undefined, { packageResult: { exitCode: 1, output: 'POLICY_DISABLED' } }, { packageResult: { exitCode: 0, timedOut: true } }, {}]) {
      install.mockResolvedValueOnce(result)
      expect(await backend.install(request)).toBe(result)
      expect(releaseQuarantine).not.toHaveBeenCalled()
    }
    install.mockRejectedValueOnce(new Error('backend failed'))
    await expect(backend.install(request)).rejects.toThrow('backend failed')
    expect(releaseQuarantine).not.toHaveBeenCalled()
    install.mockResolvedValueOnce({ packageResult: { exitCode: 0 } })
    await backend.install(request)
    expect(releaseQuarantine).toHaveBeenCalledExactlyOnceWith('demo')
  })

  it('keeps quarantine when recording a switch fails', async () => {
    const releaseQuarantine = vi.fn()
    const backend = restrictCommunityPackageBackend({ switched: async () => { throw new Error('switch failed') } }, undefined, {
      releaseQuarantine, isPhysicallyInstalled: async () => true
    })
    await expect(backend.switched({ name: 'demo', enabled: true })).rejects.toThrow('switch failed')
    expect(releaseQuarantine).not.toHaveBeenCalled()
  })

  it('refuses a network spec before inspection and lets a local path continue', async () => {
    const backend = restrictCommunityPackageBackend({ install: vi.fn() })
    await expect(backend.authorizeSpec({ kind: 'registry', spec: 'demo-plugin', name: 'demo-plugin' }))
      .resolves.toMatchObject({
        status: 'refused',
        problem: 'unknown',
        reason: 'POLICY_DISABLED: current enterprise has not opened network plugin installation.',
        registries: []
      })
    await expect(backend.authorizeSpec({ kind: 'path', path: localDirectory, spec: localDirectory }))
      .resolves.toBeUndefined()
  })

  it('enables official, protected, and locally installed plugins, and blocks a network one', async () => {
    const switched = vi.fn()
    const remove = vi.fn()
    const removed = vi.fn()
    const releaseQuarantine = vi.fn()
    const backend = restrictCommunityPackageBackend({ switched, remove, removed }, undefined, {
      releaseQuarantine,
      isOfficialBundle: async (name) => name === '@deepseek-ai/dsh-experimental-auto-review',
      isLocallyInstalled: async (name) => name === 'local-plugin',
      isPhysicallyInstalled: async (name) => name === 'installed-plugin'
    })

    await backend.authorizeSwitch({ name: '@deepseek-ai/dsh-experimental-auto-review', enabled: true })
    await backend.authorizeSwitch({ name: 'local-plugin', enabled: true })
    await backend.authorizeSwitch({ name: 'dsh-desktop-workbenches', enabled: true })
    await backend.authorizeSwitch({ name: 'dshmarket', enabled: false })
    await expect(backend.authorizeSwitch({ name: 'dshmarket', enabled: true })).rejects.toThrow('POLICY_DISABLED')
    await backend.authorizeSwitch({ name: 'installed-plugin', enabled: true })
    await expect(backend.authorizeSwitch({ name: 'missing-plugin', enabled: true })).rejects.toThrow('POLICY_DISABLED')

    await backend.switched({ name: '@deepseek-ai/dsh-experimental-auto-review', enabled: true })
    await backend.switched({ name: 'local-plugin', enabled: true })
    await backend.switched({ name: 'installed-plugin', enabled: true })
    await backend.switched({ name: 'dshmarket', enabled: false })
    await backend.switched({ name: 'dshmarket', enabled: true })
    await backend.remove({ name: 'dshmarket' })
    await backend.removed({ name: 'dshmarket' })

    expect(releaseQuarantine).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-auto-review')
    expect(releaseQuarantine).toHaveBeenCalledWith('local-plugin')
    expect(releaseQuarantine).toHaveBeenCalledWith('installed-plugin')
    expect(releaseQuarantine).not.toHaveBeenCalledWith('dshmarket')
    expect(switched).toHaveBeenCalledTimes(5)
    expect(remove).toHaveBeenCalledWith({ name: 'dshmarket' })
    expect(removed).toHaveBeenCalledWith({ name: 'dshmarket' })
  })
})
