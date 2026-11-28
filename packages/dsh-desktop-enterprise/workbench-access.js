import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const HEX_ID = /^[a-f0-9]{32}$/u
const FILE = 'enterprise-installs.json'

function validRecord(id, record) {
  return HEX_ID.test(id) && record && typeof record === 'object' && !Array.isArray(record) &&
    record.id === id && typeof record.pluginName === 'string' && record.pluginName.length > 0
}

/**
 * Which enterprise catalog id each installed enterprise workbench came from.
 * Once an administrator hides a workbench the enterprise catalog no longer
 * lists it, so this record is the only way to ask about it again (F022).
 * @param {string} root Workbench data directory.
 */
export function createEnterpriseInstallStore(root) {
  const path = join(root, FILE)
  let queue = Promise.resolve()
  const read = async () => {
    let parsed
    try { parsed = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
      // Preserve damaged provenance rather than overwriting the only revocation record.
      if (error?.code !== 'ENOENT') throw error
      return {}
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid enterprise install records.')
    return Object.fromEntries(Object.entries(parsed).filter(([id, record]) => validRecord(id, record)))
  }
  const write = async (next) => {
    // A fresh profile has no workbench data directory until something is stored.
    await mkdir(root, { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  }
  // Serialize read-modify-write cycles from concurrent routes.
  const update = (change) => {
    const run = queue.then(async () => write(change(await read())))
    queue = run.catch(() => undefined)
    return run
  }
  return {
    read,
    record: (install) => update(current => ({
      ...current,
      [install.id]: { id: install.id, pluginName: install.pluginName, version: install.version, installedAt: new Date().toISOString() }
    })),
    forget: (ids) => update(current => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id)))),
    setRevoked: (id, revoked) => update(current => {
      if (!current[id]) return current
      const { revoked: _previous, ...rest } = current[id]
      return { ...current, [id]: revoked ? { ...rest, revoked: true } : rest }
    })
  }
}

/**
 * Disable installed enterprise workbenches the account may no longer use.
 * Installation and user data stay; a returned grant clears the reason but the
 * employee turns the workbench back on. When access cannot be confirmed
 * nothing changes (F022 AC-12, AC-13, AC-14).
 * @param {{ installs: ReturnType<typeof createEnterpriseInstallStore>, access: (ids: string[]) => Promise<Record<string, boolean>>, manager: { listBundles(): Promise<Array<{ name?: string, installed?: boolean }>>, setBundleEnabled(name: string, enabled: boolean): Promise<{ application?: string, error?: { diagnostic?: string, message?: string } }> } }} options
 * @returns {Promise<{ status: 'checked' | 'unknown', revoked: string[] }>}
 */
export async function checkEnterpriseWorkbenchAccess({ installs, access, manager }) {
  let records = await installs.read()
  let enabled = new Set()
  if (Object.keys(records).length) {
    // A workbench removed from the Plugins page or the startup recovery page
    // leaves its record behind; drop it rather than fail every later check.
    const bundles = await manager.listBundles()
    enabled = new Set(bundles.filter(bundle => bundle.enabled === true).map(bundle => bundle.name))
    const installed = new Set((Array.isArray(bundles) ? bundles : [])
      .filter(bundle => typeof bundle?.name === 'string' && bundle.installed !== false).map(bundle => bundle.name))
    const gone = Object.keys(records).filter(id => !installed.has(records[id].pluginName))
    if (gone.length) {
      await installs.forget(gone)
      records = await installs.read()
    }
  }
  const ids = Object.keys(records)
  const revokedNames = (current) => Object.values(current).filter(record => record.revoked).map(record => record.pluginName)
  if (!ids.length) return { status: 'checked', revoked: [] }
  let answer
  try { answer = await access(ids) } catch {
    // Offline, signed out, an older server or a failed decision: keep the last state.
    return { status: 'unknown', revoked: revokedNames(records) }
  }
  for (const id of ids) {
    const record = records[id]
    if (answer[id] === false && (!record.revoked || enabled.has(record.pluginName))) {
      const result = await manager.setBundleEnabled(record.pluginName, false)
      if (!['applied', 'restart-required'].includes(result?.application)) {
        throw new Error(result?.error?.diagnostic || result?.error?.message || `Could not disable ${record.pluginName}.`)
      }
      await installs.setRevoked(id, true)
    } else if (answer[id] === true && record.revoked) {
      await installs.setRevoked(id, false)
    }
  }
  return { status: 'checked', revoked: revokedNames(await installs.read()) }
}

/**
 * Record enterprise workbenches installed before this record existed. Only
 * catalog-listed (still visible) items whose package is installed and did not
 * come from the workbench market or a local directory are adopted; a known id
 * keeps its original record.
 * @param {{ installs: ReturnType<typeof createEnterpriseInstallStore>, manager: { listBundles(): Promise<Array<{ name?: string, installed?: boolean }>> }, items: unknown[], excluded?: Set<string> }} options
 * @returns {Promise<{ adopted: string[] }>}
 */
export async function adoptEnterpriseInstalls({ installs, manager, items, excluded = new Set() }) {
  const valid = (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object' && HEX_ID.test(item.id ?? '') &&
    typeof item.pluginName === 'string' && item.pluginName.length > 0 && typeof item.version === 'string' && !excluded.has(item.pluginName))
  if (!valid.length) return { adopted: [] }
  const current = await installs.read()
  const missing = valid.filter(item => !current[item.id])
  if (!missing.length) return { adopted: [] }
  const bundles = await manager.listBundles()
  const installedNames = new Set((Array.isArray(bundles) ? bundles : [])
    .filter(bundle => typeof bundle?.name === 'string' && bundle.installed !== false).map(bundle => bundle.name))
  const adopted = missing.filter(item => installedNames.has(item.pluginName))
  for (const item of adopted) await installs.record(item)
  return { adopted: adopted.map(item => item.pluginName) }
}

/** Enterprise policy owns provenance and revocation; the host owns activation. */
export function applyEnterpriseWorkbenchAccess(ctx, { root, account, market }) {
  const installs = createEnterpriseInstallStore(root)
  let current
  let pending
  const refresh = () => {
    if (pending) return pending
    const manager = current
    if (!manager) return Promise.resolve({ status: 'unknown', revoked: [] })
    pending = (async () => {
      await account.refreshState?.()
      const identity = account.state().connectionKey
      if (!account.state().connected || !identity) return { status: 'unknown', revoked: [] }
      const guard = () => {
        if (current !== manager || account.state().connectionKey !== identity || !account.state().connected) throw new Error('Enterprise account changed.')
      }
      // Read authoritative catalog metadata, never trust browser-submitted package identities.
      const catalog = await market.catalog()
      guard()
      const bundles = await manager.listBundles()
      guard()
      const excluded = new Set(bundles.filter(bundle => typeof bundle.source === 'string' && /^(?:file:|link:|\/|[A-Za-z]:[\\/]|\.\.?[\\/])/.test(bundle.source)).map(bundle => bundle.name))
      for (const file of ['market-installs.json', 'local-installs.json']) {
        let records
        try { records = JSON.parse(await readFile(join(root, file), 'utf8')) }
        catch (error) { if (error?.code === 'ENOENT') continue; throw error }
        for (const entry of Object.values(records)) if (typeof entry?.pluginName === 'string') excluded.add(entry.pluginName)
      }
      guard()
      await adoptEnterpriseInstalls({ installs, manager, excluded, items: (catalog.data || []).map(item => ({ id: item.id, pluginName: item.packageName, version: item.currentVersion?.version })) })
      guard()
      return checkEnterpriseWorkbenchAccess({ installs, access: async ids => {
        const answer = {}
        for (let offset = 0; offset < ids.length; offset += 500) Object.assign(answer, await market.checkAccess(ids.slice(offset, offset + 500)))
        guard()
        return answer
      }, manager: {
        listBundles: () => manager.listBundles(),
        setBundleEnabled: (name, enabled) => { guard(); return manager.setBundleEnabled(name, enabled) }
      } })
    })().finally(() => { pending = undefined })
    return pending
  }
  ctx.inject(['pluginManager'], scoped => {
    const manager = scoped.pluginManager
    current = manager
    let disposed = false
    let timer
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        if (disposed) return
        try { await refresh() } catch (error) { scoped.logger?.warn?.('Enterprise workbench access check failed: %s', error.message) }
        if (!disposed) scheduleLater()
      }, 100)
      timer.unref?.()
    }
    const scheduleLater = () => {
      clearTimeout(timer)
      timer = setTimeout(schedule, 60_000)
      timer.unref?.()
    }
    const off = scoped.on?.('plugin-manager/changed', schedule)
    schedule()
    return () => { disposed = true; clearTimeout(timer); off?.(); if (current === manager) current = undefined }
  })
  ctx.connection.fetch.register({ path: '/api/desktop-workbenches/enterprise-access-check', methods: ['POST'], requestBody: 'buffered', async fetch() {
    try { return Response.json(await refresh(), { headers: { 'cache-control': 'no-store' } }) }
    catch (error) { return Response.json({ status: 'unknown', error: error.message }, { status: 503, headers: { 'cache-control': 'no-store' } }) }
  } })
  return { record: install => installs.record(install), refresh }
}
