/**
 * Run with packaged Electron in Node mode; broker responses are local fixtures.
 * Requires a rebuilt package and search ZIP using enterpriseAuth.request(path, init),
 * parsing Response.json(), and owning provider selection/restoration itself. Old
 * enterpriseSearch-service bundles are intentionally incompatible with this verifier.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const [resourcesArg, bundleArg] = process.argv.slice(2)
if (!resourcesArg || !bundleArg) throw new Error('Expected Resources directory and plugin ZIP')
const resources = resolve(resourcesArg)
const archive = join(resources, 'app.asar')
const dshEntry = join(archive, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const { registerHostModuleFallback } = await import(pathToFileURL(join(resources, 'host-module-fallback.mjs')).href)
const hook = registerHostModuleFallback(dshEntry)
const { Context } = await import(pathToFileURL(join(archive, 'node_modules/@deepseek-ai/cordis/lib/index.js')).href)
const { Loader } = await import(pathToFileURL(join(archive, 'node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js')).href)
const enterprise = await import(pathToFileURL(join(archive, 'node_modules/dsh-desktop-enterprise/index.js')).href)
const { sha256, readBundleZip } = await import(pathToFileURL(join(archive, 'node_modules/dsh-desktop-enterprise/offline-bundle.js')).href)
const bytes = await readFile(resolve(bundleArg))
const manifest = JSON.parse(readBundleZip(bytes).get('manifest.json').data.toString())
assert.equal(manifest.plugin.name, 'bs-web-search')
const home = await mkdtemp(join(tmpdir(), 'packaged-bs-search-'))
process.env.DSH_HOME = home
const capability = randomUUID(), pluginId = 'a'.repeat(32), versionId = 'b'.repeat(32)
const digest = sha256(bytes)
let downloads = 0, searches = 0
const grants = new Map()
const authState = { connected: true, enterpriseId: '2', userId: '20', sessionVersion: 'packaged-session' }
const server = createServer(async (req, res) => {
  try {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '')
    const instanceRequest = req.url === '/v1/auth/state' || req.url === '/v1/auth/request'
    assert.ok(instanceRequest ? grants.has(bearer) : bearer === capability, 'Unexpected broker capability owner')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null
    let data
    if (req.url === '/v1/state') data = { connected: true, connectionKey: 'test-account', desktopVersion: '1.0.1', base: 'https://enterprise.example', tenant: { id: '2' }, user: { id: '20' }, models: [], modelsAvailable: false }
    else if (req.url === '/v1/auth/grant') {
      assert.equal(typeof input.pluginId, 'string')
      assert.equal(typeof input.instanceId, 'string')
      assert.ok(![...grants.values()].some(value => value.instanceId === input.instanceId))
      const key = randomUUID()
      grants.set(key, input)
      data = { capability: key }
    } else if (req.url === '/v1/auth/revoke') {
      grants.delete(input.capability)
      data = { ok: true }
    } else if (req.url === '/v1/auth/state') data = authState
    else if (req.url === '/v1/auth/request') {
      searches++
      assert.equal(input.sessionVersion, authState.sessionVersion)
      assert.equal(input.path, '/v1/alpha/search', 'Rebuild the search plugin to use enterpriseAuth.request with its own business path')
      assert.equal(input.method, 'POST')
      const body = JSON.parse(input.body)
      assert.equal(body.query, 'test query')
      data = { output: 'Packaged search passed', results: [{ url: 'https://example.com', title: 'Example' }] }
    } else if (req.url === '/v1/market') {
      if (input.path.endsWith('/artifact')) { downloads++; res.end(bytes); return }
      let payload
      if (input.path.endsWith('/capabilities')) payload = { enabled: true, contract_version: 2, tenant_id: '2', sync_seconds: 60 }
      else if (input.path.endsWith('/sync')) {
        payload = { tenant_id: '2', user_id: '20', device_id: input.body.device_id, synced_at: Math.floor(Date.now() / 1000), policies: [{ plugin_id: pluginId, name: 'bs-web-search', revision: 1, disabled: false, current_version_id: versionId, versions: [{ id: versionId, digest }] }] }
      } else if (input.path.includes('/catalog?')) payload = { data: [{ id: pluginId, name: 'bs-web-search', display_name: 'Search', revision: 1, current_version_id: versionId, versions: [{ id: versionId, version: manifest.plugin.version, digest, manifest }] }], total: 1 }
      else throw new Error('Unexpected market path')
      data = { status_code: 200, data: payload }
    } else throw new Error('Unexpected broker path')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(data))
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
process.env.DSH_DESKTOP_ENTERPRISE_BROKER_URL = 'http://127.0.0.1:' + server.address().port
process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY = capability
const ctx = new Context()
try {
  const profile = join(home, 'profiles/web')
  await mkdir(profile, { recursive: true })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(profile + '/').href })
  const webId = await ctx.loader.create({ name: '@deepseek-ai/dsh-web', config: { searchProvider: 'previous', fetchProvider: 'http' } })
  await ctx.loader.store[webId].fiber.await()
  const routes = new Map()
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } })
  ctx.provide('llm', { registerAdapter() { return () => {} } })
  await ctx.plugin(enterprise)
  await ctx.loader.await()
  const action = async action => {
    const response = await routes.get('/api/enterprise.market.action').fetch(new Request('http://127.0.0.1/api/enterprise.market.action', { method: 'POST', body: JSON.stringify({ action, plugin_id: pluginId }) }))
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  const installed = await action('install')
  assert.equal(installed.installed[0].status, 'enabled')
  assert.equal(downloads, 1)
  const result = await ctx.web.search({ query: 'test query' })
  assert.equal(result.content, 'Packaged search passed')
  assert.equal(result.sources[0].url, 'https://example.com/')
  assert.equal(searches, 1)
  await assert.rejects(stat(join(home, 'profiles/node_modules')), { code: 'ENOENT' })
  await action('disable')
  assert.equal(ctx.loader.store[webId].fiber.config.searchProvider, 'previous', 'The search plugin must restore its own provider selection')
  assert.equal(grants.size, 0, 'Disabling must revoke the instance grant')
  await action('enable')
  await action('uninstall')
  assert.equal(grants.size, 0, 'Uninstalling must revoke the instance grant')
  console.log(JSON.stringify({ status: 'passed', runtime: process.versions.electron, plugin: manifest.plugin.name, version: manifest.plugin.version, downloaded: downloads, searches, sharedProfileModules: false, lifecycle: ['install', 'search', 'disable', 'enable', 'uninstall'] }))
} finally {
  await ctx.fiber.dispose()
  await new Promise(resolve => server.close(resolve))
  hook.deregister()
  await rm(home, { recursive: true, force: true })
}
