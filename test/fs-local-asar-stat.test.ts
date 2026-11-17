import { Stats } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'

/**
 * Electron's ASAR view can return a numeric `fs.Stats` even when `bigint: true`
 * was requested. `probe()` and `probeNoFollow()` must mask `mode` without mixing
 * that Number with a BigInt literal, and without rewriting `mode` on the Stats
 * object: `Stats.prototype.isFile()` still does a Number bitwise test.
 *
 * Remove this compatibility when `@deepseek-ai/dsh-fs-local` no longer evaluates
 * `info.mode & 511n` (still present through 0.2.2-rc.3).
 */
type ScriptedStats = () => Stats

const scripted = vi.hoisted(() => ({
  stat: undefined as ScriptedStats | undefined,
  lstat: undefined as ScriptedStats | undefined,
  statOptions: [] as unknown[],
  lstatOptions: [] as unknown[]
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: async (
      path: Parameters<typeof actual.stat>[0],
      options?: Parameters<typeof actual.stat>[1]
    ) => {
      scripted.statOptions.push(options)
      if (scripted.stat) return scripted.stat()
      return actual.stat(path, options)
    },
    lstat: async (
      path: Parameters<typeof actual.lstat>[0],
      options?: Parameters<typeof actual.lstat>[1]
    ) => {
      scripted.lstatOptions.push(options)
      if (scripted.lstat) return scripted.lstat()
      return actual.lstat(path, options)
    }
  }
})

function asarStats(mode: number, size: number): Stats {
  const stats = Object.create(Stats.prototype) as Stats
  stats.mode = mode
  stats.size = size
  stats.dev = 1
  stats.ino = 1
  return stats
}

const filesystem = new LocalFileSystem(new Context(), {
  cwd: '/tmp',
  diffBasisMaxBytes: 10 * 1024 * 1024
})

describe('local filesystem ASAR stat compatibility', () => {
  beforeEach(() => {
    scripted.stat = undefined
    scripted.lstat = undefined
    scripted.statOptions.length = 0
    scripted.lstatOptions.length = 0
  })

  it('stats a numeric-mode file and directory without mixing BigInt', async () => {
    scripted.stat = () => asarStats(0o100644, 13880)
    const file = await filesystem.stat({
      targetKey: FsTargetKey('/virtual/app.asar/package.json'),
      displayPath: '/virtual/app.asar/package.json'
    })
    expect(file).toMatchObject({ type: 'file', size: 13880 })
    expect(scripted.statOptions).toEqual([{ bigint: true }])

    scripted.lstat = () => asarStats(0o040755, 0)
    const directory = await filesystem.lstat('/virtual/app.asar')
    expect(directory).toMatchObject({ type: 'directory', size: 0 })
    expect(scripted.lstatOptions).toEqual([{ bigint: true }])
  })

  it('keeps a numeric symlink mode on the Stats object so link detection still works', async () => {
    scripted.lstat = () => asarStats(0o120777, 11)
    const link = await filesystem.lstat('/virtual/app.asar/current')
    expect(link).toMatchObject({ type: 'symlink', size: 11 })
  })

  it('still treats a missing path as absent', async () => {
    scripted.stat = () => {
      const error = new Error('missing') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    await expect(filesystem.stat({
      targetKey: FsTargetKey('/virtual/app.asar/missing.txt'),
      displayPath: '/virtual/app.asar/missing.txt'
    })).resolves.toBeUndefined()
  })

  it('still reads BigInt stats from a real file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fs-local-asar-'))
    try {
      const file = join(directory, 'sample.txt')
      await writeFile(file, 'hello')
      const info = await filesystem.stat({
        targetKey: FsTargetKey(file),
        displayPath: file
      })
      expect(info).toMatchObject({ type: 'file', size: 5 })

      const linked = await filesystem.lstat(file)
      expect(linked).toMatchObject({ type: 'file', size: 5 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
