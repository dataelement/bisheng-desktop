import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Enterprise packages are retained by enterprise-market records, not the public desired pointer. */
export async function ensureEnterpriseStore(home, name) {
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('Enterprise home must be absolute.')
  if (!['.enterprise-generations', '.enterprise-staging'].includes(name)) throw new Error('Invalid enterprise store.')
  const profiles = join(home, 'profiles')
  await mkdir(profiles, { recursive: true })
  const directory = join(profiles, name)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== join(await realpath(profiles), name)) {
    throw new Error('Enterprise store must be a real directory under profiles.')
  }
  return directory
}

/** Give the shared installer an owned, disposable registry; do not publish into the public registry. */
export async function createEnterpriseInstallWorkspace(home) {
  const root = await ensureEnterpriseStore(home, '.enterprise-staging')
  const directory = join(root, randomUUID())
  await mkdir(directory, { mode: 0o700 })
  return directory
}

/** Copy only the input that the shared installer filters into its explicit build-script policy. */
export async function prepareEnterpriseInstallerHome(home, work, profile) {
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(profile)) throw new Error('Invalid enterprise install profile.')
  const installHome = join(work, 'installer-home')
  const policyDirectory = join(installHome, 'profiles', profile)
  await mkdir(policyDirectory, { recursive: true })
  let policy
  try { policy = await readFile(join(home, 'profiles', profile, 'pnpm-workspace.yaml')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (policy !== undefined) await writeFile(join(policyDirectory, 'pnpm-workspace.yaml'), policy, { flag: 'wx', mode: 0o600 })
  return installHome
}
