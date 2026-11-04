import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveHarnessPatchPaths } from '../src/main/harness-patch-paths'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'
import { inspectProfileBootInputs } from '../src/main/state/profile-boot-preflight'
import { SAFE_MODE_PROFILE } from '../src/main/state/safe-mode-profile'
import { projectRoot } from './patch-path'

it('uses injected product patches for preflight and runtime modes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-product-patches-'))
  const profile = join(home, 'profiles', 'web')
  const entry = join(projectRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  const enterprise = resolveHarnessPatchPaths({ normal: 'dsh-desktop.patch.yml', safe: 'dsh-desktop-safe.patch.yml', market: 'dsh-desktop-market.patch.yml' }, name => join(home, name))
  expect(enterprise).toEqual({
    dshPatchPath: join(home, 'dsh-desktop.patch.yml'),
    dshSafePatchPath: join(home, 'dsh-desktop-safe.patch.yml'),
    dshMarketPatchPath: join(home, 'dsh-desktop-market.patch.yml')
  })
  const paths = resolveHarnessPatchPaths({ normal: 'custom-normal.yml', safe: 'custom-safe.yml', market: 'custom-market.yml' }, name => join(home, name))
  const launches: string[][] = []
  const runtime = new HarnessRuntime({
    dshEntryPath: entry,
    nodeEntryPath: join(projectRoot, 'build/harness-node-entry.mjs'),
    nodeExecutablePath: process.execPath,
    ...paths,
    dshHome: home,
    logPath: join(home, 'harness.log'),
    startupTimeoutMs: 3000,
    launchProcess: (_executable, args, options) => {
      launches.push(args)
      return spawn(process.execPath, ['-e', 'process.exit(1)'], options)
    },
    onChanged() {}
  })
  try {
    const bundle = join(profile, 'node_modules', 'dsh-desktop-log-bridge')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-desktop-log-bridge', 'dshmarket'] } } }))
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'dsh-desktop-log-bridge', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(bundle, 'cordis.patch.yml'), '[]\n')
    await writeFile(paths.dshPatchPath, '- insert:\n    - id: dsh-desktop-log-bridge\n      name: dsh-desktop-log-bridge\n')
    await writeFile(paths.dshSafePatchPath, '[]\n')
    await writeFile(paths.dshMarketPatchPath, '[]\n')
    // Remove market from the manifest for the preflight, since it requires a real bundle.
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-desktop-log-bridge'] } } }))
    expect((await inspectProfileBootInputs(home, entry, paths.dshPatchPath))?.packageName).toBe('dsh-desktop-log-bridge')
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dshmarket'] } } }))
    await runtime.start(home)
    expect(launches).toHaveLength(1)
    const normalArgs = launches[0] ?? []
    expect(normalArgs).toContain(paths.dshMarketPatchPath)
    const normalOverlay = normalArgs[normalArgs.indexOf('--patch') + 1]
    if (!normalOverlay) throw new Error('Normal overlay was not passed')
    expect(await readFile(normalOverlay, 'utf8')).toContain('dsh-desktop-log-bridge')
    await runtime.stop()
    await runtime.start(home, SAFE_MODE_PROFILE)
    expect(launches).toHaveLength(2)
    expect(launches[1]).toContain(paths.dshSafePatchPath)
    expect(launches[1]).not.toContain(paths.dshMarketPatchPath)
    await runtime.stop()
    await rm(paths.dshMarketPatchPath)
    await runtime.start(home)
    expect(launches).toHaveLength(3)
    expect(launches[2]).not.toContain(paths.dshMarketPatchPath)
    await runtime.stop()
    await rm(paths.dshSafePatchPath)
    await runtime.start(home, SAFE_MODE_PROFILE)
    expect(runtime.snapshot().message).toBe('BISHENG patch was not found: ' + paths.dshSafePatchPath)
    await runtime.stop()
    await rm(paths.dshPatchPath)
    await runtime.start(home)
    expect(runtime.snapshot().phase).toBe('failed')
    expect(runtime.snapshot().message).toBe('BISHENG patch was not found: ' + paths.dshPatchPath)
    expect(launches).toHaveLength(3)
  } finally {
    await runtime.stop()
    await rm(home, { recursive: true, force: true })
  }
}, 30_000)
