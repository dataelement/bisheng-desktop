import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'
import { resolveTestNodeExecutable } from './node-executable'

it('updates the authenticated model catalog when the official key is stored and removed', async () => {
  const root = resolve(import.meta.dirname, '..')
  const home = await mkdtemp(join(tmpdir(), 'dsh-model-credentials-'))
  const profile = join(home, 'profiles', 'web')
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('DSH_DESKTOP_ENTERPRISE_BROKER_URL', '')
  vi.stubEnv('DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY', '')
  const runtime = new HarnessRuntime({
    dshEntryPath: join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    nodeEntryPath: join(root, 'build/harness-node-entry.mjs'),
    nodeExecutablePath: resolveTestNodeExecutable(),
    dshPatchPath: join(root, 'build/dsh-desktop.patch.yml'),
    dshSafePatchPath: join(root, 'build/dsh-desktop-safe.patch.yml'),
    dshHome: home,
    logPath: join(home, 'runtime.log'),
    startupTimeoutMs: 30_000,
    launchProcess: (executable, args, options) => spawn(executable, args, options),
    onChanged() {}
  })
  try {
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'credential-catalog-test-profile', private: true, dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }
    }))
    await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
    await runtime.start(home)
    expect(runtime.snapshot().phase, runtime.snapshot().logs.join('\n')).toBe('ready')
    const { url, authToken } = runtime.snapshot()
    if (!url || !authToken) throw new Error('Harness endpoint is required')
    const login = await fetch(`${url}/?token=${encodeURIComponent(authToken)}`, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    let sequence = 0
    const invoke = async (method: string, args = {}) => {
      const response = await fetch(new URL(`/api/${method}`, url), {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: `catalog-${sequence++}`, method, payload: { args }
        })
      })
      expect(response.status).toBe(200)
      const envelope = await response.json()
      expect(envelope.error, JSON.stringify(envelope)).toBeUndefined()
      expect(envelope.result?.ok, JSON.stringify(envelope)).toBe(true)
      return envelope.result.value
    }
    const groups = async () => {
      const result = await invoke('session/modelCatalog')
      expect(result.groups, JSON.stringify(result)).toBeDefined()
      return result.groups as Array<{ id: string }>
    }
    expect((await groups()).map(group => group.id)).toEqual([])
    await invoke('credentials/set', { ref: 'DEEPSEEK_API_KEY', value: 'test-key-for-local-catalog-only' })
    expect((await groups()).map(group => group.id)).toContain('deepseek-official')
    await invoke('credentials/unset', { ref: 'DEEPSEEK_API_KEY' })
    expect((await groups()).map(group => group.id)).toEqual([])
  } finally {
    await runtime.stop()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
