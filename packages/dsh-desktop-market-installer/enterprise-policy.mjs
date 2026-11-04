import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isLocalPluginRequest, localSourcePath } from './local-source.mjs'
import { isProtectedProfileBundle } from './profile-protection.mjs'
export { isProtectedProfileBundle } from './profile-protection.mjs'
export { isLocalPluginRequest, localSourcePath } from './local-source.mjs'

const POLICY_PATH = join('profiles', 'web', '.dsh-desktop', 'third-party-policy.json')
const CLOSED = Object.freeze({
  allowThirdPartyPlugins: false,
  allowThirdPartyWorkbenches: false,
  syncSeconds: 60,
  connectionKey: undefined,
  connected: false,
  authoritative: false
})

function booleanFlag(value) {
  return value === true
}

function syncSeconds(value) {
  return Number.isSafeInteger(value) && value >= 5 && value <= 3600 ? value : 60
}

export function normalizeThirdPartyPolicy(value) {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    allowThirdPartyPlugins: booleanFlag(source.allowThirdPartyPlugins ?? source.allow_third_party_plugins),
    allowThirdPartyWorkbenches: booleanFlag(source.allowThirdPartyWorkbenches ?? source.allow_third_party_workbenches),
    syncSeconds: syncSeconds(source.syncSeconds ?? source.sync_seconds),
    connectionKey: typeof source.connectionKey === 'string' ? source.connectionKey : undefined,
    connected: source.connected === true,
    authoritative: source.authoritative === true,
    ...(source.stale === true ? { stale: true } : {})
  }
}

export function createEnterpriseCapabilityPolicy(options = {}) {
  const now = options.now ?? (() => Date.now())
  let snapshot = { ...CLOSED }
  let resolver
  // Tenant and resolver lifetime. Reads never advance it, so a display refresh
  // cannot invalidate an authorization that is already in flight.
  let lifecycle = 0
  const inflight = new Map()
  let fetchedAt = 0
  let compositionHandler
  // Several surfaces read enterprise state together. Each reset publishes, and
  // the handler renames a profile file. Overlapping renames of one temp path
  // throw ENOENT on Windows, and an unhandled rejection is a fatal Harness
  // load failure. Coalesce onto the latest snapshot and keep the process up
  // when persistence still fails; the in-memory snapshot remains the gate.
  let compositionScheduled = false
  let compositionDrain

  const scheduleComposition = () => {
    if (!compositionHandler) return
    compositionScheduled = true
    if (compositionDrain) return
    compositionDrain = drainComposition().finally(() => {
      compositionDrain = undefined
      if (compositionScheduled && compositionHandler) scheduleComposition()
    })
  }
  const drainComposition = async () => {
    while (compositionScheduled && compositionHandler) {
      compositionScheduled = false
      const handler = compositionHandler
      const delivered = { ...snapshot }
      try {
        await handler(delivered)
      } catch (error) {
        const code = typeof error?.code === 'string' ? ` (${error.code})` : ''
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[dsh-desktop-market-installer] third-party policy composition failed${code}: ${message}`)
      }
    }
  }
  const publish = (next) => {
    snapshot = next
    fetchedAt = next.authoritative && next.connected ? now() : 0
    scheduleComposition()
    return snapshot
  }
  const failClosed = (connectionKey, connected = false) => publish({
    ...CLOSED,
    connectionKey,
    connected,
    authoritative: true
  })
  const disabled = (kind) => new Error(`POLICY_DISABLED: current enterprise has not opened ${kind}.`)
  const dropReads = () => { inflight.clear() }
  const readTenant = (expectedConnectionKey, { force }) => {
    if (!resolver) return Promise.resolve({ policy: failClosed(expectedConnectionKey, false), accepted: false })
    const fresh = !force
      && snapshot.authoritative
      && snapshot.connectionKey === expectedConnectionKey
      && now() - fetchedAt < snapshot.syncSeconds * 1000
    if (fresh) return Promise.resolve({ policy: { ...snapshot }, accepted: true })
    const slot = expectedConnectionKey ?? ''
    const existing = inflight.get(slot)
    if (existing) return existing
    const started = lifecycle
    const request = (async () => {
      try {
        const value = normalizeThirdPartyPolicy(await resolver())
        if (started !== lifecycle || (expectedConnectionKey !== undefined && value.connectionKey !== expectedConnectionKey) || value.stale === true) {
          return { policy: { ...snapshot }, accepted: false }
        }
        if (value.connected !== true) return { policy: failClosed(expectedConnectionKey, false), accepted: false }
        const policy = publish({
          allowThirdPartyPlugins: value.allowThirdPartyPlugins,
          allowThirdPartyWorkbenches: value.allowThirdPartyWorkbenches,
          syncSeconds: value.syncSeconds,
          connectionKey: expectedConnectionKey ?? value.connectionKey,
          connected: true,
          authoritative: true
        })
        return { policy: { ...policy }, accepted: true }
      } catch {
        if (started !== lifecycle) return { policy: { ...snapshot }, accepted: false }
        return { policy: failClosed(expectedConnectionKey, true), accepted: false }
      } finally {
        if (inflight.get(slot) === request) inflight.delete(slot)
      }
    })()
    inflight.set(slot, request)
    return request
  }

  const policy = {
    registerResolver(next) {
      resolver = next
      lifecycle += 1
      dropReads()
      snapshot = { ...CLOSED }
      fetchedAt = 0
      return () => {
        if (resolver !== next) return
        resolver = undefined
        lifecycle += 1
        dropReads()
        snapshot = { ...CLOSED }
        fetchedAt = 0
      }
    },
    setCompositionHandler(next) {
      compositionHandler = next
      return () => {
        if (compositionHandler === next) compositionHandler = undefined
      }
    },
    snapshot() {
      return { ...snapshot }
    },
    reset() {
      lifecycle += 1
      dropReads()
      publish({ ...CLOSED })
    },
    async refresh(expectedConnectionKey, refreshOptions = {}) {
      const result = await readTenant(expectedConnectionKey, { force: refreshOptions.force === true })
      return { ...result.policy }
    },
    async authorize(kind) {
      if (!resolver) {
        failClosed(snapshot.connectionKey, false)
        throw disabled(kind)
      }
      const started = lifecycle
      const key = snapshot.connectionKey
      const result = await readTenant(key, { force: true })
      if (started !== lifecycle || result.accepted !== true || result.policy.connected !== true) throw disabled(kind)
      if (key !== undefined && result.policy.connectionKey !== key) throw disabled(kind)
      const allowed = kind === 'network plugin installation'
        ? result.policy.allowThirdPartyPlugins
        : result.policy.allowThirdPartyWorkbenches
      if (allowed !== true) throw disabled(kind)
    },
    authorizePluginMutation() {
      return policy.authorize('network plugin installation')
    },
    authorizeWorkbenchMarketInstall() {
      return policy.authorize('network workbench installation')
    }
  }
  return policy
}

/** Startup and recovery stay closed until a live tenant read explicitly allows them. */
export function communityPluginInstallAllowed() {
  return false
}

const NETWORK_PLUGIN_REFUSAL = Object.freeze({
  status: 'refused',
  problem: 'unknown',
  reason: 'POLICY_DISABLED: current enterprise has not opened network plugin installation.',
  registries: []
})

export function restrictCommunityPackageBackend(backend, policy = createEnterpriseCapabilityPolicy(), options = {}) {
  const releaseQuarantine = options.releaseQuarantine ?? (async () => undefined)
  const isOfficialBundle = options.isOfficialBundle ?? (async () => false)
  const isLocallyInstalled = options.isLocallyInstalled ?? (async () => false)
  const isPhysicallyInstalled = options.isPhysicallyInstalled ?? (async () => false)
  // Kept so existing callers can still pass the historical quarantine list.
  // Enablement no longer consults it; source decides.
  void options.isQuarantined

  const mayEnableWithoutNetwork = async (name) => {
    if (typeof name !== 'string' || name.length === 0) return false
    if (isProtectedProfileBundle(name)) return true
    if (await isOfficialBundle(name)) return true
    return isLocallyInstalled(name)
  }

  return {
    ...backend,
    async install(request) {
      if (!isLocalPluginRequest(request)) await policy.authorizePluginMutation()
      const result = await backend.install(request)
      const name = request?.expectedName ?? request?.name
      if (result?.packageResult?.exitCode === 0 && result.packageResult.timedOut !== true && typeof name === 'string' && name) {
        await releaseQuarantine(name)
      }
      return result
    },
    async authorizeSpec(parsed) {
      if (isLocalPluginRequest(parsed)) return undefined
      try {
        await policy.authorizePluginMutation()
        return undefined
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('POLICY_DISABLED')) {
          return { ...NETWORK_PLUGIN_REFUSAL }
        }
        throw error
      }
    },
    async authorizeSwitch(request) {
      if (request?.enabled !== true) return
      // dshmarket is the market UI itself. Enabling it while the tenant has
      // closed third-party plugins would show that market again.
      if (request?.name === 'dshmarket') {
        await policy.authorizePluginMutation()
        return
      }
      if (await mayEnableWithoutNetwork(request.name)) return
      // An already installed package only flips the local switch. The bytes
      // are already on disk, so this is not a network install.
      if (await isPhysicallyInstalled(request.name)) return
      await policy.authorizePluginMutation()
    },
    async switched(request) {
      const installed = request?.name !== 'dshmarket' && (
        await mayEnableWithoutNetwork(request.name) || await isPhysicallyInstalled(request.name)
      )
      const result = await backend.switched(request)
      if (request?.enabled === true && installed) await releaseQuarantine(request.name)
      return result
    }
  }
}

function policyFile(dshHome) {
  return join(dshHome, POLICY_PATH)
}

export async function readPersistedThirdPartyPolicy(dshHome) {
  try {
    return normalizeThirdPartyPolicy(JSON.parse(await readFile(policyFile(dshHome), 'utf8')))
  } catch {
    return normalizeThirdPartyPolicy(undefined)
  }
}

const TRANSIENT_REPLACE_CODES = new Set(['ENOENT', 'EPERM', 'EBUSY', 'EACCES'])
const replaceTails = new Map()

function temporaryPath(path) {
  return `${path}.${process.pid}.${Date.now().toString(36)}.${randomBytes(4).toString('hex')}.tmp`
}

async function renameOver(from, to) {
  const attempts = process.platform === 'win32' ? 8 : 1
  let error
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (caught) {
      error = caught
      const code = typeof caught?.code === 'string' ? caught.code : undefined
      if (attempt === attempts - 1 || !TRANSIENT_REPLACE_CODES.has(code)) break
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
  throw error
}

async function replaceFileNow(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = temporaryPath(path)
  try {
    await writeFile(temporary, contents, 'utf8')
    await renameOver(temporary, path)
  } finally {
    // A successful rename has already moved the temp file.
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function replaceFile(path, contents) {
  const previous = replaceTails.get(path) ?? Promise.resolve()
  const run = previous.then(() => replaceFileNow(path, contents))
  replaceTails.set(path, run.then(() => undefined, () => undefined))
  return run
}

export async function writePersistedThirdPartyPolicy(dshHome, policy) {
  const path = policyFile(dshHome)
  const next = normalizeThirdPartyPolicy(policy)
  await replaceFile(path, `${JSON.stringify({
    allowThirdPartyPlugins: next.allowThirdPartyPlugins,
    allowThirdPartyWorkbenches: next.allowThirdPartyWorkbenches
  }, null, 2)}\n`)
}

async function readManifest(dshHome) {
  const path = join(dshHome, 'profiles', 'web', 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`profile manifest is not a JSON object at ${path}`)
  }
  return { path, manifest }
}

/** Keep the dshmarket package, but only compose it when the tenant allows the plugin market. */
export async function syncMarketBundle(dshHome, allowed) {
  let loaded
  try {
    loaded = await readManifest(dshHome)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  const { path, manifest } = loaded
  const profile = manifest.dsh?.profile ?? {}
  const bundles = Array.isArray(profile.bundles) ? profile.bundles.filter((name) => typeof name === 'string') : []
  const hasMarket = bundles.includes('dshmarket')
  const installed = typeof manifest.dependencies?.dshmarket === 'string'
  let next = bundles
  if (allowed && installed && !hasMarket) next = [...bundles, 'dshmarket']
  if (!allowed && hasMarket) next = bundles.filter((name) => name !== 'dshmarket')
  if (next.length === bundles.length && next.every((name, index) => name === bundles[index])) return false
  const dsh = manifest.dsh ?? {}
  await replaceFile(path, `${JSON.stringify({
    ...manifest,
    dsh: { ...dsh, profile: { ...profile, bundles: next } }
  }, null, 2)}\n`)
  return true
}
