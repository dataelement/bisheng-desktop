import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { registryLayout } from 'dsh-desktop-market-installer/generations/registry'
import { assertEnterpriseGenerationPath, installOfflineBundle, verifyInstalledBundle } from './offline-bundle.js'

/** Restore only a currently authorized, exact artifact; caller owns policy and account lifecycle checks. */
export async function prepareEnterpriseGeneration(home, record, target, options) {
  assertEnterpriseGenerationPath(home, record)
  options.assertCurrent()
  let info
  try { info = await lstat(record.directory) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const publicDirectory = join(registryLayout(home).generations, record.generation_id)
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Enterprise generation must be a real directory.')
    // Tampered trees are never silently repaired. Migration is only for an intact public-store generation.
    await verifyInstalledBundle(record, target)
    options.assertCurrent()
    if (resolve(record.directory) !== resolve(publicDirectory)) return record
  }
  const bytes = info
    ? await readFile(join(record.directory, 'enterprise-bundle.zip'))
    : await options.fetchArtifact()
  options.assertCurrent()
  const generation = await installOfflineBundle(home, bytes, {
    name: record.name, version: record.version, digest: record.digest
  }, target, options.installOptions)
  options.assertCurrent()
  // Keep plugin/account identity and configuration; only replace the verified physical installation.
  const prepared = { ...record, directory: generation.directory, generation_id: generation.id }
  delete prepared.integrity
  if (generation.integrity) prepared.integrity = generation.integrity
  return prepared
}
