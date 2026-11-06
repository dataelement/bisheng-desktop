import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { preparePptWebPackage } from '../scripts/pack-ppt-web.mjs'
import { Context } from '@deepseek-ai/cordis'

const script = fileURLToPath(new URL('../scripts/pack-ppt-web.mjs', import.meta.url))
const roots = []
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const hash = createHash('sha256').update(jpeg).digest('hex')

async function put(file, content) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ppt-web-pack-'))
  roots.push(root)
  const staging = path.join(root, '.build/ppt-runtime/packages')
  const core = path.join(staging, 'dsh-ppt')
  const adapter = path.join(staging, 'dsh-ppt-composer')
  const coreManifest = {
    name: 'dsh-ppt', version: '0.1.1-rc.2', private: true, type: 'module', main: 'lib/index.js',
    engines: { node: '>=22.19.0' },
    dependencies: {}, peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.1-rc.1' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
  }
  const adapterManifest = {
    name: 'dsh-ppt-composer', version: '0.1.1-rc.2', private: true, type: 'module', main: 'lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    files: ['lib', 'skills', 'cordis.patch.yml', 'LICENSE', 'licenses'],
    scripts: { prepack: 'node -e "process.exit(47)"', postinstall: 'node -e "process.exit(48)"' },
    dependencies: { 'dsh-ppt': '0.1.1-rc.2' }, peerDependencies: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inline: ['dsh-ppt/client-standard'], inject: ['host-ui'], platform: 'web' } }
  }
  await put(path.join(core, 'package.json'), JSON.stringify(coreManifest))
  await put(path.join(adapter, 'package.json'), JSON.stringify(adapterManifest))
  await put(path.join(core, 'lib/index.js'), 'import { readFile } from "node:fs/promises"; export async function seed() { return readFile(new URL("../skills/dsh-ppt/references/demo/seed/source/deck.pptd", import.meta.url), "utf8") }')
  await put(path.join(core, 'lib/types/index.d.ts'), 'export declare function seed(): Promise<string>')
  await put(path.join(core, 'lib/web-mode-policy.js'), 'export function installWebModePolicy(ctx, modes) { ctx.events.push(["policy", modes]); }')
  await put(path.join(core, 'lib/office-pptx-scope-policy.js'), 'export const scopePolicy = true')
  await put(path.join(core, 'lib/office-pptx-scope-policy.d.ts'), 'export declare const scopePolicy: true')
  await put(path.join(adapter, 'lib/index.js'), 'import * as core from "dsh-ppt"; export const seed = core.seed; export const name = "dsh-ppt-composer"; export const inject = ["connection", "tools", "connection"]; export async function apply(ctx, config) { await ctx.fixtureAdapterSetup(); ctx.events.push(["adapter", config]); if (config.fail) throw new Error("activation failed"); }')
  await put(path.join(adapter, 'lib/types/index.d.ts'), "import * as core from 'dsh-ppt'; export declare const seed: typeof core.seed")
  await put(path.join(adapter, 'lib/client.js'), 'window.__ModuleLoader__.load("dsh-ppt-composer/client", [], () => ({ apply() {} }))')
  const definitions = [{ id: 'demo', referenceDirectory: 'demo/seed', referencePageCount: 1 }]
  await put(path.join(core, 'lib/catalog.js'), '// Generated from fixture.\nexport const definitions = ' + JSON.stringify(definitions) + ';\nexport const semantics = {"demo":{}};\n')
  await put(path.join(core, 'lib/preview-manifest.js'), '// Generated from fixture.\nexport const previewFiles = ' + JSON.stringify({ [hash]: 'demo/seed/pages/01.jpg' }) + ';\n')
  const reference = path.join(core, 'skills/dsh-ppt/references/demo/seed')
  await put(path.join(reference, 'design.md'), 'seed design')
  for (const variant of ['source', 'source-zh']) {
    await put(path.join(reference, variant, 'deck.pptd'), 'version: v2\npages:\n  - pages/01.page\n')
    await put(path.join(reference, variant, 'pages/01.page'), 'elements: []')
  }
  await put(path.join(reference, 'pages/01.jpg'), jpeg)
  for (const directory of [core, adapter]) {
    await put(path.join(directory, 'LICENSE'), 'fixture license')
    await put(path.join(directory, 'licenses/upstream.md'), 'upstream attribution')
    await put(path.join(directory, 'cordis.patch.yml'), '- insert:\n    - name: ' + path.basename(directory) + '\n')
    await put(path.join(directory, 'node_modules/unwanted/index.js'), 'must not ship')
  }
  return { root, core, adapter, reference, coreManifest, adapterManifest }
}

async function changeManifest(directory, manifest) {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest))
}

function npm(args, cwd) {
  const npmCli = process.env.npm_execpath
  return execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd, encoding: 'utf8' })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('isolated Web PPT distribution experiment', () => {
  it('vendors generated core and keeps only composer discoverable without changing source inputs', async () => {
    const { root, core, adapter } = await fixture()
    const original = await Promise.all([core, adapter].map(dir => readFile(path.join(dir, 'package.json'), 'utf8')))
    const result = await preparePptWebPackage({ projectRoot: root })
    expect(result.templateCount).toBe(1)
    const manifest = JSON.parse(await readFile(path.join(result.packageDirectory, 'package.json'), 'utf8'))
    expect(manifest.private).toBe(true)
    expect(manifest.dependencies).not.toHaveProperty('dsh-ppt')
    expect(manifest.dsh.client).toEqual({ inject: ['host-ui'], platform: 'web' })
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.engines.node).toBe('>=22.19.0')
    expect(manifest.main).toBe('lib/web-index.js')
    expect(manifest.exports['.']).toBe('./lib/web-index.js')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-scope']).toBe(manifest.peerDependencies['@deepseek-ai/dsh-agent'])
    const vendor = path.join(result.packageDirectory, 'vendor/dsh-ppt')
    expect(JSON.parse(await readFile(path.join(vendor, 'package.json'), 'utf8'))).not.toHaveProperty('dsh')
    expect(await readFile(path.join(result.packageDirectory, 'lib/client.js'), 'utf8')).toBe(await readFile(path.join(adapter, 'lib/client.js'), 'utf8'))
    expect(await readFile(path.join(result.packageDirectory, 'lib/types/index.d.ts'), 'utf8')).toContain('../../vendor/dsh-ppt/lib/types/index.js')
    expect(await readFile(path.join(vendor, 'licenses/upstream.md'), 'utf8')).toBe('upstream attribution')
    await expect(readFile(path.join(vendor, 'node_modules/unwanted/index.js'))).rejects.toThrow()
    expect(await Promise.all([core, adapter].map(dir => readFile(path.join(dir, 'package.json'), 'utf8')))).toEqual(original)
  })

  it('merges core normal dependencies and exact peer ranges, including optional metadata', async () => {
    const f = await fixture()
    f.coreManifest.dependencies = { renderer: '^1.2.3', shared: '3.18.5' }
    f.adapterManifest.dependencies.shared = '3.18.5'
    f.coreManifest.peerDependencies = { ...f.coreManifest.peerDependencies, react: '^18.2.0', host: '^0.2.1-rc.1' }
    f.adapterManifest.peerDependencies = { host: '^0.2.1-rc.1' }
    f.coreManifest.peerDependenciesMeta = { host: { optional: true } }
    await changeManifest(f.core, f.coreManifest)
    await changeManifest(f.adapter, f.adapterManifest)
    const { packageDirectory } = await preparePptWebPackage({ projectRoot: f.root })
    const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ renderer: '^1.2.3', shared: '3.18.5' })
    expect(manifest.peerDependencies).toEqual({ ...f.coreManifest.peerDependencies, '@deepseek-ai/dsh-scope': '^0.2.1-rc.1' })
    expect(manifest.peerDependenciesMeta).toEqual({ host: { optional: true } })
  })

  it.each(['dependencies', 'peerDependencies'])('rejects differing %s instead of widening compatibility', async field => {
    const f = await fixture()
    f.coreManifest[field].shared = '^1.0.0'
    f.adapterManifest[field].shared = '^1.0.0 || ^2.0.0'
    await changeManifest(f.core, f.coreManifest)
    await changeManifest(f.adapter, f.adapterManifest)
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Conflicting ' + field)
  })

  it.each(['source/deck.pptd', 'source/pages/01.page', 'source-zh/deck.pptd', 'pages/01.jpg'])('rejects a missing seed resource: %s', async relative => {
    const f = await fixture()
    await rm(path.join(f.reference, relative))
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow()
    await expect(readFile(path.join(f.root, '.build/ppt-web/dsh-ppt-composer/package.json'))).rejects.toThrow()
  })

  it('rejects ungenerated catalog and stale preview bytes', async () => {
    const f = await fixture()
    const catalog = path.join(f.core, 'lib/catalog.js')
    const generated = await readFile(catalog, 'utf8')
    await writeFile(catalog, 'export const definitions = [];')
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Missing generated definitions')
    await writeFile(catalog, generated)
    await writeFile(path.join(f.reference, 'pages/01.jpg'), 'stale preview')
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Stale generated seed preview')
  })

  it.each(['web-mode-policy.js', 'office-pptx-scope-policy.js', 'office-pptx-scope-policy.d.ts'])('rejects staging without required Web policy: %s', async file => {
    const f = await fixture()
    await rm(path.join(f.core, 'lib', file))
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow(file)
  })

  it('preserves conditional exports typings while switching only the generated backend entry', async () => {
    const f = await fixture()
    f.adapterManifest.exports['.'] = { types: './lib/types/index.d.ts', default: './lib/index.js' }
    await changeManifest(f.adapter, f.adapterManifest)
    const { packageDirectory } = await preparePptWebPackage({ projectRoot: f.root })
    const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
    expect(manifest.exports['.']).toEqual({ types: './lib/types/index.d.ts', default: './lib/web-index.js' })
    expect(await readFile(path.join(f.adapter, 'lib/index.js'), 'utf8')).not.toContain('installWebModePolicy')
    expect(await readFile(path.join(f.adapter, 'package.json'), 'utf8')).not.toContain('web-index.js')
  })

  it('requires an unchanged agent peer range for the newly declared scope peer', async () => {
    const f = await fixture()
    delete f.coreManifest.peerDependencies['@deepseek-ai/dsh-agent']
    await changeManifest(f.core, f.coreManifest)
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Missing dsh-agent peer range')
    f.coreManifest.peerDependencies['@deepseek-ai/dsh-agent'] = '^0.2.1-rc.1'
    f.coreManifest.peerDependencies['@deepseek-ai/dsh-scope'] = '*'
    await changeManifest(f.core, f.coreManifest)
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Conflicting dsh-scope peer range')
  })

  it('rejects an ungenerated adapter client and unexpected backend import', async () => {
    const f = await fixture()
    await writeFile(path.join(f.adapter, 'lib/client.js'), '/* GENERATED_PPT_PREVIEWS */ {}')
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Adapter client has not been generated')
    await writeFile(path.join(f.adapter, 'lib/client.js'), 'generated client')
    await writeFile(path.join(f.adapter, 'lib/index.js'), 'export const wrong = true')
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Missing expected adapter core import')
  })

  it('replaces output without stale files and preserves the last directory on validation failure', async () => {
    const f = await fixture()
    const result = await preparePptWebPackage({ projectRoot: f.root })
    await put(path.join(result.packageDirectory, 'stale.txt'), 'old')
    await preparePptWebPackage({ projectRoot: f.root })
    await expect(readFile(path.join(result.packageDirectory, 'stale.txt'))).rejects.toThrow()
    await rm(path.join(f.reference, 'source/deck.pptd'))
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow()
    expect(await readFile(path.join(result.packageDirectory, 'vendor/dsh-ppt/skills/dsh-ppt/references/demo/seed/source/deck.pptd'), 'utf8')).toContain('version: v2')
  })

  it('rejects output outside .build or overlapping staging', async () => {
    const { root } = await fixture()
    for (const outputRoot of ['packages/output', '.build/ppt-runtime', '.build/ppt-runtime/packages/output']) {
      await expect(preparePptWebPackage({ projectRoot: root, outputRoot })).rejects.toThrow('Web output must be separate')
    }
  })

  it('rejects symlinks in package inputs', async () => {
    const f = await fixture()
    await symlink(f.core, path.join(f.adapter, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(preparePptWebPackage({ projectRoot: f.root })).rejects.toThrow('Symlink in staged package')
  })

  it('activates the generated wrapper with real Cordis and permits workingDirectory access during pre-step', async () => {
    const f = await fixture()
    await writeFile(path.join(f.adapter, 'lib/index.js'), 'import * as core from "dsh-ppt"; export const inject = ["connection", "tools", "connection"]; export async function apply(ctx) { await ctx.plugin({ apply(child) { child.provide("officeModes", { active: true }); } }); }')
    await writeFile(path.join(f.core, 'lib/web-mode-policy.js'), 'export function installWebModePolicy(ctx, modes) { ctx.on("agent/pre-step", async () => { if (modes.active) await ctx.workingDirectory.ensure(); }); }')
    const { packageDirectory } = await preparePptWebPackage({ projectRoot: f.root })
    const backend = await import(pathToFileURL(path.join(packageDirectory, 'lib/web-index.js')).href)
    const root = new Context()
    let calls = 0
    root.provide('connection', {})
    root.provide('tools', {})
    root.provide('workingDirectory', { async ensure() { calls++; return f.root } })
    const plugin = root.plugin(backend)
    try {
      await plugin
      await root.parallel('agent/pre-step')
      expect(calls).toBe(1)
      expect(backend.inject).toEqual(['connection', 'tools', 'workingDirectory'])
      const desktop = await import(pathToFileURL(path.join(packageDirectory, 'lib/index.js')).href)
      expect(desktop.inject).toEqual(['connection', 'tools', 'connection'])
    } finally {
      await plugin.dispose()
    }
  })

  it('CLI packs offline with lifecycle scripts disabled and the tarball imports after isolated installation', async () => {
    const f = await fixture()
    const output = execFileSync(process.execPath, [script], { cwd: f.root, encoding: 'utf8' })
    const packed = JSON.parse(output)
    expect(packed).toHaveLength(1)
    const files = packed[0].files.map(file => file.path)
    expect(files).toContain('vendor/dsh-ppt/skills/dsh-ppt/references/demo/seed/source/deck.pptd')
    expect(files).toContain('vendor/dsh-ppt/skills/dsh-ppt/references/demo/seed/pages/01.jpg')
    expect(files).toContain('vendor/dsh-ppt/lib/web-mode-policy.js')
    expect(files).toContain('vendor/dsh-ppt/lib/office-pptx-scope-policy.js')
    expect(files).toContain('vendor/dsh-ppt/lib/office-pptx-scope-policy.d.ts')
    expect(files).toContain('lib/web-index.js')
    expect(files.some(file => file.includes('node_modules'))).toBe(false)
    const isolated = path.join(f.root, 'isolated-install')
    await put(path.join(isolated, 'package.json'), JSON.stringify({ private: true, dependencies: { '@deepseek-ai/dsh-agent': 'file:../host-agent', '@deepseek-ai/dsh-scope': 'file:../host-scope' } }))
    for (const [directory, name] of [['host-agent', '@deepseek-ai/dsh-agent'], ['host-scope', '@deepseek-ai/dsh-scope']]) {
      await put(path.join(f.root, directory, 'package.json'), JSON.stringify({ name, version: '0.2.1-rc.1' }))
    }
    const tarball = path.join(f.root, '.build/ppt-web', packed[0].filename)
    npm(['install', tarball, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', path.join(f.root, '.build/npm-cache')], isolated)
    const installed = path.join(isolated, 'node_modules/dsh-ppt-composer')
    const backend = await import(pathToFileURL(path.join(installed, 'lib/web-index.js')).href)
    const events = []
    const modes = { state() {} }
    const context = { events, async fixtureAdapterSetup() { events.push(['ready']) }, get(name) { expect(name).toBe('officeModes'); return modes } }
    const config = { enabled: true }
    await backend.apply(context, config)
    expect(events).toEqual([['ready'], ['adapter', config], ['policy', modes]])
    expect(backend.name).toBe('dsh-ppt-composer')
    expect(backend.inject).toEqual(['connection', 'tools', 'workingDirectory'])
    events.length = 0
    await expect(backend.apply(context, { fail: true })).rejects.toThrow('activation failed')
    expect(events.map(event => event[0])).toEqual(['ready', 'adapter'])
    expect(await backend.seed()).toContain('version: v2')
    const imported = execFileSync(process.execPath, ['--input-type=module', '-e', 'const pkg = await import("dsh-ppt-composer"); console.log(await pkg.seed())'], { cwd: isolated, encoding: 'utf8' })
    expect(imported).toContain('version: v2')
    await expect(readFile(path.join(isolated, 'node_modules/dsh-ppt/package.json'))).rejects.toThrow()
    const client = await readFile(path.join(installed, 'lib/client.js'), 'utf8')
    expect(client).toBe(await readFile(path.join(f.adapter, 'lib/client.js'), 'utf8'))
  })
})
