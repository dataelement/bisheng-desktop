import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extract } from 'tar'
import { expect, it } from 'vitest'

it('packs the protection exports with the complete legacy contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-protection-closure-'))
  try {
    const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'pack', resolve('packages/dsh-desktop-market-installer'), '--json', '--ignore-scripts',
      '--offline', '--cache', join(root, 'npm-cache'), '--pack-destination', root
    ], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
    expect(pack.status, pack.error?.message ?? pack.stderr).toBe(0)
    const [{ filename }] = JSON.parse(pack.stdout)
    const target = join(root, 'node_modules', 'dsh-desktop-market-installer')
    await mkdir(target, { recursive: true })
    await extract({ file: join(root, filename), cwd: target, strip: 1 })
    const script = `
      import assert from 'node:assert/strict'
      import { isProtectedProfileBundle as current } from 'dsh-desktop-market-installer/profile-protection'
      import { isProtectedProfileBundle as legacy } from 'dsh-desktop-market-installer/enterprise-policy'
      assert.equal(legacy, current)
      const protectedNames = [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
        'dsh-desktop-log-bridge', 'dsh-desktop-client-ui', 'dsh-desktop-enterprise',
        'dsh-desktop-market-installer', 'dsh-image-generation', 'dsh-ppt',
        'dsh-ppt-composer', 'dsh-desktop-hmr-fallback', 'dsh-desktop-preset-transfer',
        'dsh-desktop-workbenches', 'dsh-desktop-onboarding', 'dsh-desktop-office'
      ]
      for (const name of protectedNames) assert.equal(current(name), true, name)
      for (const name of ['community-plugin', 'dshmarket', '', undefined, null]) {
        assert.equal(current(name), false, String(name))
      }
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '', DSH_HOME: join(root, 'home') }
    })
    expect(child.status, child.error?.message ?? child.stderr).toBe(0)
    await rm(join(target, 'enterprise-policy.mjs'))
    const standalone = spawnSync(process.execPath, ['--input-type=module', '-e', "import { isProtectedProfileBundle } from 'dsh-desktop-market-installer/profile-protection'; if (!isProtectedProfileBundle('dsh-desktop-enterprise')) process.exit(1)"], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '', DSH_HOME: join(root, 'home') }
    })
    expect(standalone.status, standalone.error?.message ?? standalone.stderr).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
