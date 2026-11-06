import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const harnessRoot = process.env.DSH_PPT_HARNESS_ROOT
const cleanups = []
afterEach(async () => { for (const run of cleanups.splice(0).reverse()) await run() })

// Opt-in: use the target's built Loader, WebServer and authenticated Connection.
// No install, Profile mutation, or interaction with the user's running listener.
async function fixture({ sandbox = true } = {}) {
  const target = path.resolve(harnessRoot)
  const require = createRequire(path.join(target, 'packages/boot/app-boot/package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: Loader } = await load('@deepseek-ai/cordis-plugin-loader')
  const { default: WebServer } = await import(pathToFileURL(path.join(target, 'packages/host/webserver/lib/index.js')).href)
  const connection = await import(pathToFileURL(path.join(target, 'packages/client/connection/lib/index.js')).href)
  const ppt = await import(pathToFileURL(path.resolve('.build/ppt-web/dsh-ppt-composer/lib/web-index.js')).href)
  const root = await mkdtemp(path.join(tmpdir(), 'ppt-target-http-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  let credential
  ctx.provide('credentials', { async modifyRecord(_key, change) { credential = await change(credential) ?? credential; return credential } })
  ctx.provide('tools', { register() {} })
  ctx.provide('skills', { registerProvider() {} })
  ctx.provide('systemPrompt', { section() {} })
  ctx.provide('workingDirectory', { ensure: async () => root })
  if (sandbox) ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
  await ctx.plugin(Loader)
  const modules = new Map([['webserver', WebServer], ['connection', connection], ['ppt', ppt]])
  ctx.loader.internal = { version: 'v2', async import(name) { if (!modules.has(name)) throw new Error('unexpected module ' + name); return modules.get(name) } }
  await ctx.loader.create({ name: 'webserver', config: { host: '127.0.0.1', port: 0 } })
  await ctx.loader.create({ name: 'connection', config: {} })
  const pptId = await ctx.loader.create({ name: 'ppt', config: { root: path.join(root, 'ppt') } })
  await ctx.loader.await()
  const server = ctx.get('webServer')
  server.registerFallback({ resource: () => Promise.resolve(new Response('static fallback')) })
  server.register({ kind: 'exact', path: '/', handler(req, res) { if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('fixture') } } })
  const base = server.getOrigin()
  const entry = ctx.loader.resolve(pptId)
  return { ctx, base, server, entry, root }
}

describe.skipIf(!harnessRoot)('PPT routes through the actual target Loader and HTTP services', () => {
  it('does not mistake an adapter fiber for activated core routes when a dependency is absent', async () => {
    const { base, ctx, entry, root } = await fixture({ sandbox: false })
    expect(entry.fiber.state).toBe(2) // target Cordis FiberState.ACTIVE is a compile-time enum
    expect((await fetch(base + '/dsh-ppt/state', { method: 'POST', body: '{}' })).status).toBe(405)
    expect(ctx.get('officeModes')).toBeUndefined()
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
    await ctx.loader.await()
    expect((await fetch(base + '/dsh-ppt/state', { method: 'POST', body: '{}' })).status).toBe(401)
    expect(ctx.get('officeModes')).toBeDefined()
  })
  it('registers authenticated legacy RPC and listed previews in target 0.2.2', async () => {
    const { ctx, base, entry } = await fixture()
    const post = (route, headers = {}, body = JSON.stringify({ rpcId: 'test-state', payload: { sessionId: 'session-test' } })) => fetch(base + route, { method: 'POST', headers, body })
    expect((await post('/dsh-ppt/state')).status).toBe(401)
    const login = await fetch(ctx.connection.authenticatedUrl(base + '/'), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy()
    for (const channel of ['/dsh-ppt', '/kimi-ppt']) {
      const result = await post(channel + '/state', { cookie })
      expect(result.status).toBe(200)
      expect(await result.json()).toMatchObject({ type: 'server-response', rpcId: 'test-state', result: { ok: true } })
    }
    expect((await post('/dsh-ppt/state', { cookie, origin: 'https://untrusted.invalid' })).status).toBe(403)
    expect((await post('/dsh-ppt/state', { cookie, 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post('/dsh-ppt/state', { cookie }, '{')).status).toBe(400)
    expect((await fetch(base + '/dsh-ppt/state')).status).toBe(405)
    const { previewFiles } = await import(pathToFileURL(path.resolve('.build/ppt-web/dsh-ppt-composer/vendor/dsh-ppt/lib/preview-manifest.js')).href)
    const hash = Object.keys(previewFiles)[0]
    expect((await fetch(base + '/dsh-ppt/previews/' + hash + '.jpg')).status).toBe(200)
    expect((await fetch(base + '/dsh-ppt/previews/' + '0'.repeat(64) + '.jpg')).status).toBe(404)
    await entry.fiber.dispose()
    expect((await post('/dsh-ppt/state', { cookie })).status).toBe(405)
    expect(ctx.get('officeModes')).toBeUndefined()
  })
})
