import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

describe('downstream patch provenance', () => {
  it('keeps every current patch byte-identical to the V0.14.1 baseline', () => {
    const patches = readdirSync(path.join(root, 'patches')).filter(name => name.endsWith('.patch')).sort()
    expect(patches.length).toBeGreaterThan(0)
    for (const name of patches) {
      expect(() => git('cat-file', '-e', `upstream/V0.14.1:patches/${name}`)).not.toThrow()
    }
    expect(git('diff', '--quiet', 'upstream/V0.14.1', '--', 'patches')).toBe('')
    const report = readFileSync(path.join(root, 'docs/downstream-patch-provenance.md'), 'utf8')
    for (const name of patches) expect(report).toContain('`' + name + '`')
  })
})
