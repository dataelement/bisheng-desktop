const PREFIX = '/api/v1/dsh/market'
const MAX_PAGES = 100
const PAGE_SIZE = 20
export const WORKBENCH_ARTIFACT_LIMIT = 512 * 1024 * 1024
const HEX_ID = /^[a-f0-9]{32}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const REPOSITORY_KEY = /^[^/\s]+\/[^/\s]+$/u

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

export function parseWorkbenchListItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value
  if (!HEX_ID.test(source.id ?? '')) return null
  const version = source.current_version
  if (!version || typeof version !== 'object' || Array.isArray(version)) return null
  if (!HEX_ID.test(version.id ?? '') || typeof version.version !== 'string' || !version.version.trim()) return null
  if (typeof source.package_name !== 'string' || !source.package_name.trim()) return null
  if (typeof source.display_name !== 'string' || !source.display_name.trim()) return null
  if (source.identity_kind === 'repository') {
    if (typeof source.workbench_key !== 'string' || !REPOSITORY_KEY.test(source.workbench_key) || source.legacy_id !== null) return null
  } else if (source.identity_kind === 'legacy') {
    if (source.workbench_key !== null || typeof source.legacy_id !== 'string' || !source.legacy_id.trim()) return null
  } else return null
  return {
    id: source.id,
    identityKind: source.identity_kind,
    workbenchKey: source.identity_kind === 'repository' ? source.workbench_key : null,
    legacyId: source.identity_kind === 'legacy' ? source.legacy_id : null,
    packageName: source.package_name,
    displayName: source.display_name,
    description: text(source.description),
    verificationLevel: text(source.verification_level),
    updatedAt: text(source.updated_at),
    currentVersion: { id: version.id, version: version.version }
  }
}

function metadataText(value) {
  return typeof value === 'string' ? value : null
}

export function parseWorkbenchDetail(value, expectedId) {
  const item = parseWorkbenchListItem(value)
  if (!item || item.id !== expectedId) return null
  const version = value.current_version
  const artifactPath = `${PREFIX}/workbenches/${item.id}/versions/${item.currentVersion.id}/artifact`
  const sha256 = typeof version.sha256 === 'string' && SHA256.test(version.sha256) ? version.sha256 : ''
  const sizeBytes = Number.isSafeInteger(version.size_bytes) && version.size_bytes > 0 && version.size_bytes <= WORKBENCH_ARTIFACT_LIMIT
    ? version.size_bytes
    : 0
  const verifiable = Boolean(sha256 && sizeBytes && version.artifact_url === artifactPath)
  const metadata = value.package_metadata && typeof value.package_metadata === 'object' && !Array.isArray(value.package_metadata)
    ? value.package_metadata
    : {}
  const dependencies = Array.isArray(metadata.dependencies)
    ? metadata.dependencies.filter(entry => typeof entry === 'string')
    : []
  return {
    ...item,
    sha256: verifiable ? sha256 : '',
    sizeBytes: verifiable ? sizeBytes : 0,
    artifactPath: verifiable ? artifactPath : '',
    verifiable,
    packageMetadata: {
      repositoryUrl: metadataText(metadata.repository_url),
      patchEntryId: metadataText(metadata.patch_entry_id),
      serverEntry: metadataText(metadata.server_entry),
      clientEntry: metadataText(metadata.client_entry),
      bundlePatch: metadataText(metadata.bundle_patch),
      license: metadataText(metadata.license),
      nodeEngine: metadataText(metadata.node_engine),
      dependencies,
      legacyManifest: metadata.legacy_manifest === true
    }
  }
}

function parsePage(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.data) || !Number.isSafeInteger(value.total) || value.total < 0) {
    throw invalid('Invalid enterprise workbench catalog.')
  }
  return value
}

export function createWorkbenchMarketController(accountController) {
  let epoch = 0
  const identity = () => {
    const state = accountController.state()
    if (!state?.connected || !state.connectionKey) return ''
    return state.connectionKey
  }
  const changed = () => invalid('Enterprise account changed.', 409)
  const request = async (path) => {
    const started = epoch
    const key = identity()
    if (!key) throw invalid('Sign in to your enterprise account first.', 401)
    let data
    try {
      data = await accountController.marketRequest(PREFIX + path)
    } catch (error) {
      if (started !== epoch || identity() !== key) throw changed()
      if (error?.status === 404 || /\(404\)/u.test(error?.message ?? '')) {
        throw Object.assign(invalid('Enterprise workbench service is unavailable.', 404), { unavailable: true })
      }
      throw error
    }
    if (started !== epoch || identity() !== key) throw changed()
    if (!data || data.status_code !== 200) throw invalid(data?.status_message || 'Enterprise workbench request failed.')
    return data.data
  }
  const unavailableResult = () => ({
    status: 'unavailable', accountKey: identity(), data: [], total: 0, skipped: 0
  })

  return {
    stop() { epoch += 1 },
    async catalog() {
      const started = epoch
      const key = identity()
      if (!key) return { status: 'idle', accountKey: '', data: [], total: 0, skipped: 0 }
      try {
        const items = []
        let skipped = 0
        let seen = 0
        let total = 0
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const payload = parsePage(await request(`/workbenches?page=${page}&size=${PAGE_SIZE}`))
          if (page === 1) total = payload.total
          else if (payload.total !== total) throw invalid('Invalid enterprise workbench catalog.')
          if (payload.data.length === 0) break
          seen += payload.data.length
          for (const entry of payload.data) {
            const item = parseWorkbenchListItem(entry)
            if (item) items.push(item)
            else skipped += 1
          }
          if (seen >= total) break
          if (page === MAX_PAGES) throw invalid('Enterprise workbench catalog page limit exceeded.')
        }
        if (started !== epoch || identity() !== key) throw changed()
        if (total > 0 && items.length === 0) {
          return { status: 'error', accountKey: key, data: [], total, skipped, error: 'Enterprise workbench catalog could not be displayed.' }
        }
        return { status: items.length ? 'ready' : 'empty', accountKey: key, data: items, total, skipped }
      } catch (error) {
        if (error?.unavailable) return unavailableResult()
        if (started !== epoch || identity() !== key) throw changed()
        throw error
      }
    },
    async detail(id) {
      if (!HEX_ID.test(id ?? '')) throw invalid('Invalid workbench identifier.')
      try {
        const payload = await request(`/workbenches/${id}`)
        const detail = parseWorkbenchDetail(payload, id)
        if (!detail) throw invalid('Invalid enterprise workbench detail.')
        return { status: 'ready', accountKey: identity(), detail }
      } catch (error) {
        if (error?.unavailable) return { status: 'unavailable', accountKey: identity(), detail: null }
        throw error
      }
    },
    async verify(id) {
      const loaded = await this.detail(id)
      if (loaded.status !== 'ready' || !loaded.detail?.verifiable) {
        return { ok: false, stage: loaded.status === 'unavailable' ? 'unavailable' : 'detail', error: 'Workbench artifact cannot be verified.' }
      }
      if (typeof accountController.verifyWorkbenchArtifact !== 'function') {
        return { ok: false, stage: 'unavailable', error: 'Workbench artifact verification is unavailable.' }
      }
      const started = epoch
      const key = identity()
      const result = await accountController.verifyWorkbenchArtifact({
        id: loaded.detail.id,
        versionId: loaded.detail.currentVersion.id,
        sha256: loaded.detail.sha256,
        sizeBytes: loaded.detail.sizeBytes
      })
      if (started !== epoch || identity() !== key) throw changed()
      return result
    },
    async packageForInstall(id) {
      const loaded = await this.detail(id)
      if (loaded.status !== 'ready' || !loaded.detail?.verifiable) {
        throw invalid('Workbench artifact cannot be installed.', loaded.status === 'unavailable' ? 404 : 400)
      }
      if (typeof accountController.materializeWorkbenchArtifact !== 'function') {
        throw invalid('Enterprise workbench installation is unavailable.', 503)
      }
      const started = epoch
      const key = identity()
      const result = await accountController.materializeWorkbenchArtifact({
        id: loaded.detail.id,
        versionId: loaded.detail.currentVersion.id,
        sha256: loaded.detail.sha256,
        sizeBytes: loaded.detail.sizeBytes
      })
      const stale = started !== epoch || identity() !== key
      if (stale) {
        if (result?.ticket && result.connectionKey) await accountController.releaseWorkbenchArtifact?.(result.ticket, result.connectionKey)
        throw changed()
      }
      if (!result?.ok || typeof result.path !== 'string' || !result.path || typeof result.ticket !== 'string' || typeof result.connectionKey !== 'string') {
        throw invalid(result?.error || 'Workbench artifact cannot be installed.')
      }
      return {
        path: result.path,
        ticket: result.ticket,
        connectionKey: result.connectionKey,
        packageName: loaded.detail.packageName,
        version: loaded.detail.currentVersion.version
      }
    }
  }
}

export function applyEnterpriseWorkbenchMarket(ctx, accountController) {
  const market = createWorkbenchMarketController(accountController)
  const register = (path, methods, handler) => ctx.connection.fetch.register({
    path, methods, requestBody: 'buffered', fetch: async request => {
      try {
        await accountController.refreshState?.()
        return Response.json(await handler(request), { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const status = Number(error?.status) || 400
        return Response.json({ ok: false, status: 'error', error: error.message }, { status, headers: { 'cache-control': 'no-store' } })
      }
    }
  })
  register('/api/enterprise.workbenches/catalog', ['GET'], () => market.catalog())
  register('/api/enterprise.workbenches/detail', ['GET'], request => {
    const id = new URL(request.url).searchParams.get('id') || ''
    return market.detail(id)
  })
  register('/api/enterprise.workbenches/verify', ['POST'], async request => {
    const body = JSON.parse(await request.text() || '{}')
    return market.verify(body?.id)
  })
  return market
}
