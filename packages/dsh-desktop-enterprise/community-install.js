import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { create } from 'tar'
import { installGeneration, verifyGenerationPeers } from 'dsh-desktop-market-installer/generations/installer'
import { readCommunityPackage } from './community-package.js'
import { assertHostEntry, safePath, sha256 } from './offline-bundle.js'
import { generationId, registryLayout, writeGenerationMeta } from 'dsh-desktop-market-installer/generations/registry'
import { createEnterpriseInstallWorkspace, ensureEnterpriseStore, prepareEnterpriseInstallerHome } from './enterprise-generation-store.js'

function installFailure(detail) {
  const text = String(detail || 'Plugin dependency installation failed.')
  const coded = text.match(/\bERR_[A-Z][A-Z0-9_]*\b/u)
  if (coded) return new Error(`Plugin dependency installation failed (${coded[0]}).`)
  return new Error('Plugin dependency installation failed.')
}

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

export async function installCommunityPackage(home, bytes, expected, target, options = {}) {
  assertHostEntry(options.dshEntryPath)
  const { files, manifest } = await readCommunityPackage(bytes, expected, target)
  const work = await createEnterpriseInstallWorkspace(home)
  const source = join(work, 'package'), archive = join(work, 'plugin.tgz')
  let pending
  try {
    await mkdir(source, { recursive: true })
    for (const [path, file] of files) {
      const destination = join(source, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, file.data, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 })
    }
    await create({ cwd: work, file: archive, gzip: true, portable: true }, ['package'])
    const require = createRequire(import.meta.url)
    const pnpmEntryPath = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.cjs')
    const profile = options.installOptions?.profile ?? process.env.DSH_DESKTOP_PROFILE ?? 'desktop'
    const installHome = await prepareEnterpriseInstallerHome(home, work, profile)
    const result = await installGeneration({
      ...options.installOptions,
      dshHome: installHome, profile,
      pluginSpec: await realpath(archive),
      expectedPluginName: expected.name,
      expectedVersion: expected.version,
      sourceSpec: `bisheng:${expected.digest}`,
      nodeExecutablePath: process.execPath,
      pnpmEntryPath,
      autoInstallPeers: false,
      strictDepBuilds: true
    })
    if (!result.ok || !result.generation) throw installFailure(result.detail)
    const installed = result.generation
    if (typeof installed.id !== 'string' || installed.id === '.' || installed.id === '..' || !/^[a-z0-9+_.-]+$/iu.test(installed.id) ||
        installed.directory !== join(registryLayout(installHome).generations, installed.id)) throw new Error('Invalid installer generation path.')
    const store = await ensureEnterpriseStore(home, '.enterprise-generations')
    const id = generationId(expected.name, expected.version, expected.digest + installed.id + randomUUID())
    pending = join(store, '.staging-' + randomUUID())
    await rename(installed.directory, pending)
    const generation = { ...installed, id, directory: pending }
    // Check from the final profiles ancestry so host peers resolve through the real installation closure.
    const peers = await verifyGenerationPeers(home, generation, { dshEntryPath: options.dshEntryPath })
    if (!peers.ok) throw new Error('Plugin host dependencies do not match this Desktop.')
    const contents = Buffer.from(JSON.stringify(await inventory(generation.directory)))
    await writeFile(join(generation.directory, 'enterprise-bundle.zip'), bytes, { flag: 'wx', mode: 0o600 })
    await writeFile(join(generation.directory, 'enterprise-files.json'), contents, { flag: 'wx', mode: 0o600 })
    const directory = join(store, id)
    await writeGenerationMeta(pending, { ...generation, directory })
    await rename(pending, directory)
    pending = undefined
    return { ...generation, directory, manifest, integrity: sha256(contents) }
  } finally {
    // Cleanup must not mask the original failure or turn a committed publication into an apparent failed install.
    for (const directory of [pending, work]) {
      if (!directory) continue
      try { await rm(directory, { recursive: true, force: true }) }
      catch (error) { console.warn('[enterprise-install] staging cleanup failed', { code: error.code ?? 'cleanup_failed' }) }
    }
  }
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
