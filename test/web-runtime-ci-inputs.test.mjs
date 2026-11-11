import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { test, onTestFinished } from 'vitest'
import { copyInputs, materializeLinks, prepareProductionModules, readInstallFlags, resolveNpmCli, validateOutput } from '../scripts/prepare-web-ci-inputs.mjs'

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'web-ci-inputs-')))
  onTestFinished(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}
async function file(root, name, text = 'fixture') {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
  await fs.writeFile(path.join(root, name), text)
}
const link = (target, name) => fs.symlink(target, name, process.platform === 'win32' ? 'junction' : 'dir')

test('rejects relative, existing, overlapping and symlink-aliased outputs before writes', async () => {
  const root = await fixture()
  await fs.mkdir(path.join(root, 'packages'))
  await assert.rejects(validateOutput('relative', root), /absolute/)
  await assert.rejects(validateOutput(root, root), /overlap/)
  await assert.rejects(validateOutput(path.join(root, 'packages', 'new'), root), /overlap/)
  await assert.rejects(validateOutput(path.dirname(root), root), /overlap/)
  await fs.mkdir(path.join(root, '.tmp'))
  await fs.mkdir(path.join(root, '.tmp', 'existing'))
  await assert.rejects(validateOutput(path.join(root, '.tmp/existing'), root), /already exists/)
  await link(path.join(root, 'packages'), path.join(root, '.tmp/alias'))
  await assert.rejects(validateOutput(path.join(root, '.tmp/alias/new'), root), /Symlink/)
  assert.equal(await validateOutput(path.join(root, '.tmp/fresh'), root), path.join(root, '.tmp/fresh'))
})

test('copies maintained inputs without node_modules, cache, archives or credentials', async () => {
  const root = await fixture()
  const source = path.join(root, 'source')
  for (const name of ['package.json', 'index.js', '.env', '.env.production', '.npmrc', '.cache/private', 'node_modules/private/index.js', 'archive.tgz', 'src/code.js']) await file(source, name)
  const destination = path.join(root, 'copy')
  await copyInputs(source, destination)
  assert.equal(await fs.readFile(path.join(destination, 'src/code.js'), 'utf8'), 'fixture')
  for (const name of ['.env', '.env.production', '.npmrc', '.cache', 'node_modules', 'archive.tgz']) await assert.rejects(fs.lstat(path.join(destination, name)), { code: 'ENOENT' })
})

test('materializes approved file packages and nested dependencies without .bin or source secrets', async () => {
  const root = await fixture()
  const modules = path.join(root, 'node_modules'), pkg = path.join(root, 'packages', 'owned')
  await fs.mkdir(modules)
  await file(pkg, 'package.json', '{"name":"owned"}')
  await file(pkg, 'index.js')
  await file(pkg, '.env', 'must not copy')
  await file(modules, 'dependency/index.js')
  await file(modules, '.bin/tool', 'not a portable input')
  await link(pkg, path.join(modules, 'owned'))
  const destination = path.join(root, 'materialized')
  await assert.rejects(materializeLinks({ source: modules, destination: path.join(modules, 'nested'), allowedRoots: [pkg] }), /overlaps/)
  await materializeLinks({ source: modules, destination, allowedRoots: [pkg], expectedLinks: { [path.join(modules, 'owned')]: pkg } })
  assert.equal((await fs.lstat(path.join(destination, 'owned'))).isSymbolicLink(), false)
  assert.equal(await fs.readFile(path.join(destination, 'dependency/index.js'), 'utf8'), 'fixture')
  await assert.rejects(fs.lstat(path.join(destination, '.bin')), { code: 'ENOENT' })
  await assert.rejects(fs.lstat(path.join(destination, 'owned/.env')), { code: 'ENOENT' })
})

test('rejects links outside the approved package roots, missing packages, owner swaps and cycles', async () => {
  const root = await fixture()
  const modules = path.join(root, 'node_modules'), trusted = path.join(root, 'packages', 'trusted'), other = path.join(root, 'private-host')
  await fs.mkdir(modules)
  await file(trusted, 'package.json', '{"name":"trusted"}')
  await file(other, 'credentials.json', 'host secret')
  await link(other, path.join(modules, 'unsafe'))
  await assert.rejects(materializeLinks({ source: modules, destination: path.join(root, 'out1'), allowedRoots: [trusted] }), /escapes/)
  await fs.unlink(path.join(modules, 'unsafe'))
  await link(trusted, path.join(modules, 'trusted'))
  await assert.rejects(materializeLinks({ source: modules, destination: path.join(root, 'out2'), allowedRoots: [path.join(root, 'missing')] }), { code: 'ENOENT' })
  await assert.rejects(materializeLinks({ source: modules, destination: path.join(root, 'out3'), allowedRoots: [trusted, other], expectedLinks: { [path.join(modules, 'trusted')]: other } }), /owner/)
  await link(trusted, path.join(trusted, 'cycle'))
  await assert.rejects(materializeLinks({ source: modules, destination: path.join(root, 'out4'), allowedRoots: [trusted] }), /Cyclic/)
})

test('keeps only reviewed lock-shaping flags and never copies auth configuration', async () => {
  const root = await fixture()
  await file(root, '.npmrc', 'legacy-peer-deps=true\n//registry.invalid/:_authToken=fixture-secret\ninstall-links=false\n')
  assert.deepEqual(await readInstallFlags(root), ['--legacy-peer-deps=true', '--install-links=false'])
  await fs.writeFile(path.join(root, '.npmrc'), 'legacy-peer-deps=not-a-boolean\n')
  await assert.rejects(readInstallFlags(root), /literal booleans/)
})

test('missing declared local production packages fail before any installation starts', async () => {
  const root = await fixture()
  await fs.mkdir(path.join(root, 'packages'))
  await fs.mkdir(path.join(root, 'patches'))
  await fs.mkdir(path.join(root, 'scripts'))
  await file(root, 'package.json', JSON.stringify({ dependencies: { missing: 'file:packages/missing' } }))
  await file(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }))
  const staging = path.join(root, 'stage')
  await fs.mkdir(staging)
  await assert.rejects(prepareProductionModules({ staging, projectRoot: root, npmCli: path.join(root, 'must-not-run/npm-cli.js'), cache: path.join(root, 'cache') }), { code: 'ENOENT' })
  await assert.rejects(fs.lstat(path.join(staging, 'node_modules')), { code: 'ENOENT' })
})

test('does not run PATH npm and only resolves an actual npm-cli.js file', async () => {
  const root = await fixture()
  await file(root, 'bin/node', 'not executed')
  await file(root, 'lib/node_modules/npm/bin/npm-cli.js', 'not executed')
  assert.equal(await resolveNpmCli({ execPath: path.join(root, 'bin/node'), npmExecPath: path.join(root, 'npm.cmd') }), path.join(root, 'lib/node_modules/npm/bin/npm-cli.js'))
})
