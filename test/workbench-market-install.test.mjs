import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readInstallEvidence } from '../packages/dsh-desktop-workbenches/install-evidence.mjs'
import { apply } from '../packages/dsh-desktop-workbenches/index.js'
import {
  createMarketInstallStore, detachWorkbenchPackage, MAX_PACKAGE_BYTES, MarketInstallError, readPackedManifest, resolveInstallTarget
} from '../packages/dsh-desktop-workbenches/market-install.mjs'
import { createStateStore } from '../packages/dsh-desktop-workbenches/state.mjs'

const roots = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-market-install-'))
  roots.push(root)
  return root
}

function tarEntry(name, content) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100)
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('0', 156)
  header.write('ustar\0', 257)
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  Buffer.from(content).copy(body)
  return Buffer.concat([header, body])
}
const packed = (manifest, extra = []) => gzipSync(Buffer.concat([
  ...extra,
  tarEntry('package/package.json', JSON.stringify(manifest)),
  Buffer.alloc(1024)
]))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const commit = 'c'.repeat(40)
const entry = (distribution, patch = {}) => ({ id: 'project-helper', catalogId: 'o__project-helper', version: distribution.version, distribution, ...patch })

describe('workbench market install targets', () => {
  it('pins npm installs to the exact version and carries the index integrity', async () => {
    const target = await resolveInstallTarget(entry({ type: 'npm', name: '@o/helper', version: '1.2.0', integrity: 'sha512-x', sha256: 'a'.repeat(64) }))
    expect(target).toMatchObject({ pluginSpec: '@o/helper@1.2.0', expectedPluginName: '@o/helper', expectedVersion: '1.2.0', npmIntegrity: 'sha512-x' })
  })

  it('verifies a Release package before installing it from a temporary file', async () => {
    const bytes = packed({ name: 'project-helper', version: '2.0.0' }, [tarEntry('package/README.md', 'hello')])
    const fetchImpl = vi.fn(async () => new Response(bytes))
    const temporaryRoot = await tempRoot()
    const target = await resolveInstallTarget(entry({ type: 'github-release', version: '2.0.0', url: 'https://github.com/o/r/releases/download/v2/w.tgz', sha256: sha256(bytes) }), { fetchImpl, temporaryRoot })
    expect(target.expectedPluginName).toBe('project-helper')
    expect(target.pluginSpec).toMatch(/^file:.*workbench\.tgz$/)
    const file = target.pluginSpec.slice('file:'.length)
    expect(await readFile(file)).toEqual(bytes)
    await target.cleanup()
    expect(existsSync(file)).toBe(false)
  })

  it('refuses a Release package whose checksum, version or size does not match the index', async () => {
    const bytes = packed({ name: 'project-helper', version: '2.0.0' })
    const release = (patch) => entry({ type: 'github-release', version: '2.0.0', url: 'https://github.com/o/r/releases/download/v2/w.tgz', sha256: sha256(bytes), ...patch })
    await expect(resolveInstallTarget(release({ sha256: 'f'.repeat(64) }), { fetchImpl: async () => new Response(bytes) })).rejects.toThrow(/SHA-256/)
    await expect(resolveInstallTarget(release({ version: '3.0.0' }), { fetchImpl: async () => new Response(bytes) })).rejects.toThrow(/lists 3\.0\.0/)
    const huge = new Response('x', { headers: { 'content-length': String(MAX_PACKAGE_BYTES + 1) } })
    await expect(resolveInstallTarget(release(), { fetchImpl: async () => huge })).rejects.toThrow(/larger than/)
    await expect(resolveInstallTarget(release(), { fetchImpl: async () => new Response('', { status: 404 }) })).rejects.toThrow('HTTP 404')
  })

  it('reads the package name from the pinned commit for source installs', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ name: 'project-helper', version: '0.3.0' }))
    const target = await resolveInstallTarget(entry({ type: 'github-source', version: '0.3.0', url: 'https://github.com/o/r', commit }), { fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://raw.githubusercontent.com/o/r/${commit}/package.json`)
    expect(target).toMatchObject({ pluginSpec: `github:o/r#${commit}`, expectedPluginName: 'project-helper', expectedVersion: '0.3.0' })
  })

  it('reads package.json only from the top-level package directory', () => {
    expect(readPackedManifest(packed({ name: 'a', version: '1.0.0' }, [tarEntry('package/sub/package.json', '{"name":"nested"}')]))).toEqual({ name: 'a', version: '1.0.0' })
    expect(() => readPackedManifest(Buffer.from('not gzip'))).toThrow(MarketInstallError)
    expect(() => readPackedManifest(gzipSync(Buffer.alloc(1024)))).toThrow(/does not contain/)
  })

  it('keeps market install records in their own file', async () => {
    const root = await tempRoot()
    const store = createMarketInstallStore(root)
    expect(await store.read()).toEqual({})
    await store.record('project-helper', { catalogId: 'o__project-helper', pluginName: 'project-helper', version: '1.0.0' })
    expect(JSON.parse(await readFile(join(root, 'market-installs.json'), 'utf8')).installs['project-helper'].version).toBe('1.0.0')
    await store.forget('project-helper')
    expect(await store.read()).toEqual({})
  })

  it('forgets only the recovered package across repository identities', async () => {
    const root = await tempRoot()
    const store = createMarketInstallStore(root)
    await store.record('o/first', { catalogId: 'o/first', pluginName: 'shared', version: '1.0.0' })
    await store.record('o/second', { catalogId: 'o/second', pluginName: 'shared', version: '1.0.0' })
    await store.record('other/kept', { catalogId: 'other/kept', pluginName: 'kept', version: '1.0.0' })
    await store.forgetPlugin('shared')
    expect(await store.read()).toEqual({ 'other/kept': { catalogId: 'other/kept', pluginName: 'kept', version: '1.0.0' } })
    expect(JSON.parse(await readFile(join(root, 'market-installs.json'), 'utf8')).installs).toEqual(await store.read())
  })

  it('removes the workbench entry when its package is uninstalled and keeps notes', async () => {
    const root = await tempRoot()
    const store = createMarketInstallStore(root)
    await store.record('owner/tracker', { catalogId: 'owner/tracker', pluginName: 'daily', version: '1.0.0' })
    const states = createStateStore(root)
    const current = await states.read()
    await states.write({
      revision: current.revision,
      state: { ...current.state, added: ['owner/tracker'], pinned: ['owner/tracker'], active: 'owner/tracker', notes: { 'owner/tracker': 'keep' } }
    })
    await detachWorkbenchPackage(root, 'daily')
    expect(await store.read()).toEqual({})
    const next = await states.read()
    expect(next.state.added).toEqual([])
    expect(next.state.pinned).toEqual([])
    expect(next.state.active).toBeNull()
    expect(next.state.notes['owner/tracker']).toBe('keep')
  })
})

describe('workbench market install routes', () => {
  const sha = 'a'.repeat(64)
  const index = {
    schemaVersion: 2, kind: 'catalog', categories: [{ id: 'other', name: { zh: '其他' } }],
    workbenches: [{
      id: 'o/project-helper', owner: 'o', repository: 'project-helper', url: 'https://github.com/o/project-helper', name: '项目助手', category: 'other',
      description: { zh: '整理资料。', en: 'Notes.' }, version: '1.2.0', sourceCommit: commit, license: 'MIT',
      distribution: { type: 'npm', name: 'project-helper', version: '1.2.0', url: 'https://registry.npmjs.org/project-helper/-/project-helper-1.2.0.tgz', integrity: 'sha512-abc', sha256: sha, bytes: 10 },
      screenshots: [{ url: 'https://raw.githubusercontent.com/o/project-helper/main/a.png', alt: 'a', width: 1, height: 1, bytes: 1, sha256: sha }], probe: { status: 'ok' }
    }]
  }
  const handle = (exitCode = 0, message = '') => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const done = (async () => { if (message) stderr.write(message); stdout.end(); stderr.end(); return { exitCode, signal: null } })()
    return { stdout, stderr, done, cancel() {} }
  }
  const KEY = 'o/project-helper'
  async function host(desktopPnpm, catalog = index, fetchCatalog, pluginManager, applyPlugin = apply) {
    const home = await tempRoot()
    vi.stubEnv('DSH_HOME', home)
    const root = join(home, 'desktop-workbenches')
    const routes = []
    const connection = { fetch: { register(route) { routes.push(route) } } }
    // The catalog reader captures fetch when the plugin applies.
    vi.stubGlobal('fetch', fetchCatalog || vi.fn(async url => Response.json(String(url).endsWith('/package.json') ? { name: 'project-helper', version: '1.2.0' } : catalog)))
    if (desktopPnpm && typeof desktopPnpm.authorizeWorkbenchMarketInstall !== 'function') {
      desktopPnpm = { ...desktopPnpm, authorizeWorkbenchMarketInstall: async () => {} }
    }
    const injections = []
    applyPlugin({
      effect: fn => fn(),
      reflect: { provide() {} },
      connection,
      inject(deps, callback) {
        if (deps.length === 1 && deps[0] === 'desktopPnpm') {
          injections.push(callback)
          if (desktopPnpm) callback({ connection, desktopPnpm })
        }
        if (deps.length === 1 && deps[0] === 'pluginManager') {
          if (pluginManager) callback({ connection, pluginManager: { listBundles: vi.fn(async () => []), ...pluginManager } })
        }
      }
    }, { root })
    const call = async (path, body, headers = {}) => {
      const route = routes.find(value => value.path === path)
      if (!route) return undefined
      const response = await route.fetch(new Request(`http://localhost${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }))
      return { status: response.status, body: await response.json() }
    }
    return { root, home, call, activate: service => injections.map(callback => callback({ connection, desktopPnpm: service })) }
  }

  it('stays browse-only when Desktop has no package service', async () => {
    const { call } = await host(undefined)
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toEqual({ status: 503, body: { error: 'Workbench package installation is unavailable: Desktop package service is not available.' } })
    expect(await call('/api/desktop-workbenches/market-uninstall', { id: KEY })).toEqual({ status: 503, body: { error: 'Workbench package uninstallation is unavailable: Desktop package service is not available.' } })
    expect((await call('/api/desktop-workbenches/market-installs')).body).toEqual({ installs: {}, packages: {} })
  })

  it('switches market routes as the package service comes and goes', async () => {
    const { call, activate } = await host(undefined)
    const service = { authorizeWorkbenchMarketInstall: vi.fn(async () => {}), installWorkbenchGeneration: vi.fn(() => handle()), removeWorkbenchGeneration: vi.fn(() => handle()) }
    const disposers = activate(service)
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect((await call('/api/desktop-workbenches/market-uninstall', { id: KEY })).status).toBe(200)
    disposers.forEach(dispose => dispose?.())
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(503)
    expect((await call('/api/desktop-workbenches/market-uninstall', { id: KEY })).status).toBe(503)
    activate(service)
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(service.installWorkbenchGeneration).toHaveBeenCalledTimes(2)
  })

  it('reads local installation readiness without starting or awaiting catalog network requests', async () => {
    let resolve
    const fetchCatalog = vi.fn(() => new Promise(done => { resolve = done }))
    const { call } = await host(undefined, index, fetchCatalog)
    expect((await call('/api/desktop-workbenches/market-installs')).body).toEqual({ installs: {}, packages: {} })
    expect(fetchCatalog).not.toHaveBeenCalled()
    const refresh = call('/api/desktop-workbenches/catalog')
    try {
      expect((await call('/api/desktop-workbenches/market-installs')).body).toEqual({ installs: {}, packages: {} })
      expect(fetchCatalog).toHaveBeenCalledTimes(1)
    } finally { resolve(Response.json(index)) }
    expect((await refresh).status).toBe(200)
  })

  it('installs the index entry, records it, and asks for a restart', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, root } = await host({ installWorkbenchGeneration, runPlugin: vi.fn() })
    const result = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ restartRequired: true, install: { catalogId: 'o/project-helper', pluginName: 'project-helper', version: '1.2.0', source: 'npm' } })
    expect(installWorkbenchGeneration).toHaveBeenCalledWith({ source: 'market', pluginSpec: 'project-helper@1.2.0', expectedPluginName: 'project-helper', expectedVersion: '1.2.0', npmIntegrity: 'sha512-abc' }, root)
    expect(Object.keys((await call('/api/desktop-workbenches/market-installs')).body.installs)).toEqual([KEY])
  })

  it('returns a stable code when network workbench installation is closed', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call } = await host({
      installWorkbenchGeneration,
      authorizeWorkbenchMarketInstall: async () => {
        throw new Error('POLICY_DISABLED: current enterprise has not opened network workbench installation.')
      }
    })
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toEqual({
      status: 403,
      body: { error: 'POLICY_DISABLED' }
    })
    expect(installWorkbenchGeneration).not.toHaveBeenCalled()
  })

  async function installedPackage(home, spec = 'file:/development/local') {
    const profile = join(home, 'profiles', 'web')
    const directory = join(profile, 'node_modules', 'project-helper')
    await mkdir(directory, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'project-helper': spec } }))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'project-helper', version: '1.2.0', dsh: { client: { entry: './client.js' } } }))
    await writeFile(join(directory, 'client.js'), 'local workbench code')
    return directory
  }

  it.each([undefined, false, 'true', 1])('rejects direct replacement without boolean confirmation (%s)', async confirmedReplacement => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, root, home } = await host({ installWorkbenchGeneration })
    const directory = await installedPackage(home)
    const store = createMarketInstallStore(root)
    await store.record(KEY, { pluginName: 'project-helper', version: '1.2.0', fingerprint: 'stale' })
    const before = await readFile(join(root, 'market-installs.json'), 'utf8')
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY, confirmedReplacement })).status).toBe(409)
    expect(installWorkbenchGeneration).not.toHaveBeenCalled()
    expect(await readFile(join(directory, 'client.js'), 'utf8')).toBe('local workbench code')
    expect(await readFile(join(root, 'market-installs.json'), 'utf8')).toBe(before)
  })

  it('checks the resolved source package name when the catalog does not declare it', async () => {
    const catalog = structuredClone(index)
    catalog.workbenches[0].distribution = { type: 'github-source', version: '1.2.0', url: 'https://github.com/o/project-helper', commit }
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home } = await host({ installWorkbenchGeneration }, catalog)
    await installedPackage(home)
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(409)
    expect(installWorkbenchGeneration).not.toHaveBeenCalled()
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY, confirmedReplacement: true })).status).toBe(200)
  })

  it('allows explicitly confirmed replacement and verified market updates', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home } = await host({ installWorkbenchGeneration })
    await installedPackage(home, '1.2.0')
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY, confirmedReplacement: true })).status).toBe(200)
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(installWorkbenchGeneration).toHaveBeenCalledTimes(2)
  })

  it('requires confirmation only for positively detected market content changes', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home, root } = await host({ installWorkbenchGeneration })
    const directory = await installedPackage(home, '1.2.0')
    const initial = (await readInstallEvidence({}, home, ['project-helper']))['project-helper']
    await createMarketInstallStore(root).record(KEY, { pluginName: 'project-helper', version: '1.2.0', fingerprint: initial.fingerprint })
    await writeFile(join(directory, 'client.js'), 'changed same-version code')
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toMatchObject({ status: 409, body: { code: 'confirmation_required', params: { updateRisk: 'modified' } } })
    expect(installWorkbenchGeneration).not.toHaveBeenCalled()
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY, confirmedReplacement: true })).status).toBe(200)
    expect(installWorkbenchGeneration).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['1.2.0', 'npm', undefined],
    ['github:o/project-helper#commit', 'github-source', undefined],
    ['file:/tmp/market-release.tgz', 'github-release', undefined],
    ['1.2.0', 'npm', 'a'.repeat(64)],
    ['file:/tmp/market-release.tgz', 'github-release', 'a'.repeat(64)]
  ])('updates historical market installs without prompting (%s, %s)', async (spec, source, fingerprint) => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home, root } = await host({ installWorkbenchGeneration })
    await installedPackage(home, spec)
    await createMarketInstallStore(root).record(KEY, { pluginName: 'project-helper', version: '1.2.0', source, fingerprint })
    const packages = (await call('/api/desktop-workbenches/market-installs')).body.packages
    expect(packages['project-helper']).toMatchObject({ origin: 'market', contentVerified: false, updateRisk: null })
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(installWorkbenchGeneration).toHaveBeenCalledTimes(1)
  })

  it.each(['file:/development/local', 'link:/development/local', 'file:/development/local.tgz'])('protects unreadable explicitly local installs (%s)', async spec => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home } = await host({ installWorkbenchGeneration })
    const directory = await installedPackage(home, spec)
    await writeFile(join(directory, 'package.json'), '{invalid')
    expect((await readInstallEvidence({}, home, ['project-helper']))['project-helper']).toMatchObject({ origin: 'local', updateRisk: 'local' })
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toMatchObject({ status: 409, body: { code: 'confirmation_required', params: { updateRisk: 'local' } } })
    expect(installWorkbenchGeneration).not.toHaveBeenCalled()
  })

  it('updates unreadable historical release archives without inferring local modifications', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home, root } = await host({ installWorkbenchGeneration })
    const directory = await installedPackage(home, 'file:/tmp/release.tgz')
    await createMarketInstallStore(root).record(KEY, { pluginName: 'project-helper', version: '1.2.0', source: 'github-release' })
    await writeFile(join(directory, 'package.json'), '{invalid')
    expect((await readInstallEvidence(await createMarketInstallStore(root).read(), home))['project-helper']).toMatchObject({ origin: 'market', updateRisk: null })
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(installWorkbenchGeneration).toHaveBeenCalledTimes(1)
  })

  it('does not treat unknown or unreadable remote evidence as detected local modifications', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const { call, home } = await host({ installWorkbenchGeneration })
    const directory = await installedPackage(home, '1.2.0')
    await writeFile(join(directory, 'package.json'), '{invalid')
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(installWorkbenchGeneration).toHaveBeenCalledTimes(1)
  })

  it('reports install failures without recording anything', async () => {
    const { call } = await host({ installWorkbenchGeneration: () => handle(1, 'ERR_PNPM_FETCH_404 not found'), runPlugin: vi.fn() })
    const result = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(result).toEqual({ status: 502, body: { error: 'ERR_PNPM_FETCH_404 not found' } })
    expect((await call('/api/desktop-workbenches/market-installs')).body.installs).toEqual({})
  })

  it('rejects unknown entries, invalid IDs and a busy package service', async () => {
    const { call } = await host({ installWorkbenchGeneration: () => { throw new Error('Another desktop pnpm operation is already running.') }, runPlugin: vi.fn() })
    expect((await call('/api/desktop-workbenches/market-install', { id: 'o/missing' })).status).toBe(404)
    expect((await call('/api/desktop-workbenches/market-install', { id: '../x' })).status).toBe(400)
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toEqual({ status: 409, body: { error: 'Another desktop pnpm operation is already running.' } })
  })

  it('idempotently removes the recorded generation, then forgets the market install', async () => {
    const removeWorkbenchGeneration = vi.fn(() => handle())
    const { call, root } = await host({ installWorkbenchGeneration: () => handle(), removeWorkbenchGeneration })
    expect((await call('/api/desktop-workbenches/market-uninstall', { id: KEY })).status).toBe(404)
    await call('/api/desktop-workbenches/market-install', { id: KEY })
    const result = await call('/api/desktop-workbenches/market-uninstall', { id: KEY })
    expect(result).toEqual({ status: 200, body: { restartRequired: true } })
    expect(removeWorkbenchGeneration).toHaveBeenCalledWith('project-helper', root)
    expect((await call('/api/desktop-workbenches/market-installs')).body.installs).toEqual({})
  })

  it('records the catalog repository identity without package-local workbench metadata', async () => {
    const runPlugin = vi.fn(() => handle())
    const { call } = await host({ installWorkbenchGeneration: () => handle(), runPlugin })
    const result = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(result.status).toBe(200)
    expect(result.body.install).toMatchObject({ catalogId: 'o/project-helper', pluginName: 'project-helper' })
    expect(runPlugin).not.toHaveBeenCalled()
  })

  it('installs and uninstalls via pluginManager when desktopPnpm is absent in web mode', async () => {
    const installBundle = vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: 'project-helper', version: '1.2.0' }))
    const removeBundle = vi.fn(async name => ({ application: 'applied', stage: 'remove', target: name }))
    const { call, root } = await host(undefined, index, undefined, { installBundle, removeBundle })
    const installResult = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(installResult.status).toBe(200)
    expect(installResult.body).toMatchObject({
      application: 'applied', restartRequired: false,
      install: { catalogId: 'o/project-helper', pluginName: 'project-helper', version: '1.2.0', source: 'npm' }
    })
    expect(installBundle).toHaveBeenCalledWith('project-helper@1.2.0', { enabled: true, expectedName: 'project-helper', expectedVersion: '1.2.0' })
    expect(Object.keys((await call('/api/desktop-workbenches/market-installs')).body.installs)).toEqual([KEY])

    const uninstallResult = await call('/api/desktop-workbenches/market-uninstall', { id: KEY })
    expect(uninstallResult).toEqual({ status: 200, body: { application: 'applied', restartRequired: false } })
    expect(removeBundle).toHaveBeenCalledWith('project-helper')
    expect((await call('/api/desktop-workbenches/market-installs')).body.installs).toEqual({})
  })

  it('passes the verified temporary release tarball to the manager and cleans it after staging', async () => {
    const bytes = packed({ name: 'release-wb', version: '1.0.0' }, [tarEntry('package/README.md', 'hello')])
    const releaseCatalog = {
      ...index,
      workbenches: [{
        id: 'o/release-wb', owner: 'o', repository: 'release-wb', url: 'https://github.com/o/release-wb', name: '发布助手', category: 'other',
        description: { zh: '发布说明。', en: 'Release.' }, version: '1.0.0', sourceCommit: commit, license: 'MIT',
        distribution: { type: 'github-release', version: '1.0.0', url: 'https://github.com/o/r/releases/download/v1/w.tgz', sha256: sha256(bytes), bytes: bytes.length },
        screenshots: [{ url: 'https://raw.githubusercontent.com/o/release-wb/main/a.png', alt: 'a', width: 1, height: 1, bytes: 1, sha256: sha }], probe: { status: 'ok' }
      }]
    }
    const installBundle = vi.fn(async spec => {
      expect(await readFile(spec.slice('file:'.length))).toEqual(bytes)
      return { application: 'applied', stage: 'enable', bundle: 'release-wb', version: '1.0.0' }
    })
    const removeBundle = vi.fn(async name => ({ application: 'applied', stage: 'remove', target: name }))
    const fetchCatalog = vi.fn(async url => String(url).endsWith('.tgz') ? new Response(bytes) : Response.json(releaseCatalog))
    const { call, root } = await host(undefined, releaseCatalog, fetchCatalog, { installBundle, removeBundle })
    const result = await call('/api/desktop-workbenches/market-install', { id: 'o/release-wb' })
    expect(result.status).toBe(200)
    const expectedTarball = join(root, 'packages', 'release-wb-1.0.0.tgz')
    expect(installBundle).toHaveBeenCalledWith(expect.stringMatching(/^file:.*workbench\.tgz$/), { enabled: true, expectedName: 'release-wb', expectedVersion: '1.0.0' })
    expect(existsSync(installBundle.mock.calls[0][0].slice('file:'.length))).toBe(false)
    expect(existsSync(expectedTarball)).toBe(false)

    const uninstall = await call('/api/desktop-workbenches/market-uninstall', { id: 'o/release-wb' })
    expect(uninstall.status).toBe(200)
    expect(removeBundle).toHaveBeenCalledWith('release-wb')
    expect(existsSync(expectedTarball)).toBe(false)
  })

  const acceptedInstall = { application: 'applied', stage: 'enable', bundle: 'project-helper', version: '1.2.0' }
  const invalidInstalls = [
    ['activation failure', { ...acceptedInstall, application: 'failed', error: { diagnostic: 'apply failed: missing peer', message: 'outer failure' } }],
    ['overridden', { ...acceptedInstall, application: 'overridden' }],
    ['cancelled', { ...acceptedInstall, application: 'cancelled' }],
    ['wrong bundle', { ...acceptedInstall, bundle: 'another-package' }],
    ['missing bundle', { ...acceptedInstall, bundle: undefined }],
    ['install stage', { ...acceptedInstall, stage: 'install' }],
    ['remove stage', { ...acceptedInstall, stage: 'remove' }],
    ['wrong version', { ...acceptedInstall, version: '1.1.0' }],
    ['missing version', { ...acceptedInstall, version: undefined }],
    ['missing result', undefined]
  ]

  it.each(['applied', 'restart-required'])('reports the actual Web market application outcome (%s)', async application => {
    const installBundle = vi.fn(async () => ({ ...acceptedInstall, application, ...(application === 'restart-required' ? { restartReason: 'no-hmr' } : {}) }))
    const { call } = await host(undefined, index, undefined, { installBundle })
    expect(await call('/api/desktop-workbenches/market-install', { id: KEY })).toMatchObject({
      status: 200, body: { application, restartRequired: application === 'restart-required', ...(application === 'restart-required' ? { restartReason: 'no-hmr' } : {}) }
    })
  })

  it.each(invalidInstalls)('does not record an unsuccessful Web market install: %s', async (_label, result) => {
    const installBundle = vi.fn(async () => result)
    const { call, root } = await host(undefined, index, undefined, { installBundle })
    const store = createMarketInstallStore(root)
    await store.record(KEY, { pluginName: 'project-helper', version: '1.0.0', source: 'npm' })
    const before = await readFile(join(root, 'market-installs.json'), 'utf8')
    const response = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(response.status).toBe(409)
    expect(response.body).not.toHaveProperty('install')
    if (result?.error?.diagnostic) expect(response.body.error).toBe(result.error.diagnostic)
    expect(await readFile(join(root, 'market-installs.json'), 'utf8')).toBe(before)
  })

  it.each([true, false])('only requests replacement for an installed matching bundle (%s)', async installed => {
    const installBundle = vi.fn(async () => acceptedInstall)
    const listBundles = vi.fn(async () => [
      { name: 'project-helper', installed }, { name: 'unrelated', installed: true }
    ])
    const { call } = await host(undefined, index, undefined, { installBundle, listBundles })
    const response = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(response).toMatchObject({ status: 200, body: { application: installed ? 'restart-required' : 'applied', restartRequired: installed } })
    if (installed) expect(response.body.restartReason).toBe('package-moved')
    expect(installBundle).toHaveBeenCalledWith('project-helper@1.2.0', {
      enabled: true, expectedName: 'project-helper', expectedVersion: '1.2.0', ...(installed ? { replace: true } : {})
    })
    expect(listBundles).toHaveBeenCalledOnce()
  })

  it('passes the pinned git identity and version through to the verified manager backend', async () => {
    const catalog = structuredClone(index)
    catalog.workbenches[0].distribution = { type: 'github-source', version: '1.2.0', url: 'https://github.com/o/project-helper', commit }
    const installBundle = vi.fn(async () => acceptedInstall)
    const { call } = await host(undefined, catalog, undefined, { installBundle })
    expect((await call('/api/desktop-workbenches/market-install', { id: KEY })).status).toBe(200)
    expect(installBundle).toHaveBeenCalledWith('github:o/project-helper#' + commit, { enabled: true, expectedName: 'project-helper', expectedVersion: '1.2.0' })
  })

  async function localHost(pluginManager, desktopPnpm) {
    vi.resetModules()
    const capability = 'test-only-workbench-capability-00000000'
    vi.stubEnv('DSH_DESKTOP_LOCAL_WORKBENCH_CAPABILITY', capability)
    const { apply: applyLocal } = await import('../packages/dsh-desktop-workbenches/index.js')
    const hosted = await host(desktopPnpm, index, undefined, pluginManager, applyLocal)
    const directory = join(hosted.home, 'source')
    await mkdir(directory)
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: 'project-helper', version: '1.2.0', exports: { './client': './client.js' },
      dsh: { client: { inject: ['dsh-desktop-workbenches'] } }
    }))
    await writeFile(join(directory, 'client.js'), 'export {}')
    return { ...hosted, directory, headers: { 'x-dsh-local-workbench-capability': capability } }
  }

  it.each([
    { application: 'applied', installed: false },
    { application: 'applied', installed: true },
    { application: 'restart-required', installed: false }
  ])('reports local activation and replacement accurately (%o)', async ({ application, installed }) => {
    const installBundle = vi.fn(async () => ({ ...acceptedInstall, application }))
    const { call, directory, headers, root } = await localHost({ installBundle, listBundles: async () => [{ name: 'project-helper', installed }] })
    const response = await call('/api/desktop-workbenches/local-install', { path: directory }, headers)
    const restartRequired = installed || application === 'restart-required'
    expect(response).toMatchObject({ status: 200, body: { application: restartRequired ? 'restart-required' : 'applied', restartRequired, install: { pluginName: 'project-helper', version: '1.2.0' } } })
    expect(installBundle).toHaveBeenCalledWith(expect.any(String), { enabled: true, expectedName: 'project-helper', expectedVersion: '1.2.0', ...(installed ? { replace: true } : {}) })
    expect(JSON.parse(await readFile(join(root, 'local-installs.json'), 'utf8'))['project-helper']).toMatchObject(response.body.install)
  })

  it.each(invalidInstalls)('preserves local installation records on an unsuccessful manager result: %s', async (_label, result) => {
    const installBundle = vi.fn(async () => result)
    const { call, directory, headers, root } = await localHost({ installBundle })
    await mkdir(root, { recursive: true })
    const recordPath = join(root, 'local-installs.json')
    const before = JSON.stringify({ 'project-helper': { pluginName: 'project-helper', version: '1.0.0' } })
    await writeFile(recordPath, before)
    const response = await call('/api/desktop-workbenches/local-install', { path: directory }, headers)
    expect(response.status).toBe(409)
    expect(response.body).not.toHaveProperty('install')
    if (result?.error?.diagnostic) expect(response.body.error).toBe(result.error.diagnostic)
    expect(await readFile(recordPath, 'utf8')).toBe(before)
  })

  it('keeps local installs capability-gated before invoking the manager', async () => {
    const installBundle = vi.fn(async () => acceptedInstall)
    const { call, directory } = await localHost({ installBundle })
    expect((await call('/api/desktop-workbenches/local-install', { path: directory })).status).toBe(403)
    expect(installBundle).not.toHaveBeenCalled()
  })

  it('keeps the desktop local generation path and its restart requirement', async () => {
    const installWorkbenchGeneration = vi.fn(() => handle())
    const installBundle = vi.fn()
    const { call, directory, headers } = await localHost({ installBundle }, { installWorkbenchGeneration })
    expect(await call('/api/desktop-workbenches/local-install', { path: directory }, headers)).toMatchObject({ status: 200, body: { restartRequired: true } })
    expect(installWorkbenchGeneration).toHaveBeenCalledWith(expect.objectContaining({ source: 'local', expectedPluginName: 'project-helper', expectedVersion: '1.2.0' }), expect.any(String))
    expect(installBundle).not.toHaveBeenCalled()
  })

  it('handles pluginManager installation failures cleanly', async () => {
    const installBundle = vi.fn(async () => ({
      application: 'failed',
      stage: 'install',
      error: { message: 'Failed to download package from npm.' }
    }))
    const { call } = await host(undefined, index, undefined, { installBundle })
    const result = await call('/api/desktop-workbenches/market-install', { id: KEY })
    expect(result).toEqual({ status: 409, body: { error: 'Failed to download package from npm.' } })
    expect((await call('/api/desktop-workbenches/market-installs')).body.installs).toEqual({})
  })

  it.each(['applied', 'restart-required'])('reports the actual Web uninstall outcome (%s)', async application => {
    const removeBundle = vi.fn(async name => ({ application, stage: 'remove', target: name, ...(application === 'restart-required' ? { restartReason: 'no-hmr' } : {}) }))
    const { call, root } = await host(undefined, index, undefined, { removeBundle })
    await createMarketInstallStore(root).record(KEY, { pluginName: 'project-helper', version: '1.2.0' })
    expect(await call('/api/desktop-workbenches/market-uninstall', { id: KEY })).toEqual({
      status: 200, body: { application, restartRequired: application === 'restart-required', ...(application === 'restart-required' ? { restartReason: 'no-hmr' } : {}) }
    })
    expect(await createMarketInstallStore(root).read()).toEqual({})
  })

  it.each([
    ['failed', { application: 'failed', stage: 'remove', target: 'project-helper', error: { diagnostic: 'removal apply failed' } }],
    ['overridden', { application: 'overridden', stage: 'remove', target: 'project-helper' }],
    ['cancelled', { application: 'cancelled', stage: 'remove', target: 'project-helper' }],
    ['wrong target', { application: 'applied', stage: 'remove', target: 'another-package' }],
    ['missing target', { application: 'applied', stage: 'remove' }],
    ['wrong stage', { application: 'applied', stage: 'enable', target: 'project-helper' }],
    ['missing result', undefined]
  ])('retains market install records after unsuccessful removal: %s', async (_label, result) => {
    const { call, root } = await host(undefined, index, undefined, { removeBundle: vi.fn(async () => result) })
    const store = createMarketInstallStore(root)
    await store.record(KEY, { pluginName: 'project-helper', version: '1.2.0' })
    const before = await readFile(join(root, 'market-installs.json'), 'utf8')
    const response = await call('/api/desktop-workbenches/market-uninstall', { id: KEY })
    expect(response.status).toBe(409)
    if (result?.error?.diagnostic) expect(response.body.error).toBe(result.error.diagnostic)
    expect(await readFile(join(root, 'market-installs.json'), 'utf8')).toBe(before)
  })

  it('handles pluginManager uninstallation failures cleanly', async () => {
    const installBundle = vi.fn(async () => ({ application: 'applied', stage: 'enable', bundle: 'project-helper', version: '1.2.0' }))
    const removeBundle = vi.fn(async () => { throw new Error('Could not modify package.json') })
    const { call } = await host(undefined, index, undefined, { installBundle, removeBundle })
    await call('/api/desktop-workbenches/market-install', { id: KEY })
    const result = await call('/api/desktop-workbenches/market-uninstall', { id: KEY })
    expect(result).toEqual({ status: 502, body: { error: 'Could not modify package.json' } })
    expect(Object.keys((await call('/api/desktop-workbenches/market-installs')).body.installs)).toEqual([KEY])
  })
})
