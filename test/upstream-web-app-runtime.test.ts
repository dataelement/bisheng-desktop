import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'
import { ensureSafeModeProfile, SAFE_MODE_PROFILE } from '../src/main/state/safe-mode-profile'
import { resolveTestNodeExecutable } from './node-executable'

it('boots official core bundles and serves their bootstrap', async () => {
  const root = resolve(import.meta.dirname, '..')
  const home = await mkdtemp(join(tmpdir(), 'dsh-upstream-web-'))
  const emptyPatch = join(home, 'empty.patch.yml')
  const hook = join(home, 'guard.mjs')
  await writeFile(emptyPatch, '[]\n')
  // This guard covers bare package specifiers, not absolute imports or the client graph.
  await writeFile(hook, `
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, next) {
  if (!specifier.startsWith('file:') && !specifier.startsWith('/') && /dsh-desktop|bisheng|enterprise/i.test(specifier)) {
    throw new Error('Unexpected desktop or enterprise import: ' + specifier)
  }
  return next(specifier, context)
} })
`)
  const runtime = new HarnessRuntime({
    dshEntryPath: join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    nodeEntryPath: join(root, 'build/harness-node-entry.mjs'),
    nodeExecutablePath: resolveTestNodeExecutable(),
    dshPatchPath: emptyPatch,
    dshSafePatchPath: emptyPatch,
    dshHome: home,
    logPath: join(home, 'harness.log'),
    startupTimeoutMs: 30_000,
    launchProcess: (executable, args, options) => spawn(executable, ['--import', pathToFileURL(hook).href, ...args], options),
    onChanged() {}
  })
  try {
    await ensureSafeModeProfile(home)
    const manifest = JSON.parse(await readFile(join(home, 'profiles', SAFE_MODE_PROFILE, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    await runtime.start(home, SAFE_MODE_PROFILE)
    const state = runtime.snapshot()
    expect(state.phase, state.logs.join('\n')).toBe('ready')
    expect(state.logs.join('\n')).not.toContain('Unexpected desktop or enterprise import')
    const { url, authToken } = state
    if (!url || !authToken) throw new Error('Missing runtime endpoint or token')
    expect((await fetch(url)).status).toBe(401)
    const login = await fetch(`${url}/?token=${encodeURIComponent(authToken)}`, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    expect(cookie).toBeTruthy()
    const page = await fetch(url, { headers: { Cookie: cookie } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const html = await page.text()
    const bootstrap = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)]
      .map((match) => match[1])
      .find((src) => src?.includes('plugins/??@deepseek-ai/dsh-client-modules/client.js'))
    expect(bootstrap).toBeDefined()
    if (!bootstrap) throw new Error('Missing bootstrap script')
    const script = await fetch(new URL(bootstrap.replaceAll('&amp;', '&'), url), { headers: { Cookie: cookie } })
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toMatch(/javascript/)
    const registrations: { id: string }[] = []
    runInNewContext(await script.text(), { window: { __ModuleLoader__: { load: (item: { id: string }) => registrations.push(item) } } })
    expect(registrations.map((item) => item.id)).toContain('@deepseek-ai/dsh-client-modules')
  } finally {
    await runtime.stop()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 80_000)
