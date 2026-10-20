import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface MobileAccessRecord {
  desktopId?: string
  attachSecret?: string
  displayName?: string
}

export interface MobileAccessStore {
  load(): MobileAccessRecord
  save(record: MobileAccessRecord): boolean
}

const ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u

export function mobileAccessStorePath(userDataPath: string): string {
  return `${userDataPath}/mobile-access.json`
}

export function createFileMobileAccessStore(path: string): MobileAccessStore {
  return {
    load: () => readMobileAccessRecord(path),
    save: (record) => writeMobileAccessRecord(path, record)
  }
}

export function readMobileAccessRecord(path: string): MobileAccessRecord {
  try {
    return parseMobileAccessRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return {}
  }
}

export function parseMobileAccessRecord(value: unknown): MobileAccessRecord {
  if (!isPlainObject(value)) return {}
  const record: MobileAccessRecord = {}
  if (typeof value.desktopId === 'string' && ID_PATTERN.test(value.desktopId)) {
    record.desktopId = value.desktopId
  }
  if (typeof value.attachSecret === 'string' && ID_PATTERN.test(value.attachSecret)) {
    record.attachSecret = value.attachSecret
  }
  if (typeof value.displayName === 'string') {
    const displayName = value.displayName.trim()
    if (displayName.length > 0 && displayName.length <= 80) record.displayName = displayName
  }
  return record
}

export function ensureMobileAccessIdentity(record: MobileAccessRecord): MobileAccessRecord {
  return {
    desktopId: record.desktopId ?? randomBytes(32).toString('base64url'),
    attachSecret: record.attachSecret ?? randomBytes(32).toString('base64url'),
    ...(record.displayName ? { displayName: record.displayName } : {})
  }
}

export function writeMobileAccessRecord(path: string, record: MobileAccessRecord): boolean {
  const document = parseMobileAccessRecord(record)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(document, undefined, 2)}\n`, { mode: 0o600 })
    if (existsSync(path)) unlinkSync(path)
    renameSync(temporary, path)
    return true
  } catch {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      // A false return already tells the caller the identity was not stored.
    }
    return false
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
