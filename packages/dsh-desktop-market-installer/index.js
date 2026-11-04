import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { readQuarantinedPluginNames, releaseQuarantinedPlugin } from './community-quarantine.mjs'
import { createEnterpriseCapabilityPolicy, isLocalPluginRequest, localSourcePath, restrictCommunityPackageBackend, syncMarketBundle, writePersistedThirdPartyPolicy } from './enterprise-policy.mjs'
import { createGenerationPackageBackend } from './generations/package-backend.mjs'
import { listGenerations } from './generations/registry.mjs'
import { atomicWrite, buildMarketInstallArguments, buildMarketUninstallArguments, cleanStaleTemporaryDirectories, createDesktopPnpmService as createExecutor, createDesktopProfilesService, dshHome, ensurePnpmShim, INSTALL_PATH, isTrustedRequest, MAX_LOG_BYTES, OPERATION_TIMEOUT_MS, physicallyInstalledPlugin, profileDirectory, readMarketInstallation, RECOMMENDED_MARKET_VERSION, resolveDshEntry, resolvePnpmEntry, sendJson, STATUS_PATH, UNINSTALL_PATH } from './market-executor.mjs'

export * from './market-executor.mjs'
const capabilityPolicy = createEnterpriseCapabilityPolicy()
const PUBLIC_SNAPSHOT = Object.freeze({
  allowThirdPartyPlugins: true,
  allowThirdPartyWorkbenches: true,
  syncSeconds: 60,
  connectionKey: undefined,
  connected: false,
  authoritative: true
})

export function createPublicCapabilityPolicy() {
  return Object.freeze({
    registerResolver: () => () => undefined,
    setCompositionHandler: () => () => undefined,
    snapshot: () => ({ ...PUBLIC_SNAPSHOT }),
    reset: () => undefined,
    refresh: async () => ({ ...PUBLIC_SNAPSHOT }),
    authorize: async () => undefined,
    authorizePluginMutation: async () => undefined,
    authorizeWorkbenchMarketInstall: async () => undefined
  })
}

export function createDesktopPnpmService(options) {
  return createExecutor({ ...options, policy: options.policy ?? capabilityPolicy })
}

export async function apply(ctx, config = {}) {
  const activePolicy = config?.policyMode === 'public' ? createPublicCapabilityPolicy() : capabilityPolicy
  const home = dshHome()
  const directory = profileDirectory(home)
  const manifestPath = join(directory, 'package.json')
  let operationPromise
  let phase = 'idle'
  let detail
  let restartRequired = false

  // These generation-scoped services are the supported Desktop integration
  // boundary consumed by dsh-market 1.6+. The market therefore never probes
  // or provisions a system package manager and all mutations stay on the
  // packaged Node/pnpm pair.
  const binDirectory = await ensurePnpmShim(home)
  const desktopProfiles = createDesktopProfilesService(home)
  const desktopPnpm = createDesktopPnpmService({ binDirectory, policy: activePolicy })
  const profileBundlePackageBackend = createGenerationPackageBackend({
    dshHome: home,
    dshEntryPath: resolveDshEntry(),
    nodeExecutablePath: process.execPath,
    pnpmEntryPath: resolvePnpmEntry(),
    authorizeInstall: request => isLocalPluginRequest(request) ? undefined : activePolicy.authorizePluginMutation()
  })
  ctx.provide('enterpriseCapabilityPolicy', activePolicy)
  ctx.provide('desktopProfiles', desktopProfiles)
  ctx.provide('desktopPnpm', desktopPnpm)
  activePolicy.setCompositionHandler(async (snapshot) => {
    await writePersistedThirdPartyPolicy(home, snapshot)
    if (await syncMarketBundle(home, snapshot.allowThirdPartyPlugins === true)) restartRequired = true
  })
  ctx.provide('profileBundlePackageBackend', restrictCommunityPackageBackend(profileBundlePackageBackend, activePolicy, {
    isQuarantined: async (name) => (await readQuarantinedPluginNames(home)).includes(name),
    releaseQuarantine: async (name) => { await releaseQuarantinedPlugin(home, name) },
    isOfficialBundle: async (name) => OPTIONAL_BUNDLES.includes(name),
    isLocallyInstalled: async (name) => {
      const generations = await listGenerations(home)
      return generations.some((generation) =>
        generation.pluginName === name && localSourcePath(generation.sourceSpec) !== undefined
      )
    },
    isPhysicallyInstalled: (name) => physicallyInstalledPlugin(home, name)
  }))
  ctx.effect(() => () => desktopPnpm.dispose(), 'dsh-desktop-market-installer: desktop pnpm')

  const runProfileCommand = async (args, action) => {
    const handle = desktopPnpm.runPlugin(args, directory)
    let output = ''
    const append = (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-MAX_LOG_BYTES)
      const lines = output.trim().split(/\r?\n/u)
      detail = lines.at(-1)?.slice(0, 800)
    }
    handle.stdout.on('data', append)
    handle.stderr.on('data', append)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      handle.cancel()
    }, OPERATION_TIMEOUT_MS)

    try {
      const exit = await handle.done
      if (timedOut) throw new Error(`${action} timed out after 15 minutes.`)
      if (exit.exitCode !== 0) {
        throw new Error(
          detail ||
            `${action} exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.exitCode}`}.`
        )
      }
    } finally {
      clearTimeout(timer)
      handle.stdout.off('data', append)
      handle.stderr.off('data', append)
    }
  }

  const status = async () => {
    const installation = await readMarketInstallation(home)
    const currentPolicy = activePolicy.snapshot()
    const policy = currentPolicy.allowThirdPartyPlugins === true
      ? {}
      : { policyDisabled: true, policy: 'POLICY_DISABLED' }
    if (phase === 'installing' || phase === 'uninstalling') {
      return {
        phase,
        ...installation,
        ...policy,
        recommendedVersion: RECOMMENDED_MARKET_VERSION,
        detail,
        restartRequired: false
      }
    }
    if (phase === 'uninstalled') {
      return {
        phase,
        ...installation,
        ...policy,
        recommendedVersion: RECOMMENDED_MARKET_VERSION,
        restartRequired: true
      }
    }
    if (installation.installedVersion) {
      return {
        phase: 'installed',
        ...installation,
        ...policy,
        recommendedVersion: RECOMMENDED_MARKET_VERSION,
        restartRequired
      }
    }
    if (phase === 'error') {
      return {
        phase,
        ...installation,
        ...policy,
        recommendedVersion: RECOMMENDED_MARKET_VERSION,
        detail,
        restartRequired: false
      }
    }
    return {
      phase: installation.dependency ? 'incomplete' : 'absent',
      ...installation,
      ...policy,
      recommendedVersion: RECOMMENDED_MARKET_VERSION,
      restartRequired: false
    }
  }

  const runInstall = async () => {
    phase = 'installing'
    detail = undefined
    restartRequired = false
    const current = await readMarketInstallation(home)
    if (current.installedVersion) {
      phase = 'idle'
      return
    }

    await cleanStaleTemporaryDirectories(home)
    await ensurePnpmShim(home)
    await mkdir(directory, { recursive: true })
    let manifestSnapshot
    try {
      manifestSnapshot = await readFile(manifestPath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    try {
      await runProfileCommand(buildMarketInstallArguments(), 'Installation')

      const installed = await readMarketInstallation(home)
      if (!installed.installedVersion) {
        throw new Error('pnpm completed, but dshmarket was not found in the web profile.')
      }
      phase = 'idle'
      detail = undefined
      restartRequired = true
    } catch (error) {
      await cleanStaleTemporaryDirectories(home).catch(() => undefined)
      if (manifestSnapshot !== undefined) {
        await atomicWrite(manifestPath, manifestSnapshot).catch(() => undefined)
      }
      const lockfilePath = join(directory, 'pnpm-lock.yaml')
      await rm(lockfilePath, { force: true }).catch(() => undefined)
      phase = 'error'
      detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(error instanceof Error ? error : new Error(detail))
    }
  }

  const runUninstall = async () => {
    phase = 'uninstalling'
    detail = undefined
    restartRequired = false
    const current = await readMarketInstallation(home)
    if (!current.dependency && !current.installedVersion) {
      phase = 'uninstalled'
      restartRequired = true
      return
    }

    await cleanStaleTemporaryDirectories(home)
    await ensurePnpmShim(home)
    let manifestSnapshot
    try {
      manifestSnapshot = await readFile(manifestPath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    try {
      await runProfileCommand(buildMarketUninstallArguments(), 'Uninstallation')

      const removed = await readMarketInstallation(home)
      if (removed.dependency || removed.installedVersion) {
        throw new Error('pnpm completed, but dshmarket is still present in the web profile.')
      }
      phase = 'uninstalled'
      detail = undefined
      restartRequired = true
    } catch (error) {
      await cleanStaleTemporaryDirectories(home).catch(() => undefined)
      const lockfilePath = join(directory, 'pnpm-lock.yaml')
      await rm(lockfilePath, { force: true }).catch(() => undefined)
      phase = 'error'
      detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(error instanceof Error ? error : new Error(detail))
    }
  }

  ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {
    const disposeStatus = webCtx.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' || !isTrustedRequest(req)) {
          sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        sendJson(res, 200, await status())
      }
    })
    const disposeInstall = webCtx.webServer.register({
      kind: 'exact',
      path: INSTALL_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        if (!isTrustedRequest(req, true)) {
          sendJson(res, 403, { error: 'Request rejected.' })
          return
        }
        try {
          await activePolicy.authorizePluginMutation()
        } catch {
          sendJson(res, 403, { error: 'POLICY_DISABLED' })
          return
        }
        if (operationPromise) {
          sendJson(res, 409, await status())
          return
        }

        const current = await readMarketInstallation(home)
        if (current.installedVersion) {
          sendJson(res, 200, await status())
          return
        }

        operationPromise = runInstall()
          .catch((error) => {
            phase = 'error'
            detail = error instanceof Error ? error.message : String(error)
            webCtx.logger.warn(error instanceof Error ? error : new Error(detail))
          })
          .finally(() => {
            operationPromise = undefined
          })
        sendJson(res, 202, await status())
      }
    })
    const disposeUninstall = webCtx.webServer.register({
      kind: 'exact',
      path: UNINSTALL_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        if (!isTrustedRequest(req, true)) {
          sendJson(res, 403, { error: 'Request rejected.' })
          return
        }
        if (operationPromise) {
          sendJson(res, 409, await status())
          return
        }

        const current = await readMarketInstallation(home)
        if (!current.dependency && !current.installedVersion) {
          phase = 'uninstalled'
          restartRequired = true
          sendJson(res, 200, await status())
          return
        }

        operationPromise = runUninstall()
          .catch((error) => {
            phase = 'error'
            detail = error instanceof Error ? error.message : String(error)
            webCtx.logger.warn(error instanceof Error ? error : new Error(detail))
          })
          .finally(() => {
            operationPromise = undefined
          })
        sendJson(res, 202, await status())
      }
    })

    return async () => {
      disposeUninstall()
      disposeInstall()
      disposeStatus()
      await operationPromise?.catch(() => undefined)
    }
  }, 'dsh-desktop-market-installer: fixed package routes'))
}
