/** Pair the actual ASGI market routes with Desktop installation and Cordis. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createMarketController } from '../../packages/dsh-desktop-enterprise/market.js'
import { sha256 } from '../../packages/dsh-desktop-enterprise/offline-bundle.js'
import { zipEntries } from '../../scripts/pack-enterprise-plugin.mjs'

const [python, backend] = process.argv.slice(2)
assert.ok(python && backend, 'Pass the Python executable and BISHENG src/backend directory')
const environment = { ...process.env }
delete environment.BISHENG_DSH_MARKET_SIGNING_KEY
const child = spawn(python, ['-m', 'test.dsh_market.rpc_harness'], { cwd: resolve(backend), env: environment, stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = new Map()
let sequence = 0
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  const response = JSON.parse(line)
  const pending = waiting.get(response.id)
  if (pending) { waiting.delete(response.id); clearTimeout(pending.timer); pending.resolve(response) }
})
child.on('exit', code => {
  for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error(`Backend harness exited: ${code}`)) }
  waiting.clear()
})
function request(method, path, extra = {}) {
  const id = ++sequence
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Backend harness timeout')) }, 15000)
    waiting.set(id, { resolve: resolveResponse, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, path, ...extra }) + '\n')
  })
}

const home = await mkdtemp(join(tmpdir(), 'market-backend-pair-'))
await mkdir(join(home, 'profiles/node_modules'), { recursive: true })
const target = `${process.platform}-${process.arch}`
const files = {
  'node_modules/company-demo/package.json': Buffer.from(JSON.stringify({ name: 'company-demo', version: '1.0.0', type: 'module', main: 'index.js' })),
  'node_modules/company-demo/index.js': Buffer.from('export function apply(ctx) { ctx.effect(() => () => {}, "pair-smoke") }')
}
const manifest = { schema_version: 1, plugin: {
  name: 'company-demo', version: '1.0.0', display_name: 'Company Demo', description: 'Pair smoke',
  publisher: 'QA', license: 'MIT', desktop_min: '0.9.1', permissions: [], services: []
}, targets: { [target]: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])) } }
const bytes = zipEntries({ 'manifest.json': Buffer.from(JSON.stringify(manifest)), ...Object.fromEntries(Object.entries(files).map(([name, data]) => [`bundles/${target}/${name}`, data])) })
const account = { connected: true, base: 'https://fixture.invalid', desktopVersion: '0.9.2', tenant: { id: '2' }, user: { id: '20' }, sessionExpiresAt: new Date(Date.now() + 600000).toISOString() }
const ctx = new Context()
const active = new Set()
const market = createMarketController(ctx, {
  state: () => account,
  async marketRequest(path, body, binary) {
    const result = await request(body === undefined ? 'GET' : 'POST', path, body === undefined ? {} : { body })
    assert.equal(result.status, 200, JSON.stringify(result))
    return binary ? Buffer.from(result.data.artifact, 'base64') : result.data
  }
}, { home, target, load: async record => {
  const module = await import(pathToFileURL(join(record.directory, 'node_modules/company-demo/index.js')).href)
  const fiber = ctx.plugin(module, record.config)
  await fiber
  active.add(record.plugin_id)
  return { dispose: async () => { active.delete(record.plugin_id); await fiber.dispose() } }
} })
try {
  const imported = await request('POST', '/api/v1/dsh/market/admin/imports', { artifact: bytes.toString('base64') })
  assert.equal(imported.data.data.status, 'completed')
  const catalog = await market.catalog()
  assert.equal(catalog.installReady, true)
  assert.equal(catalog.total, 1)
  const plugin = catalog.data[0]
  await market.act({ action: 'install', plugin_id: plugin.id })
  assert.equal(active.size, 1)
  assert.equal(market.state().installed[0].status, 'enabled')
  await market.stop()
  assert.equal(active.size, 0)
  await market.synchronize()
  assert.equal(active.size, 1)
  await market.act({ action: 'uninstall', plugin_id: plugin.id })
  assert.equal(active.size, 0)
  console.log(JSON.stringify({ import: 'PASS', catalog: 'PASS', install: 'PASS', realCordis: 'PASS', restart: 'PASS', uninstall: 'PASS', signingKey: 'REMOVED', identity: 'INJECTED_TEST_ACTOR' }))
} finally {
  await market.stop()
  child.stdin.end(); child.kill(); lines.close()
  await rm(home, { recursive: true, force: true })
}
