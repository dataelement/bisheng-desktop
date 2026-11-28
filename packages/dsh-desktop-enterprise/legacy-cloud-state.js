import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, linkSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { emptyState, validateState, MAX_STATE_BYTES } from './cloud-workbench-state.js'
import { validCloudId } from './cloud-record.js'

/** Run before Host startup. Keep the exact original beside the projected public state. */
export function adoptLegacyCloudState(root) {
  const path = join(root, 'state.json')
  if (!existsSync(path)) return false
  const raw = readFileSync(path)
  if (raw.length > MAX_STATE_BYTES) throw new Error('Workbench state exceeds its size limit.')
  const saved = JSON.parse(raw.toString('utf8'))
  if (!saved.state || (!Object.hasOwn(saved.state, 'cloudWorkbenches') && !Object.hasOwn(saved.state, 'cloudDevelopmentSessions') && !JSON.stringify(saved.state).includes('cloud:'))) return false
  if (!Number.isSafeInteger(saved.revision) || saved.revision < 0 || saved.revision === Number.MAX_SAFE_INTEGER) throw new Error('Invalid legacy workbench revision.')
  const state = validateState({ favorites: [], hiddenWorkspaces: {}, ...saved.state })
  const lock = join(root, '.enterprise-cloud-adoption.lock')
  // Refuse concurrent startup. An interrupted lock is evidence, never silently discarded.
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
  const temporary = join(root, `.state-${randomUUID()}.tmp`)
  try {
    const digest = createHash('sha256').update(raw).digest('hex')
    const backup = join(root, `state.v131-${digest}.json`)
    if (!existsSync(backup)) writeFileSync(backup, raw, { flag: 'wx', mode: 0o600 })
    else if (!readFileSync(backup).equals(raw)) throw new Error('Legacy state backup conflicts with current data.')
    const archive = join(root, 'enterprise-cloud-v131.json')
    if (!existsSync(archive)) writeFileSync(archive, raw, { flag: 'wx', mode: 0o600 })
    else if (!readFileSync(archive).equals(raw)) throw new Error('Legacy cloud state already exists with different content.')
    const projected = emptyState()
    for (const key of ['added', 'pinned', 'favorites']) projected[key] = state[key].filter(id => !validCloudId(id))
    projected.active = validCloudId(state.active) ? null : state.active
    projected.sessionBindings = Object.fromEntries(Object.entries(state.sessionBindings).filter(([, owner]) => !validCloudId(owner)))
    for (const key of ['recentSessions', 'notes', 'hiddenWorkspaces']) projected[key] = Object.fromEntries(Object.entries(state[key]).filter(([owner]) => !validCloudId(owner)))
    validateState(projected)
    writeFileSync(temporary, JSON.stringify({ revision: saved.revision + 1, state: projected }), { flag: 'wx', mode: 0o600 })
    if (!readFileSync(path).equals(raw)) throw new Error('Workbench state changed during legacy adoption.')
    renameSync(temporary, path)
    return true
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
    unlinkSync(lock)
  }
}

/** Project only this account's legacy cloud entries; leave the archive immutable. */
export function readLegacyCloudState(root, connectionKey, projectsRoot) {
  const path = join(root, 'enterprise-cloud-v131.json')
  if (!existsSync(path)) return undefined
  const raw = readFileSync(path)
  if (raw.length > MAX_STATE_BYTES) throw new Error('Legacy cloud state exceeds its size limit.')
  const saved = JSON.parse(raw.toString('utf8'))
  const state = validateState({ favorites: [], hiddenWorkspaces: {}, ...saved.state })
  const records = Object.fromEntries(Object.entries(state.cloudWorkbenches || {}).filter(([, entry]) => entry.connectionKey === connectionKey))
  const owns = id => Object.hasOwn(records, id)
  const result = { ...emptyState(), cloudWorkbenches: records, cloudDevelopmentSessions: {} }
  for (const key of ['added', 'pinned', 'favorites']) result[key] = state[key].filter(owns)
  result.active = owns(state.active) ? state.active : null
  result.sessionBindings = Object.fromEntries(Object.entries(state.sessionBindings).filter(([, owner]) => owns(owner)))
  for (const key of ['recentSessions', 'notes', 'hiddenWorkspaces']) result[key] = Object.fromEntries(Object.entries(state[key]).filter(([owner]) => owns(owner)))
  for (const [session, project] of Object.entries(state.cloudDevelopmentSessions || {})) {
    // Standalone development conversations have no cloud workbench binding.
    // V1.3.1's project registry is the authoritative account owner in that case.
    let owner
    if (projectsRoot) {
      try {
        const directory = join(projectsRoot, project), metadata = join(directory, 'origin.json')
        const entry = lstatSync(directory), file = lstatSync(metadata)
        if (entry.isSymbolicLink() || file.isSymbolicLink() || !file.isFile() || file.size > 4096) throw new Error('Invalid legacy cloud project metadata.')
        owner = JSON.parse(readFileSync(metadata, 'utf8')).connectionKey
        if (typeof owner !== 'string' || !/^[a-f0-9]{16}$/.test(owner)) throw new Error('Invalid legacy cloud project identity.')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // Missing source remains recoverable from the untouched legacy archive.
      }
    }
    if (owner === connectionKey || owner === undefined && Object.hasOwn(result.sessionBindings, session)) result.cloudDevelopmentSessions[session] = project
  }
  return result
}

/** Atomically seed an absent enterprise store without applying new-session admission to legacy bindings. */
export function seedLegacyCloudState(root, filename, state) {
  validateState(state)
  mkdirSync(root, { recursive: true })
  const temporary = join(root, `.cloud-import-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ revision: 1, state }), { flag: 'wx', mode: 0o600 })
    try { linkSync(temporary, join(root, filename)) } catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
