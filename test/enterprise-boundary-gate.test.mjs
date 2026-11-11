import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, onTestFinished } from 'vitest'
import { fileURLToPath } from 'node:url'
import { checkBoundary, checkPaths, collectChanges } from '../scripts/verify-upstream-boundary.mjs'

const script = fileURLToPath(new URL('../scripts/verify-upstream-boundary.mjs', import.meta.url))
function fixture(t, { baseline = true } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'boundary-gate-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const put = (file, text = 'content\n') => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), text)
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Boundary Fixture')
  git('config', 'user.email', 'boundary@example.invalid')
  git('config', 'core.filemode', 'true')
  put('.gitignore', 'node_modules/\ntmp/\n.tmp/\n')
  put('src/host/core.js', 'upstream\n')
  put('patches/sdk.patch', 'reviewed\n')
  put('packages/dsh-desktop-workbenches/enterprise-install.mjs')
  put('packages/dsh-desktop-workbenches/install-outcome.mjs')
  git('add', '.')
  git('commit', '-m', 'initial reviewed baseline')
  if (baseline) git('update-ref', 'refs/remotes/upstream/bisheng-adaptor', 'HEAD')
  const check = () => checkBoundary({ cwd, upstreamBase: 'upstream/bisheng-adaptor' })
  return { cwd, git, put, check }
}

test('invalid shell-bearing explicit baseline fails without executing a shell', t => {
  const f = fixture(t)
  const marker = path.join(f.cwd, 'injected')
  for (const ref of ['HEAD; touch ' + marker, '$(touch ' + marker + ')', '--help', '', 'HEAD\n']) {
    const result = spawnSync(process.execPath, [script], { cwd: f.cwd, env: { ...process.env, UPSTREAM_BASE: ref }, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(existsSync(marker), false)
  }
})

test('missing baseline refuses origin/main and HEAD~1 fallback', t => {
  const f = fixture(t, { baseline: false })
  f.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  assert.throws(f.check, /无法验证上游基准/)
  const env = { ...process.env }
  delete env.UPSTREAM_BASE
  assert.equal(spawnSync(process.execPath, [script], { cwd: f.cwd, env }).status, 1)
})

test('explicit verified commit is accepted', t => {
  const f = fixture(t)
  assert.deepEqual(checkBoundary({ cwd: f.cwd, upstreamBase: f.git('rev-parse', 'HEAD') }).illegalFiles, [])
})

test('unrelated reviewed history refuses merge-base fallback', t => {
  const f = fixture(t)
  f.git('checkout', '--orphan', 'unrelated')
  f.git('rm', '-rf', '.')
  f.put('unrelated.txt')
  f.git('add', '.')
  f.git('commit', '-m', 'unrelated')
  assert.throws(f.check, /merge-base/)
})

test('local committed, staged and working core edits are rejected', t => {
  const f = fixture(t)
  f.put('src/host/core.js', 'local\n')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
  f.git('add', '.')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
  f.git('commit', '-m', 'local core edit')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
})

test('staged core divergence cannot hide behind restored worktree bytes', t => {
  const f = fixture(t)
  f.put('src/host/core.js', 'staged local\n')
  f.git('add', '.')
  f.put('src/host/core.js', 'upstream\n')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
})

test('upstream core synchronization passes only for identical final bytes and mode', t => {
  const f = fixture(t)
  f.git('checkout', '-b', 'reviewed-update')
  f.put('src/host/core.js', 'reviewed update\n')
  f.git('add', '.')
  f.git('commit', '-m', 'reviewed upstream core update')
  f.git('update-ref', 'refs/remotes/upstream/bisheng-adaptor', 'HEAD')
  f.git('checkout', 'main')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
  f.put('packages/dsh-desktop-enterprise/local.js')
  f.git('add', '.')
  f.git('commit', '-m', 'enterprise branch')
  f.git('merge', '--no-edit', 'reviewed-update')
  assert.deepEqual(f.check().illegalFiles, [])
  chmodSync(path.join(f.cwd, 'src/host/core.js'), 0o755)
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
})

test('working and staged synchronization match upstream bytes before commit', t => {
  const f = fixture(t)
  const oldHead = f.git('rev-parse', 'HEAD')
  f.put('src/host/core.js', 'reviewed next\n')
  f.git('add', '.')
  f.git('commit', '-m', 'reviewed next core')
  f.git('update-ref', 'refs/remotes/upstream/bisheng-adaptor', 'HEAD')
  f.git('reset', '--hard', oldHead)
  f.put('src/host/core.js', 'reviewed next\n')
  assert.deepEqual(f.check().illegalFiles, [])
  f.git('add', '.')
  assert.deepEqual(f.check().illegalFiles, [])
  f.put('src/host/core.js', 'reviewed next\nlocal drift\n')
  assert.deepEqual(f.check().illegalFiles, ['src/host/core.js'])
})

test('core symlink replacement is rejected even when target bytes match', t => {
  const f = fixture(t)
  f.put('target.txt', 'upstream\n')
  rmSync(path.join(f.cwd, 'src/host/core.js'))
  symlinkSync('../../target.txt', path.join(f.cwd, 'src/host/core.js'))
  assert.ok(f.check().illegalFiles.includes('src/host/core.js'))
})

test('precise downstream enterprise, Web packaging and enterprise CI paths pass', t => {
  const f = fixture(t)
  const files = ['packages/dsh-desktop-enterprise/deep/new.js', 'scripts/pack-office-web.mjs', 'scripts/pack-ppt-web.mjs', 'scripts/pack-workbenches-web.mjs', 'scripts/pack-web-runtime.mjs', 'scripts/prepare-web-ci-inputs.mjs', '.github/workflows/release.yml', '.github/workflows/build-web-runtime.yml', '.github/workflows/verify-boundary.yml', '.github/workflows/bisheng-ci.yml', 'test/enterprise-bundle-fixture.d.mts', 'build/web-runtime/cordis.patch.yml', 'ops/ci/run.sh', 'ops/nginx/work-updates.conf', 'scripts/mock-bisheng-enterprise.d.mts']
  for (const file of files) f.put(file)
  assert.deepEqual(f.check().illegalFiles, [])
})

test('patches, prefix lookalikes and arbitrary scripts are never whitelisted', t => {
  const f = fixture(t)
  f.put('patches/sdk.patch', 'local patch\n')
  f.put('scripts/web-backdoor.mjs')
  f.put('.tmp-secret')
  assert.deepEqual(f.check().illegalFiles, ['.tmp-secret', 'patches/sdk.patch', 'scripts/web-backdoor.mjs'])
  assert.deepEqual(checkPaths(['patches/new.patch', '.tmp/a', '.tmp-secret']), ['patches/new.patch', '.tmp/a', '.tmp-secret'])
})

test('tracked temporary content fails both when staged and committed', t => {
  const f = fixture(t)
  f.put('.tmp/hidden.js')
  f.git('add', '-f', '.tmp/hidden.js')
  assert.deepEqual(f.check().illegalFiles, ['.tmp/hidden.js'])
  f.git('commit', '-m', 'tracked temporary source')
  assert.deepEqual(f.check().illegalFiles, ['.tmp/hidden.js'])
})

test('NUL-safe collection includes every nested untracked source and unusual filename', t => {
  const f = fixture(t)
  const files = ['rootsecret', 'untracked-dir/deep/source.js', 'untracked-dir/ space\nand\ttab.js']
  for (const file of files) f.put(file)
  assert.deepEqual(f.check().illegalFiles, [...files].sort())
  f.git('add', '--', 'untracked-dir')
  assert.deepEqual(f.check().illegalFiles, [...files].sort())
})

test('ignored node_modules/tmp and exact untracked .tmp directory stay excluded', t => {
  const f = fixture(t)
  for (const file of ['node_modules/pkg/source.js', 'tmp/cache.js', '.tmp/cache.js']) f.put(file)
  assert.deepEqual(collectChanges({ cwd: f.cwd, upstreamBase: 'upstream/bisheng-adaptor' }).files, [])
  f.put('.gitignore', 'node_modules/\ntmp/\n')
  assert.equal(f.check().files.includes('.tmp/cache.js'), false)
  assert.deepEqual(f.check().illegalFiles, [])
})

test('legacy enterprise adapter deletion passes, edits remain blocked', t => {
  const f = fixture(t)
  const file = 'packages/dsh-desktop-workbenches/enterprise-install.mjs'
  f.put(file, 'local edit\n')
  assert.deepEqual(f.check().illegalFiles, [file])
  rmSync(path.join(f.cwd, file))
  assert.deepEqual(f.check().illegalFiles, [])
  f.git('add', '-u')
  assert.deepEqual(f.check().illegalFiles, [])
  f.git('commit', '-m', 'remove migrated enterprise adapter')
  assert.deepEqual(f.check().illegalFiles, [])
})
