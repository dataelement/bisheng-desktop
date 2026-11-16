import { readFile, rename, writeFile } from 'node:fs/promises'
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
      // A missing or damaged file means nothing is known; installs re-record themselves.
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      return {}
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, record]) => validRecord(id, record)))
  }
  const write = async (next) => {
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
 * @param {{ installs: ReturnType<typeof createEnterpriseInstallStore>, access: (ids: string[]) => Promise<Record<string, boolean>>, manager: { setBundleEnabled(name: string, enabled: boolean): Promise<{ application?: string, error?: { diagnostic?: string, message?: string } }> } }} options
 * @returns {Promise<{ status: 'checked' | 'unknown', revoked: string[] }>}
 */
export async function checkEnterpriseWorkbenchAccess({ installs, access, manager }) {
  const records = await installs.read()
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
    if (answer[id] === false && !record.revoked) {
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
