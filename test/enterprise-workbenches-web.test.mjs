import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareWorkbenchWebPackage } from '../scripts/pack-workbenches-web.mjs'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'workbench-web-'))
  roots.push(root)
  const source = path.join(root, 'packages/dsh-desktop-workbenches')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/js-yaml': { version: '4.3.2' } } }))
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-desktop-workbenches', type: 'module', main: './index.js', exports: { '.': './index.js', './client': './client.js' }, peerDependencies: { 'sample-peer': '1.0.0' } }))
  await writeFile(path.join(source, 'index.js'), "export const Config = { root: 'required' }; export function apply(ctx, config) { if (!config?.root) throw new Error('root required'); ctx.order.push(['native', config.root]) }\n")
  await writeFile(path.join(source, 'web-package-backend.mjs'), "export function registerWebPackageBackend(ctx) { ctx.order.push(['register']) }\n")
  await writeFile(path.join(source, 'client.js'), 'export {}')
  return { root, source }
}

describe('generated Web workbench distribution', () => {
  it('keeps Desktop untouched and registers the existing backend before native apply', async () => {
    const { root, source } = await fixture()
    const original = await readFile(path.join(source, 'package.json'), 'utf8')
    for (const name of ['assets', 'node_modules', '.git', '.cache', '.vite']) {
      await mkdir(path.join(source, name))
      await writeFile(path.join(source, name, 'sample'), 'fixture')
    }
    const result = await prepareWorkbenchWebPackage({ projectRoot: root })
    expect(result).toEqual({ outputRoot: path.join(root, '.build/workbenches-web'), packageDirectory: path.join(root, '.build/workbenches-web/dsh-desktop-workbenches') })
    const manifest = JSON.parse(await readFile(path.join(result.packageDirectory, 'package.json'), 'utf8'))
    expect(manifest.main).toBe('./web-index.js')
    expect(manifest.exports).toEqual({ '.': './web-index.js', './client': './client.js' })
    expect(manifest.peerDependencies).toEqual({ 'sample-peer': '1.0.0', '@deepseek-ai/dsh-app-boot': '0.2.2-rc.1', '@deepseek-ai/dsh-plugin-manager': '0.2.2-rc.1' })
    expect(manifest.dependencies['js-yaml']).toBe('4.3.2')
    expect(manifest.dsh?.bundle).toBeUndefined()
    expect(await readFile(path.join(source, 'package.json'), 'utf8')).toBe(original)
    expect(await readFile(path.join(result.packageDirectory, 'assets/sample'), 'utf8')).toBe('fixture')
    for (const name of ['node_modules', '.git', '.cache', '.vite']) await expect(lstat(path.join(result.packageDirectory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    const plugin = await import(pathToFileURL(path.join(result.packageDirectory, 'web-index.js')).href)
    const ctx = { order: [] }
    plugin.apply(ctx, { root: '/explicit-profile-root' })
    expect(ctx.order).toEqual([['register'], ['native', '/explicit-profile-root']])
    expect(plugin.Config).toEqual({ root: 'required' })
    expect(() => plugin.apply({ order: [] }, {})).toThrow('root required')
  })

  it('generates and bundles current maintained code and assets with declared Web dependencies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'workbench-current-'))
    roots.push(root)
    const source = path.resolve('packages/dsh-desktop-workbenches')
    await cp(source, path.join(root, 'packages/dsh-desktop-workbenches'), { recursive: true, filter: file => path.basename(file) !== 'node_modules' })
    await cp('package-lock.json', path.join(root, 'package-lock.json'))
    const original = await readFile(path.join(source, 'package.json'), 'utf8')
    const { packageDirectory } = await prepareWorkbenchWebPackage({ projectRoot: root })
    expect(await readFile(path.join(packageDirectory, 'index.js'), 'utf8')).toBe(await readFile(path.join(source, 'index.js'), 'utf8'))
    expect(await readFile(path.join(packageDirectory, 'assets/market-header.png'))).toEqual(await readFile(path.join(source, 'assets/market-header.png')))
    const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
    const bundle = await build({ entryPoints: [path.join(packageDirectory, 'web-index.js')], bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', write: false, metafile: true })
    expect(bundle.outputFiles[0].text).toContain('registerWebPackageBackend')
    expect(bundle.outputFiles[0].text).toContain('profileBundlePackageBackend')
    const imports = Object.values(bundle.metafile.outputs).flatMap(output => output.imports).filter(item => item.external && !item.path.startsWith('node:')).map(item => item.path)
    for (const spec of imports) {
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      expect({ ...manifest.peerDependencies, ...manifest.dependencies }[name], spec).toBeTruthy()
    }
    expect(await readFile(path.join(source, 'package.json'), 'utf8')).toBe(original)
  })

  it('imports the generated real package and retains required-root/native route behavior', async () => {
    await mkdir(path.resolve('.build'), { recursive: true })
    const outputRoot = await mkdtemp(path.resolve('.build/enterprise-workbench-web-test-'))
    roots.push(outputRoot)
    const { packageDirectory } = await prepareWorkbenchWebPackage({ projectRoot: process.cwd(), outputRoot })
    const plugin = await import(pathToFileURL(path.join(packageDirectory, 'web-index.js')).href)
    expect(() => plugin.Config({})).toThrow()
    const events = []
    const ctx = {
      connection: { fetch: { register: route => events.push(['route', route.path]) } },
      effect: callback => callback(), reflect: { provide: (name, value) => events.push(['provide', name, value]) },
      inject(names, callback) {
        if (!names.includes('profileContext')) return
        const scoped = {
          profileContext: { name: 'web', dir: path.join(outputRoot, 'profiles/web'), home: outputRoot },
          get: () => undefined, effect: callback => callback(), reflect: this.reflect
        }
        callback(scoped)
      }
    }
    plugin.apply(ctx, { root: path.join(outputRoot, 'workbenches') })
    expect(events[0]).toMatchObject(['provide', 'profileBundlePackageBackend', { supportsVerifiedInstall: true }])
    expect(events.some(row => row[0] === 'route' && row[1] === '/api/desktop-workbenches/state')).toBe(true)
    expect(events.some(row => row[0] === 'route' && row[1] === '/api/desktop-workbenches/enterprise-install')).toBe(false)
  })

  it('rejects output escapes, symlinked output/source, and missing dependency pins before replacement', async () => {
    const { root, source } = await fixture()
    await expect(prepareWorkbenchWebPackage({ projectRoot: root, outputRoot: source })).rejects.toThrow('beneath')
    await mkdir(path.join(root, '.build'))
    await symlink(source, path.join(root, '.build/alias'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(prepareWorkbenchWebPackage({ projectRoot: root, outputRoot: '.build/alias/output' })).rejects.toThrow('Symlink')
    const ready = await prepareWorkbenchWebPackage({ projectRoot: root })
    const before = await readFile(path.join(ready.packageDirectory, 'package.json'), 'utf8')
    await writeFile(path.join(root, 'package-lock.json'), '{}')
    await expect(prepareWorkbenchWebPackage({ projectRoot: root })).rejects.toThrow('locked js-yaml')
    expect(await readFile(path.join(ready.packageDirectory, 'package.json'), 'utf8')).toBe(before)
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/js-yaml': { version: '4.3.2' } } }))
    await symlink(path.join(source, 'index.js'), path.join(source, 'alias.js'))
    await expect(prepareWorkbenchWebPackage({ projectRoot: root })).rejects.toThrow('Symlink')
    expect(await readFile(path.join(ready.packageDirectory, 'package.json'), 'utf8')).toBe(before)
  })
})
