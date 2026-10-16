import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { create } from 'tar'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { readCommunityPackage } from '../packages/dsh-desktop-enterprise/community-package.js'
import { installOfflineBundle, sha256, verifyInstalledBundle } from '../packages/dsh-desktop-enterprise/offline-bundle.js'
import { createMarketRuntime } from '../packages/dsh-desktop-enterprise/market-runtime.js'
import { zipEntries } from '../scripts/pack-enterprise-plugin.mjs'

const roots: string[] = []
const target = `${process.platform}-${process.arch}`
const require = createRequire(import.meta.url)
const dshEntryPath = require.resolve('@deepseek-ai/dsh/lib/bin.js')
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function home() {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-community-'))
  roots.push(root)
  await mkdir(join(root, 'profiles/node_modules'), { recursive: true })
  return root
}
function plugin(fields: Record<string, unknown> = {}, extra: Record<string, Buffer> = {}) {
  const pkg = { name: 'company-demo', version: '1.1.0-beta.1', type: 'module', main: 'index.js', ...fields }
  const files = { 'package.json': Buffer.from(JSON.stringify(pkg)), 'index.js': Buffer.from('export function apply() {}'), ...extra }
  const bytes = zipEntries(files)
  return { bytes, files, expected: { name: pkg.name, version: pkg.version, digest: sha256(bytes) } }
}

describe('community packages in the enterprise market', () => {
  it('reads version and platform directly from package.json in a ZIP', async () => {
    const data = plugin({ os: [process.platform], cpu: [process.arch] })
    const parsed = await readCommunityPackage(data.bytes, data.expected, target)
    expect(parsed.manifest.plugin).toMatchObject({ name: 'company-demo', version: '1.1.0-beta.1', desktop_min: '' })
    expect(parsed.files.has('manifest.json')).toBe(false)
    await expect(readCommunityPackage(data.bytes, data.expected, 'unsupported-x64')).rejects.toThrow(/platform/)
  })

  it('installs an npm tgz package with bundled dependencies and detects changed dependencies', async () => {
    const root = await home(), data = plugin({ dependencies: { 'company-helper': '1.0.0' }, bundledDependencies: ['company-helper'] }, {
      'node_modules/company-helper/package.json': Buffer.from(JSON.stringify({ name: 'company-helper', version: '1.0.0', main: 'index.js' })),
      'node_modules/company-helper/index.js': Buffer.from('module.exports = 42')
    })
    for (const [path, bytes] of Object.entries(data.files)) {
      await mkdir(join(root, 'package', path, '..'), { recursive: true })
      await writeFile(join(root, 'package', path), bytes)
    }
    const path = join(root, 'plugin.tgz')
    await create({ cwd: root, gzip: true, file: path }, ['package'])
    const bytes = await readFile(path), expected = { ...data.expected, digest: sha256(bytes) }
    const generation = await installOfflineBundle(root, bytes, expected, target, { dshEntryPath })
    expect(generation.directory).toContain('.enterprise-generations')
    const helper = createRequire(join(generation.directory, 'node_modules/company-demo/package.json')).resolve('company-helper')
    expect(await readFile(helper, 'utf8')).toContain('42')
    await expect(verifyInstalledBundle({ ...generation, ...expected }, target)).resolves.toHaveProperty('manifest.schema_version', 2)
    await writeFile(helper, 'tampered')
    await expect(verifyInstalledBundle({ ...generation, ...expected }, target)).rejects.toThrow(/changed/)
  })

  it.each([false, true])('activates dsh.bundle with the real Loader and reports child failure (%s)', async failing => {
    const root = await home()
    const data = plugin({ bin: { 'company-demo': 'index.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }, {
      'manifest.json': Buffer.from('{"applicationAsset":true}'),
      'cordis.patch.yml': Buffer.from('- insert:\n    - id: community-entry\n      name: ./index.js\n'),
      ...(failing ? { 'index.js': Buffer.from('export function apply() { throw new Error("community child failed") }') } : {})
    })
    const generation = await installOfflineBundle(root, data.bytes, data.expected, target, { dshEntryPath })
    const context = new Context()
    const loader = context.plugin(Loader, { baseUrl: pathToFileURL(`${root}/`).href })
    await loader
    let runtime: ReturnType<typeof createMarketRuntime> | undefined
    context.loader.builtins.communityOwner = { apply(child: Context) { runtime = createMarketRuntime(child) } }
    const owner = await context.loader.create({ name: 'cordis:communityOwner' })
    await context.loader.await()
    try {
      if (failing) {
        await expect(runtime!({ ...generation, ...data.expected })).rejects.toThrow(/failed|ready/)
        return
      }
      const running = await runtime!({ ...generation, ...data.expected })
      expect(running.state).toBe(2)
      expect([...context.loader.entries()].some(row => row.options.name.includes('company-demo/index.js'))).toBe(true)
      await running.dispose()
      expect([...context.loader.entries()].some(row => row.options.name.includes('company-demo/index.js'))).toBe(false)
    } finally { await context.loader.remove(owner); await loader.dispose() }
  })

  it('rejects changed identity, unsafe package paths and unsupported Node requirements', async () => {
    const data = plugin()
    await expect(readCommunityPackage(data.bytes, { ...data.expected, name: 'other' }, target)).rejects.toThrow(/identity/)
    const escaped = plugin({}, { '../escape': Buffer.from('bad') })
    await expect(readCommunityPackage(escaped.bytes, escaped.expected, target)).rejects.toThrow(/Unsafe/)
    const future = plugin({ engines: { node: '>=999' } })
    await expect(readCommunityPackage(future.bytes, future.expected, target)).rejects.toThrow(/Node runtime/)
  })

  it('reads npm exports as the public entry', async () => {
    const data = plugin({ main: undefined, exports: { '.': { import: './entry.js' } } }, { 'entry.js': Buffer.from('export function apply() {}') })
    const parsed = await readCommunityPackage(data.bytes, data.expected, target)
    expect(parsed.manifest.plugin.name).toBe('company-demo')
  })
})
