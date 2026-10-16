/** Real ASGI import, account-bound Desktop installation and Cordis activation. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { createMarketController } from '../../packages/dsh-desktop-enterprise/market.js'
import { zipEntries } from '../../scripts/pack-enterprise-plugin.mjs'

const [python, backend] = process.argv.slice(2)
assert.ok(python && backend, 'Pass Python and the BISHENG backend directory')
const { privateKey } = generateKeyPairSync('ed25519')
const child = spawn(python, ['-m', 'test.dsh_market.rpc_harness'], {
  cwd: resolve(backend), stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, BISHENG_DSH_MARKET_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
})
const pending = new Map()
let sequence = 0
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  const response = JSON.parse(line), item = pending.get(response.id)
  if (item) { pending.delete(response.id); clearTimeout(item.timer); item.resolve(response) }
})
child.on('exit', code => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Backend harness exited: ${code}`)) }
  pending.clear()
})
function request(method, path, extra = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Backend harness timeout')) }, 15000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, path, ...extra }) + '\n')
  })
}
function artifact(version, failing = false) {
  return zipEntries({
    'package.json': Buffer.from(JSON.stringify({ name: 'community-pair', version, type: 'module', main: 'index.js', dependencies: { semver: '7.8.5' } })),
    'index.js': Buffer.from(failing ? 'export function apply() { throw new Error("community update failed") }'
      : 'import semver from "semver"; export function apply(ctx) { if (!semver.valid("1.0.0")) throw new Error("dependency failed"); ctx.effect(() => () => {}, "community pair") }')
  })
}
const home = await mkdtemp(join(tmpdir(), 'enterprise-community-pair-'))
await mkdir(join(home, 'profiles/node_modules'), { recursive: true })
const account = { connected: true, base: 'https://fixture.invalid', desktopVersion: '1.0.1', tenant: { id: '2' }, user: { id: '20' } }
const ctx = new Context()
const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(`${home}/`).href })
await loader
let market
ctx.loader.builtins.enterprisePair = { apply(scope) {
  market = createMarketController(scope, { state: () => account, async marketRequest(path, body, binary) {
    const response = await request(body === undefined ? 'GET' : 'POST', path, body === undefined ? {} : { body })
    assert.equal(response.status, 200, JSON.stringify(response))
    return binary ? Buffer.from(response.data.artifact, 'base64') : response.data
  } }, { home })
} }
const owner = await ctx.loader.create({ name: 'cordis:enterprisePair' })
await ctx.loader.await()
try {
  const imported = await request('POST', '/api/v1/dsh/market/admin/imports', { artifact: artifact('1.0.0').toString('base64') })
  assert.equal(imported.data.data.status, 'completed', JSON.stringify(imported))
  const catalog = await market.catalog()
  assert.equal(catalog.total, 1)
  const plugin = catalog.data[0]
  assert.equal(plugin.versions[0].manifest.schema_version, 2)
  assert.equal(plugin.versions[0].compatible, true)
  await market.act({ action: 'install', plugin_id: plugin.id })
  assert.equal(market.state().installed[0].status, 'enabled')
  await market.stop()
  await market.synchronize()
  assert.equal(market.state().installed[0].status, 'enabled')
  const failedUpdate = await request('POST', '/api/v1/dsh/market/admin/imports', { artifact: artifact('1.1.0', true).toString('base64') })
  assert.equal(failedUpdate.data.data.status, 'completed')
  await assert.rejects(market.act({ action: 'install', plugin_id: plugin.id }), /community update failed/)
  assert.equal(market.state().installed[0].version, '1.0.0')
  assert.equal(market.state().installed[0].status, 'enabled')
  await market.act({ action: 'uninstall', plugin_id: plugin.id })
  assert.equal(market.state().installed.length, 0)
  console.log(JSON.stringify({ import: 'PASS', catalog: 'PASS', dependencyInstall: 'PASS', realLoader: 'PASS',
    restart: 'PASS', failedUpdateRollback: 'PASS', uninstall: 'PASS', manifest: 'DERIVED_FROM_PACKAGE_JSON', identity: 'INJECTED_TEST_ACTOR' }))
} finally {
  await market.stop(); await ctx.loader.remove(owner); await loader.dispose()
  child.stdin.end(); child.kill(); lines.close()
  await rm(home, { recursive: true, force: true })
}
