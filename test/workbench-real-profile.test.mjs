import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { create } from 'tar'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { createGenerationPackageBackend } from '../packages/dsh-desktop-market-installer/generations/package-backend.mjs'
import { restrictCommunityPackageBackend } from '../packages/dsh-desktop-market-installer/enterprise-policy.mjs'
import { installEnterpriseWorkbench } from '../packages/dsh-desktop-workbenches/enterprise-install.mjs'

const require = createRequire(import.meta.url)
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('installs a verified workbench through the real Manager and generation backend in an isolated profile', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-workbench-real-'))
  roots.push(home)
  const profile = join(home, 'profiles', 'web')
  const pkg = join(home, 'fixture', 'package')
  await mkdir(profile, { recursive: true })
  await mkdir(pkg, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
  await writeFile(join(home, 'cordis.yml'), '[]\n')
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'fixture-enterprise-workbench', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(pkg, 'cordis.patch.yml'), '[]\n')
  const archive = join(home, 'workbench.tgz')
  await create({ gzip: true, file: archive, cwd: join(home, 'fixture') }, ['package'])
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'), npm_config_cache: join(home, 'npm-cache'), npm_config_registry: 'http://127.0.0.1:1', npm_config_offline: 'true' }
  const backend = restrictCommunityPackageBackend(createGenerationPackageBackend({
    dshHome: home, dshEntryPath: require.resolve('@deepseek-ai/dsh/lib/bin.js'),
    nodeExecutablePath: process.execPath, pnpmEntryPath: resolve('node_modules/pnpm/bin/pnpm.cjs'), environment: env
  }), { authorizePluginMutation: async () => { throw new Error('POLICY_DISABLED') } })
  const ctx = new Context()
  const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(home + '/').href })
  await loader
  await mountRootInclude(ctx, join(home, 'cordis.yml'), [])
  await ctx.loader.await()
  ctx.provide('profileContext', { dir: profile, home, cwd: home, overlays: [], name: 'web', patchPath: join(profile, 'cordis.patch.yml'), startedBundles: [], installAnchor: resolve('node_modules/@deepseek-ai/dsh/package.json') })
  ctx.provide('profileBundlePackageBackend', backend)
  const fiber = ctx.plugin(PluginManager, {})
  await fiber
  let released = false
  try {
    expect(ctx.pluginManager.verifiedInstallContract).toBe(1)
    const mismatch = await installEnterpriseWorkbench(ctx.pluginManager, { open: async () => ({ path: archive, packageName: 'fixture-enterprise-workbench', version: '9.0.0', release: () => { released = true } }) }, 'a'.repeat(32))
    expect(mismatch.status).toBe(409)
    expect(released).toBe(true)
    expect(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual([])
    released = false
    const response = await installEnterpriseWorkbench(ctx.pluginManager, { open: async () => ({ path: archive, packageName: 'fixture-enterprise-workbench', version: '1.0.0', release: () => { released = true } }) }, 'a'.repeat(32))
    expect(response, JSON.stringify(response)).toMatchObject({ status: 200, body: { result: { bundle: 'fixture-enterprise-workbench', stage: 'enable' } } })
    expect(released).toBe(true)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('fixture-enterprise-workbench')
    expect((await ctx.pluginManager.listBundles()).find(row => row.name === 'fixture-enterprise-workbench')).toMatchObject({ installed: true, enabled: true })
  } finally { await fiber.dispose(); await loader.dispose() }
}, 60000)
