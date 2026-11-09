import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProfileImport } from '../scripts/check-web-runtime-import.mjs'

describe('offline runtime profile import preflight', () => {
  it('imports from profile and reports missing exports without modifying profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-check-'))
    try {
      const profile = join(root, 'data', 'profiles', 'web')
      const plugin = join(root, 'node_modules', 'plugin')
      const host = join(root, 'node_modules', 'host')
      mkdirSync(profile, { recursive: true })
      mkdirSync(plugin, { recursive: true })
      mkdirSync(host, { recursive: true })
      writeFileSync(join(profile, 'package.json'), '{}')
      writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'plugin', type: 'module', exports: { import: './index.js' } }))
      writeFileSync(join(plugin, 'index.js'), "import { required } from 'host'; if (required !== 42) throw Error('wrong host')")
      writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'host', type: 'module', exports: './index.js' }))
      writeFileSync(join(host, 'index.js'), 'export const required = 42')
      assert.equal(checkProfileImport({ profile, specifier: 'plugin' }).status, 0)
      writeFileSync(join(host, 'index.js'), 'export const other = 42')
      const broken = checkProfileImport({ profile, specifier: 'plugin' })
      assert.notEqual(broken.status, 0)
      assert.match(broken.stderr, /does not provide an export named 'required'/)
      assert.match(checkProfileImport({ profile, specifier: 'missing-plugin' }).stderr, /missing-plugin/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
