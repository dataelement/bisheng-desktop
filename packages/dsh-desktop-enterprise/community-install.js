import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { create } from 'tar'
import { installGeneration, verifyGenerationPeers } from 'dsh-desktop-market-installer/generations/installer'
import { readCommunityPackage } from './community-package.js'
import { safePath, sha256 } from './offline-bundle.js'

/** Hash the installed dependency closure; keep its digest in the account's install record. */
async function inventory(directory) {
  const files = {}
  let count = 0
  const canonical = await realpath(directory)
  const walk = async path => {
    const absolute = join(directory, path), info = await lstat(absolute)
    if (info.isSymbolicLink()) {
      const resolved = relative(canonical, await realpath(absolute))
      if (isAbsolute(resolved) || resolved.startsWith('..')) throw new Error('Plugin dependency link leaves its generation.')
      files[path] = { link: await readlink(absolute) }
    } else if (info.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await walk(`${path}/${name}`)
    } else if (info.isFile()) files[path] = { digest: sha256(await readFile(absolute)) }
    else throw new Error('Unsupported installed plugin file.')
    if (++count > 50000) throw new Error('Installed plugin exceeds file limit.')
  }
  await walk('node_modules')
  return files
}

export async function installCommunityPackage(home, bytes, expected, target, options) {
  const { files, manifest } = await readCommunityPackage(bytes, expected, target)
  const work = join(home, 'profiles', '.enterprise-staging', randomUUID())
  const source = join(work, 'package'), archive = join(work, 'plugin.tgz')
  let generation
  await mkdir(source, { recursive: true })
  try {
    for (const [path, file] of files) {
      const destination = join(source, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, file.data, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 })
    }
    await create({ cwd: work, file: archive, gzip: true, portable: true }, ['package'])
    const require = createRequire(import.meta.url)
    const pnpmEntryPath = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.cjs')
    const result = await installGeneration({ dshHome: home, namespace: 'enterprise', pluginSpec: await realpath(archive),
      expectedPluginName: expected.name, expectedVersion: expected.version, sourceSpec: `bisheng:${expected.digest}`,
      nodeExecutablePath: process.execPath, pnpmEntryPath, autoInstallPeers: false, strictDepBuilds: true,
      ...options.installOptions })
    if (!result.ok || !result.generation) throw new Error(result.detail || 'Plugin dependency installation failed.')
    generation = result.generation
    const peers = await verifyGenerationPeers(home, generation, { dshEntryPath: options.dshEntryPath })
    if (!peers.ok) throw new Error(peers.problems.join('; '))
    const contents = Buffer.from(JSON.stringify(await inventory(generation.directory)))
    await writeFile(join(generation.directory, 'enterprise-bundle.zip'), bytes, { flag: 'wx', mode: 0o600 })
    await writeFile(join(generation.directory, 'enterprise-files.json'), contents, { flag: 'wx', mode: 0o600 })
    return { ...generation, manifest, integrity: sha256(contents) }
  } catch (error) {
    if (generation) await rm(generation.directory, { recursive: true, force: true })
    throw error
  } finally { await rm(work, { recursive: true, force: true }) }
}

export async function verifyCommunityPackage(generation, bytes, target) {
  const parsed = await readCommunityPackage(bytes, generation, target)
  const contents = await readFile(join(generation.directory, 'enterprise-files.json'))
  if (contents.length > 8 * 1024 * 1024 || sha256(contents) !== generation.integrity) throw new Error('Installed plugin integrity record changed.')
  const expected = JSON.parse(contents.toString('utf8'))
  if (!expected || Array.isArray(expected) || Object.keys(expected).some(path => !safePath(path) || !path.startsWith('node_modules/'))) throw new Error('Invalid installed plugin inventory.')
  if (JSON.stringify(await inventory(generation.directory)) !== JSON.stringify(expected)) throw new Error('Installed plugin files changed; reinstall the approved release.')
  return parsed
}
