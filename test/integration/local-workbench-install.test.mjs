import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

// Explicit opt-in: this exercises an already prepared Web distribution, not the
// root rc.2 dependencies. Never builds, patches or starts a server implicitly.
const probeSource = `import assert from 'node:assert/strict'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { createWebPackageBackend } from './workbenches/web-package-backend.mjs'
import { localWorkbenchInstallTool } from './workbenches/local-install-tool.mjs'
import { localWorkbenchId } from './workbenches/identity.mjs'
const require = createRequire(import.meta.url)
const home = process.env.DSH_HOME
const archive = process.env.ACCEPTANCE_ARCHIVE
const meta = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-plugin-manager/package.json'), 'utf8'))
assert.equal(meta.version, '0.2.2-alpha.3')
await import('./workbenches/index.js')
const dir = join(home, 'profiles/web')
initProfile(dir, [])
const profile = { name: 'web', home, dir, cwd: home, installAnchor: require.resolve('@deepseek-ai/dsh/package.json'), packageManager: { command: process.execPath, args: [join(process.env.DSH_TEST_WEB_MODULES, 'pnpm', 'bin', 'pnpm.cjs')], env: { ...process.env, npm_config_offline: 'true', npm_config_store_dir: join(home, 'pnpm-store') } } }
const backend = createWebPackageBackend({ profile })
let snapshot
const observedBackend = { ...backend, install: request => { snapshot = request.path; return backend.install(request) } }
const manager = Object.assign(Object.create(PluginManager.prototype), {
 profile, ownerContext: { get: key => key === 'profileBundlePackageBackend' ? observedBackend : undefined, emit() {}, parallel: async () => {} },
 abort: new AbortController(), installs: new Map(), installedFrom: new Map(), packageOperations: new Set(), lockWaitMs: 2000,
 managementBundles: new Set(), protectsManager: () => false,
 publishAndReload: async () => ({ application: 'restart-required', restartReason: 'no-hmr' })
})
assert.ok((await readFile(require.resolve('@deepseek-ai/dsh-plugin-manager'), 'utf8')).includes('verifiedInstallContract = 1'))
const tool = localWorkbenchInstallTool({ pluginManager: manager, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) }, get: () => undefined, logger: console })
const execute = replace => tool.execute({ path: archive, replace }, { signal: new AbortController().signal, callId: 'acceptance-' + replace, agent: { session: {} } }).then(JSON.parse)
const first = await execute(false)
assert.equal(first.application, 'restart-required', JSON.stringify(first))
assert.equal(first.bundle, 'local-acceptance-probe')
assert.equal(first.stage, 'enable')
assert.notEqual(snapshot, archive)
await assert.rejects(stat(snapshot), { code: 'ENOENT' })
const link = join(dir, 'node_modules/local-acceptance-probe')
const old = await realpath(link)
assert.ok(old.startsWith(join(home, 'workbench-packages')))
const installed = JSON.parse(await readFile(join(link, 'package.json'), 'utf8'))
assert.equal(installed.repository, undefined)
assert.equal(localWorkbenchId(installed.name), 'local:local-acceptance-probe')
const before = await readFile(join(dir, 'package.json'), 'utf8')
const duplicate = await execute(false)
assert.equal(duplicate.application, 'failed', JSON.stringify(duplicate))
assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), before)
const update = await execute(true)
assert.equal(update.application, 'restart-required', JSON.stringify(update))
assert.notEqual(await realpath(link), old)
assert.equal((await readdir(join(home, 'workbench-packages'))).length, 2)
await stat(old)
await assert.rejects(stat(snapshot), { code: 'ENOENT' })
console.log(JSON.stringify({ version: meta.version, first: first.application, duplicate: duplicate.application, replacement: update.application, localIdentity: localWorkbenchId(installed.name), archiveCleanup: true }))
`

const staged = process.env.DSH_TEST_WEB_MODULES
it.skipIf(!staged)('installs a real npm-packed local archive through the staged Web manager and real pnpm', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-workbench-acceptance-')))
  try {
    const modules = resolve(staged)
    await symlink(modules, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    await cp(resolve('packages/dsh-desktop-workbenches'), join(root, 'workbenches'), { recursive: true })
    const source = join(root, 'source')
    await mkdir(source)
    const manifest = { name: 'local-acceptance-probe', version: '1.0.0', type: 'module',
      exports: { '.': './index.js', './client': './client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['dsh-desktop-workbenches'] } } }
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(source, 'index.js'), 'export function apply() {}\n')
    await writeFile(join(source, 'client.js'), 'window.__ModuleLoader__.load({ id: "local-acceptance-probe", factory: () => ({ apply() {} }) })\n')
    await writeFile(join(source, 'cordis.patch.yml'), '- insert:\n    - id: local-acceptance-probe\n      name: local-acceptance-probe\n')
    const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--ignore-scripts', '--offline'], {
      cwd: source, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, npm_config_cache: join(root, 'npm-cache'), npm_config_update_notifier: 'false' }
    })
    expect(pack.status, pack.stderr).toBe(0)
    const archive = join(source, JSON.parse(pack.stdout)[0].filename)
    const probe = join(root, 'probe.mjs')
    await writeFile(probe, probeSource)
    const run = spawnSync(process.execPath, [probe], { cwd: root, encoding: 'utf8', timeout: 90000,
      env: { ...process.env, DSH_HOME: join(root, 'home'), ACCEPTANCE_ARCHIVE: archive } })
    expect(run.status, run.stdout + '\n' + run.stderr).toBe(0)
    expect(JSON.parse(run.stdout.trim().split('\n').at(-1))).toMatchObject({ version: '0.2.2-alpha.3', archiveCleanup: true, localIdentity: 'local:local-acceptance-probe' })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120000)
