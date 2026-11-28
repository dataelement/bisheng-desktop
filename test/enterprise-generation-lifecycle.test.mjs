import { afterEach, expect, it, vi } from 'vitest'
import { lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureRegistryDirectories, registryLayout, sweepRegistry } from '../packages/dsh-desktop-market-installer/generations/registry.mjs'
import { installOfflineBundle, sha256, verifyInstalledBundle } from '../packages/dsh-desktop-enterprise/offline-bundle.js'
import { prepareEnterpriseGeneration } from '../packages/dsh-desktop-enterprise/enterprise-generation-recovery.js'
import { zipEntries } from './enterprise-bundle-fixture.mjs'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const target = process.platform + '-' + process.arch
const pkg = { name: 'company-demo', version: '1.0.0', type: 'module', main: 'index.js' }
const source = 'export function apply() {}'
const bytes = zipEntries({ 'package.json': Buffer.from(JSON.stringify(pkg)), 'index.js': Buffer.from(source) })
const expected = { name: pkg.name, version: pkg.version, digest: sha256(bytes) }

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'enterprise-generation-lifecycle-'))
  roots.push(home)
  await mkdir(join(home, 'profiles', 'node_modules'), { recursive: true })
  await ensureRegistryDirectories(home)
  // Exercise the real shared installer/publication flow without network, scripts or external pnpm processes.
  const runInstall = vi.fn(async staging => {
    const rootManifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
    await writeFile(join(staging, 'package.json'), JSON.stringify({ ...rootManifest, dependencies: { [pkg.name]: '1.0.0' } }))
    const plugin = join(staging, 'node_modules', pkg.name)
    await mkdir(plugin, { recursive: true })
    await writeFile(join(plugin, 'package.json'), JSON.stringify(pkg))
    await writeFile(join(plugin, 'index.js'), source)
    await writeFile(join(staging, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    return { code: 0, output: '' }
  })
  const installOptions = { installOptions: { runInstall } }
  const generation = await installOfflineBundle(home, bytes, expected, target, installOptions)
  const record = { ...expected, generation_id: generation.id, directory: generation.directory, integrity: generation.integrity,
    plugin_id: 'a'.repeat(32), version_id: 'b'.repeat(32), enabled: true, config: { example: 'preserved' } }
  return { home, generation, record, installOptions, runInstall }
}

it('keeps enterprise npm generations out of the public cold-start sweep', async () => {
  const { home, generation, record } = await fixture()
  expect(generation.directory).toBe(join(home, 'profiles', '.enterprise-generations', generation.id))
  expect((await sweepRegistry(home)).removed).not.toContain(generation.id)
  await expect(verifyInstalledBundle(record, target)).resolves.toHaveProperty('manifest')
})

it('migrates an intact old public generation before activation without changing plugin configuration', async () => {
  const { home, generation, record, installOptions } = await fixture()
  const oldDirectory = join(registryLayout(home).generations, generation.id)
  await rename(record.directory, oldDirectory)
  const previous = { ...record, directory: oldDirectory }
  const fetchArtifact = vi.fn()
  const prepared = await prepareEnterpriseGeneration(home, previous, target, { assertCurrent() {}, fetchArtifact, installOptions })
  expect(prepared).toMatchObject({ ...expected, config: previous.config, plugin_id: previous.plugin_id, version_id: previous.version_id })
  expect(prepared.directory).not.toBe(oldDirectory)
  expect(fetchArtifact).not.toHaveBeenCalled()
  await sweepRegistry(home)
  await expect(lstat(oldDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(verifyInstalledBundle(prepared, target)).resolves.toHaveProperty('manifest')
})

it('restores a missing installation using only the exact approved artifact', async () => {
  const { home, record, installOptions } = await fixture()
  await rm(record.directory, { recursive: true })
  const fetchArtifact = vi.fn(async () => bytes)
  const prepared = await prepareEnterpriseGeneration(home, record, target, { assertCurrent() {}, fetchArtifact, installOptions })
  expect(fetchArtifact).toHaveBeenCalledOnce()
  expect(prepared).toMatchObject({ ...expected, config: record.config, enabled: true, version_id: record.version_id })
  expect(prepared.directory).not.toBe(record.directory)
  await expect(verifyInstalledBundle(prepared, target)).resolves.toHaveProperty('manifest')
})

it('never downloads or repairs over an existing tampered tree', async () => {
  const { home, record, installOptions, runInstall } = await fixture()
  await writeFile(join(record.directory, 'node_modules', pkg.name, 'index.js'), 'tampered')
  const fetchArtifact = vi.fn()
  await expect(prepareEnterpriseGeneration(home, record, target, { assertCurrent() {}, fetchArtifact, installOptions })).rejects.toThrow(/changed/)
  expect(fetchArtifact).not.toHaveBeenCalled()
  expect(runInstall).toHaveBeenCalledOnce()
})

it('does not install a delayed recovery artifact after the account changes', async () => {
  const { home, record, installOptions, runInstall } = await fixture()
  await rm(record.directory, { recursive: true })
  let changed = false
  await expect(prepareEnterpriseGeneration(home, record, target, {
    assertCurrent() { if (changed) throw Error('Enterprise account changed.') },
    fetchArtifact: async () => { changed = true; return bytes }, installOptions
  })).rejects.toThrow('Enterprise account changed.')
  expect(runInstall).toHaveBeenCalledOnce()
})

it('refuses a different artifact during recovery and preserves the original record', async () => {
  const { home, record, installOptions, runInstall } = await fixture()
  const original = structuredClone(record)
  await rm(record.directory, { recursive: true })
  await expect(prepareEnterpriseGeneration(home, record, target, {
    assertCurrent() {}, fetchArtifact: async () => Buffer.from('wrong artifact'), installOptions
  })).rejects.toThrow(/checksum/)
  expect(record).toEqual(original)
  expect(runInstall).toHaveBeenCalledOnce()
})
