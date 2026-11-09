import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, it } from 'vitest'
import { prepareLocalInstall } from '../packages/dsh-desktop-workbenches/local-archive.mjs'
import { MAX_PACKAGE_BYTES, readPackedManifest } from '../packages/dsh-desktop-workbenches/market-install.mjs'

const roots = []
const snapshots = []
afterEach(async () => {
  await Promise.all(snapshots.splice(0).map(snapshot => snapshot.cleanup()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const manifest = { name: '@fixture/local-workbench', version: '1.2.3', type: 'module',
  exports: { './client': './client.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['dsh-desktop-workbenches'] } } }
async function archive(value = manifest) {
  const root = await mkdtemp(join(tmpdir(), 'local-archive-test-'))
  roots.push(root)
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package/package.json'), typeof value === 'string' ? value : JSON.stringify(value))
  await writeFile(join(root, 'package/client.js'), 'export default {}\n')
  await writeFile(join(root, 'package/cordis.patch.yml'), '[]\n')
  const path = join(root, 'workbench.tgz')
  await promisify(execFile)('tar', ['-czf', path, '-C', root, 'package'])
  return path
}
async function prepare(path) {
  const target = await prepareLocalInstall(path)
  snapshots.push(target)
  return target
}

it('accepts a real npm-style archive without repository, workbench id, market catalog or git metadata', async () => {
  const path = await archive()
  const target = await prepare(path)
  expect(target).toMatchObject({ name: manifest.name, version: manifest.version })
  expect(target.spec).not.toBe(path)
  expect(readPackedManifest(await readFile(target.spec))).toEqual(manifest)
  expect(await readFile(target.spec)).toEqual(await readFile(path))
})

it('installs an immutable snapshot even if the source archive is changed or deleted', async () => {
  const path = await archive()
  const original = await readFile(path)
  const target = await prepare(path)
  await writeFile(path, 'changed after validation')
  expect(await readFile(target.spec)).toEqual(original)
  await rm(path)
  expect(await readFile(target.spec)).toEqual(original)
  await target.cleanup()
  await target.cleanup()
  await expect(readFile(target.spec)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(dirname(target.spec))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([undefined, null, 1, '', 'relative.tgz', '/tmp/package.zip', '/tmp/package.tgz\0'])('rejects invalid local path %j', async path => {
  await expect(prepare(path)).rejects.toThrow('absolute local .tgz')
})

it('rejects missing files and directories named .tgz', async () => {
  const path = await archive()
  await expect(prepare(join(dirname(path), 'missing.tgz'))).rejects.toMatchObject({ code: 'ENOENT' })
  const directory = join(dirname(path), 'directory.tgz')
  await mkdir(directory)
  await expect(prepare(directory)).rejects.toThrow('must be a file')
})

it('rejects an archive over the compressed size limit before parsing it', async () => {
  const path = await archive()
  const handle = await open(path, 'r+')
  try { await handle.truncate(MAX_PACKAGE_BYTES + 1) } finally { await handle.close() }
  await expect(prepare(path)).rejects.toThrow('at most 8 MiB')
})

it.each(['not gzip', gzipSync(Buffer.alloc(1024))])('rejects invalid or manifest-free archive bytes', async bytes => {
  const path = await archive()
  await writeFile(path, bytes)
  await expect(prepare(path)).rejects.toThrow(/valid .tgz|does not contain/)
})

it.each([
  '{invalid json', {}, { ...manifest, name: '../escape' }, { ...manifest, version: '' },
  { ...manifest, dsh: {} }, { ...manifest, exports: {} },
  { ...manifest, dsh: { ...manifest.dsh, bundle: { patch: '' } } },
  { ...manifest, dsh: { ...manifest.dsh, client: { platform: 'desktop', inject: ['dsh-desktop-workbenches'] } } },
  { ...manifest, dsh: { ...manifest.dsh, client: { platform: 'web', inject: [] } } }
])('rejects malformed manifest or missing workbench contract (%j)', async value => {
  await expect(prepare(await archive(value))).rejects.toThrow(/valid JSON|must declare/)
})
