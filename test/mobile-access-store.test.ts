import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mobileAccessStorePath,
  readMobileAccessRecord,
  writeMobileAccessRecord
} from '../src/main/mobile/mobile-access-store'

const faults = vi.hoisted(() => ({ renameTarget: undefined as string | undefined }))

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (String(args[1]) === faults.renameTarget) {
        throw Object.assign(new Error('Injected replacement failure'), { code: 'EPERM' })
      }
      return fs.renameSync(...args)
    }
  }
})

const directories: string[] = []

function temporaryStore() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'mobile-access-store-')))
  directories.push(directory)
  return { directory, path: mobileAccessStorePath(directory) }
}

afterEach(() => {
  faults.renameTarget = undefined
  for (const directory of directories.splice(0)) {
    // Only remove the exact real temporary directory created by this fixture.
    if (resolve(directory) !== directory || !directory.startsWith(join(realpathSync(tmpdir()), 'mobile-access-store-'))) {
      throw new Error('Refusing to clean an unexpected fixture directory')
    }
    rmSync(directory, { recursive: true, force: true })
  }
})

const original = { desktopId: 'd'.repeat(32), attachSecret: 's'.repeat(32), displayName: 'Original desktop' }
const updated = { ...original, displayName: 'Renamed desktop' }

describe('mobile access identity replacement', () => {
  it('atomically replaces an existing identity and leaves no temporary file', () => {
    const { directory, path } = temporaryStore()
    expect(writeMobileAccessRecord(path, original)).toBe(true)
    expect(writeMobileAccessRecord(path, updated)).toBe(true)
    expect(readMobileAccessRecord(path)).toEqual(updated)
    expect(readdirSync(directory)).toEqual(['mobile-access.json'])
  })

  it('preserves the original identity bytes and cleans the temporary file when rename fails', () => {
    const { directory, path } = temporaryStore()
    expect(writeMobileAccessRecord(path, original)).toBe(true)
    const originalBytes = readFileSync(path)
    faults.renameTarget = path
    expect(writeMobileAccessRecord(path, updated)).toBe(false)
    expect(readFileSync(path)).toEqual(originalBytes)
    expect(readMobileAccessRecord(path)).toEqual(original)
    expect(readdirSync(directory)).toEqual(['mobile-access.json'])
    faults.renameTarget = undefined
    expect(writeMobileAccessRecord(path, updated)).toBe(true)
    expect(readMobileAccessRecord(path)).toEqual(updated)
    expect(readdirSync(directory)).toEqual(['mobile-access.json'])
  })

  it('reports a failed first rename without publishing a partial identity or retaining the temporary file', () => {
    const { directory, path } = temporaryStore()
    faults.renameTarget = path
    expect(writeMobileAccessRecord(path, original)).toBe(false)
    expect(readMobileAccessRecord(path)).toEqual({})
    expect(readdirSync(directory)).toEqual([])
  })
})
