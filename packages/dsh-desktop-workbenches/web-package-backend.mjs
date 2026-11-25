import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { initProfile, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { classifyInstallFailure } from '@deepseek-ai/dsh-plugin-manager'
import { runProfilePnpm, saveManifest } from '@deepseek-ai/dsh-plugin-manager/operations'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const HOST_BUNDLES = new Set(['dsh-desktop-client-ui', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-office', 'dsh-ppt-composer', 'dsh-ppt', 'dsh-image-generation'])

async function optionalStat(path) {
  try { return await lstat(path) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

/** POSIX replaces a link atomically. Windows cannot rename over a junction. */
async function replaceLink(path, target) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.workbench-' + randomUUID()
  try {
    await symlink(target, temporary, process.platform === 'win32' ? 'junction' : 'dir')
    if (process.platform === 'win32' && await optionalStat(path)) {
      const backup = path + '.previous-' + randomUUID()
      await rename(path, backup)
      try {
        await rename(temporary, path)
        await rm(backup, { force: true })
      } catch (error) {
        await rm(path, { force: true })
        await rename(backup, path)
        throw error
      }
    } else await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

function within(root, path) {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix)
}

/** pnpm's copy import mode does not copy explicit link: dependencies. */
async function assertIndependentModules(stage) {
  const visited = new Set()
  const walk = async directory => {
    const physical = await realpath(directory)
    if (!within(stage, physical)) throw new Error('A workbench dependency links outside its prepared package. Publish self-contained dependencies before installing.')
    if (visited.has(physical)) return
    visited.add(physical)
    for (const entry of await readdir(physical, { withFileTypes: true })) {
      const path = join(physical, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isSymbolicLink()) {
        const target = await realpath(path)
        if (!within(stage, target)) throw new Error('A workbench dependency links outside its prepared package. Publish self-contained dependencies before installing.')
        if ((await stat(target)).isDirectory()) await walk(target)
      }
    }
  }
  await walk(join(stage, 'node_modules'))
}

async function pendingBuilds(stage) {
  const path = join(stage, 'node_modules', '.modules.yaml')
  if (!await optionalStat(path)) return []
  const data = loadYaml(await readFile(path, 'utf8'), { schema: JSON_SCHEMA })
  const pending = data?.pendingBuilds ?? []
  if (!Array.isArray(pending) || pending.some(value => typeof value !== 'string')) throw new Error('Unsupported pnpm pending-build metadata.')
  return pending
}

/**
 * Minimal package backend for verified Web workbench requests. The Manager owns
 * the profile write lock and subsequent activation. Packages are prepared outside
 * the profiles tree so Harness's linked-plugin resolver shares declared host peers.
 * Old stages remain intact: running modules can still reference them after updates.
 *
 * @param {{ profile: import('@deepseek-ai/dsh-app-boot').ProfileContext,
 *   runPnpm?: typeof runProfilePnpm }} options
 */
export function createWebPackageBackend({ profile, runPnpm = runProfilePnpm }) {
  if (!isAbsolute(profile.dir) || !isAbsolute(profile.home)) throw new Error('A Web package backend needs absolute profile and home paths.')
  const stages = join(profile.home, 'workbench-packages')
  const profileRoot = resolve(profile.home, 'profiles')
  // Do not move staging into a profile: it would change the host-peer resolution route.
  if (within(profileRoot, stages) || within(profile.dir, stages)) throw new Error('Workbench packages must be outside the profiles directory.')

  return {
    supportsVerifiedInstall: true,
    /** @param {Parameters<import('@deepseek-ai/dsh-plugin-manager').ProfileBundlePackageBackend['install']>[0]} request */
    async install(request) {
      if (request.expectedName === undefined && request.expectedVersion === undefined) return undefined
      const name = request.expectedName
      if (typeof name !== 'string' || name.length > 214 || !PACKAGE_NAME.test(name) ||
          typeof request.expectedVersion !== 'string' || !request.expectedVersion) {
        throw new Error('A verified workbench install needs an exact package name and version.')
      }
      if (name.startsWith('@deepseek-ai/') || HOST_BUNDLES.has(name)) throw new Error('A workbench cannot replace a host package.')
      request.signal.throwIfAborted()
      const link = join(profile.dir, 'node_modules', name)
      for (const directory of new Set([join(profile.dir, 'node_modules'), dirname(link)])) {
        if ((await optionalStat(directory))?.isSymbolicLink()) throw new Error('The profile needs its own dependency directory for workbench installation.')
      }
      const previous = await optionalStat(link)
      // A package managed in-place by pnpm needs an explicit migration, not a destructive overwrite.
      if (previous && !previous.isSymbolicLink()) throw new Error('This package is managed by another installer. Remove it before installing a verified workbench.')
      const previousTarget = previous ? resolve(dirname(link), await readlink(link)) : undefined
      const before = readProfileManifest('dsh', profile.dir)
      await mkdir(stages, { recursive: true })
      const stage = await realpath(await mkdtemp(join(stages, 'package-')))
      let projectionStarted = false
      let restored = false
      let packageResult
      const preserveLogs = async () => {
        const source = join(stage, '.plugin-manager', 'logs')
        if (!await optionalStat(source)) return
        const destination = join(profile.home, 'workbench-install-logs')
        await mkdir(destination, { recursive: true, mode: 0o700 })
        for (const entry of await readdir(source, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith('operation-')) continue
          const from = join(source, entry.name, 'pnpm.log')
          if (!await optionalStat(from)) continue
          const to = join(destination, basename(stage) + '-' + entry.name + '.log')
          await copyFile(from, to)
          if (packageResult?.logPath === from) packageResult.logPath = to
        }
      }
      const rollback = async () => {
        if (restored) return
        if (projectionStarted) {
          if (previousTarget) await replaceLink(link, previousTarget)
          else await rm(link, { force: true })
          await saveManifest(profile.dir, before)
        }
        await preserveLogs()
        await rm(stage, { recursive: true, force: true })
        restored = true
      }
      try {
        initProfile(stage, [])
        // file: copies directories instead of retaining a live link to user source.
        const spec = request.path ? 'file:' + resolve(request.path) : request.spec
        const args = ['add', spec, '--save-exact', '--ignore-scripts', '--config.package-import-method=copy']
        if (request.registry) args.push('--registry', request.registry)
        const result = packageResult = { ...await runPnpm({
          profile: profile.name, dir: stage, home: profile.home,
          cwd: profile.cwd, installAnchor: profile.installAnchor
        }, args, {
          ...profile.packageManager, execution: 'service', signal: request.signal,
          onOutput: request.onOutput, outputBytes: 128 * 1024, idleTimeoutMs: 120_000,
          lookupTimeoutMs: 20_000, activateNewBundles: false
        }) }
        request.signal.throwIfAborted()
        if (result.exitCode !== 0 || result.timedOut) {
          await rollback()
          return { bundle: name, packageResult: { ...result, kind: classifyInstallFailure({ log: result.output, timedOut: result.timedOut }) } }
        }
        const packageDir = await realpath(join(stage, 'node_modules', name))
        const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
        if (manifest.name !== name || manifest.version !== request.expectedVersion) throw new Error('Installed package identity does not match the verified artifact.')
        if (!manifest.dsh?.bundle) throw new Error('The verified package is not a Harness bundle.')
        // Package scripts are deliberately not executed before identity validation.
        // Such bundles need an explicit build-approval flow; never claim them usable.
        const lifecycle = ['preinstall', 'install', 'postinstall', ...(request.kind === 'git' ? ['prepare', 'prepublish', 'prepack', 'publish'] : [])]
        const pending = await pendingBuilds(stage)
        if (lifecycle.some(key => manifest.scripts?.[key]) || pending.length) {
          throw new Error('This workbench requires install scripts. Build it before publishing an installable workbench package.' + (pending.length ? ' Pending: ' + pending.join(', ') : ''))
        }
        await assertIndependentModules(stage)
        request.signal.throwIfAborted()
        const after = { ...before, dependencies: { ...before.dependencies, [name]: 'link:' + packageDir } }
        projectionStarted = true
        await replaceLink(link, packageDir)
        await saveManifest(profile.dir, after)
        return { bundle: name, replaced: previous !== undefined, packageResult: result, rollback }
      } catch (error) {
        try { await rollback() } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], 'Workbench install failed and its previous profile projection could not be restored.')
        }
        throw error
      }
    },
    // Normal pnpm removal already understands the persistent link: dependency.
    async remove() { return undefined }
  }
}

/** Register only for the Web profile; leave a host-provided backend in control. */
export function registerWebPackageBackend(ctx) {
  ctx.inject(['profileContext'], (scoped) => {
    if (scoped.profileContext.name !== 'web' || scoped.get('profileBundlePackageBackend') !== undefined) return
    const backend = createWebPackageBackend({ profile: scoped.profileContext })
    scoped.effect(() => scoped.reflect.provide('profileBundlePackageBackend', backend))
  })
}
