import { afterEach, describe, expect, it } from 'vitest'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { emptyState, validateState } from '../packages/dsh-desktop-workbenches/state.mjs'
import { readInstallEvidence } from '../packages/dsh-desktop-workbenches/install-evidence.mjs'
import { validatePublishedCatalog } from '../packages/dsh-desktop-workbenches/catalog.mjs'
import { isLocalPackageName, isLocalWorkbenchId, isRepositoryWorkbenchId, localWorkbenchId } from '../packages/dsh-desktop-workbenches/identity.mjs'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const source = await readFile(new URL('../packages/dsh-desktop-workbenches/client.js', import.meta.url), 'utf8')
function controller(name = '@team/review') {
  let Workbenches
  vm.runInNewContext(source, { window: { localStorage: { getItem: () => null, setItem() {} }, __ModuleLoader__: { load({ factory }) {
    Workbenches = factory(name => name === 'react' ? { createElement() {}, Component: class {} } : name === '@deepseek-ai/cordis' ? { Service: { tracker: Symbol() } } : {}).Workbenches
  } } }, document: { querySelector() {} }, setTimeout, clearTimeout, AbortController })
  const value = new Workbenches({ fiber: { entry: { options: { name } } }, layout: { beginNavigation() {} } })
  value.ready = true
  value.readInstalls = async () => ({})
  value.commit = async mutate => { mutate(value.state); value.publish() }
  value.run = promise => promise
  return value
}

describe('canonical local workbench identities', () => {
  it.each(['resume-review', '@team/resume-review', 'a'.repeat(214), '@a/' + 'b'.repeat(211)])('derives a stable identity from package %s only', name => {
    expect(isLocalPackageName(name)).toBe(true)
    expect(localWorkbenchId(name)).toBe(`local:${name}`)
    expect(isLocalWorkbenchId(`local:${name}`)).toBe(true)
    expect(isRepositoryWorkbenchId(`local:${name}`)).toBe(false)
  })
  it.each([undefined, null, '', 'Team/review', 'Resume', '@Team/review', '@team/Review', 'a'.repeat(215), '@a/' + 'b'.repeat(212),
    '.', '..', '_name', '.name', '@scope', '@scope/', '@scope/a/b', 'scope/name', 'name@1.0.0', 'name:1', 'file:name',
    'C:\\workbench', '/tmp/workbench', 'name name', 'name%20', 'name?query', 'name#hash', '__proto__', 'constructor', 'prototype',
    '@constructor/name', '@scope/prototype', 'node_modules', 'favicon.ico', 'name\n'])('rejects noncanonical or unsafe package input %j', name => {
    expect(isLocalPackageName(name)).toBe(false)
    expect(() => localWorkbenchId(name)).toThrow('Invalid local workbench package name')
    if (typeof name === 'string') expect(isLocalWorkbenchId(`local:${name}`)).toBe(false)
  })
  it('does not expand published market catalog identities to local workbenches', () => {
    const entry = { id: 'owner/repo', owner: 'owner', repository: 'repo', url: 'https://github.com/owner/repo', name: 'Review', category: 'hr',
      description: { zh: '简历', en: 'Resume' }, version: '1.0.0', license: 'MIT', distribution: { type: 'npm', name: 'review', version: '1.0.0' },
      screenshots: [{ url: 'https://example.com/screen.png', alt: 'Screen', sha256: 'a'.repeat(64), width: 1, height: 1, bytes: 1 }] }
    const catalog = { schemaVersion: 2, kind: 'catalog', categories: [{ id: 'hr', name: { zh: '人事' } }], workbenches: [entry] }
    expect(validatePublishedCatalog(catalog)).toEqual(catalog)
    expect(() => validatePublishedCatalog({ ...catalog, workbenches: [{ ...entry, id: 'local:review' }] })).toThrow('catalog identity')
  })
  it('persists canonical local state while preserving session ownership', () => {
    const state = { ...emptyState(), added: ['local:@team/review'], pinned: ['local:@team/review'], active: 'local:@team/review',
      sessionBindings: { session: 'local:@team/review' }, recentSessions: { 'local:@team/review': 'session' }, notes: { 'local:@team/review': 'Keep' } }
    expect(validateState(state, emptyState())).toEqual(state)
    expect(() => validateState({ ...state, sessionBindings: {}, recentSessions: {} }, state)).toThrow('ownership')
    expect(() => validateState({ ...emptyState(), added: ['local:../escape'] }, emptyState())).toThrow('IDs')
  })
  it('registers, auto-pins and retains local identity after later market discovery', async () => {
    const value = controller()
    value.register({ title: 'Review' }, () => null)
    await value.queue
    expect(value.catalog.has('local:@team/review')).toBe(true)
    expect(value.state.added).toEqual(['local:@team/review'])
    expect(value.state.pinned).toEqual(['local:@team/review'])
    value.state.active = 'local:@team/review'
    value.state.sessionBindings.session = 'local:@team/review'
    expect(value.isActive()).toBe(true)
    expect(value.ownsSession('session')).toBe(true)
    value.remoteCatalog = [{ id: 'team/review', distribution: { name: '@team/review' }, description: {}, screenshots: [] }]
    value.rebuildProviders()
    expect(value.catalog.has('local:@team/review')).toBe(true)
    expect(value.state.sessionBindings.session).toBe('local:@team/review')
    expect(value.marketCatalog().find(entry => entry.id === 'local:@team/review').local).toBe(true)
  })
  it('does not silently reassign a previous repository or conflicting receipt to local identity', () => {
    const value = controller()
    value.knownProviders['team/original'] = { sourcePackage: '@team/review' }
    expect(() => value.identityForSource('@team/review')).toThrow('previous market repository')
    value.installs = { 'team/receipt': { pluginName: '@team/review' } }
    expect(() => value.identityForSource('@team/review', 'https://github.com/team/other')).toThrow('multiple workbenches')
  })
  it('discovers repository-free installed bundles before registration and pins them once loaded', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-local-identity-')); roots.push(home)
    const profile = join(home, 'profiles', 'web'), directory = join(profile, 'node_modules', '@team/review')
    await mkdir(directory, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { '@team/review': 'file:./review.tgz', ordinary: '1.0.0' } }))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@team/review', version: '1.0.0', dsh: { client: { inject: ['dsh-desktop-workbenches'] } } }))
    const evidence = await readInstallEvidence({}, home)
    expect(Object.keys(evidence)).toEqual(['@team/review'])
    expect(evidence['@team/review']).toMatchObject({ workbench: true, origin: 'local' })
    const value = controller()
    value.packageEvidence = evidence
    value.native = { status: 'ready', bundles: { '@team/review': { name: '@team/review', installed: true, enabled: false } } }
    const entry = value.marketCatalog()[0]
    expect(entry).toMatchObject({ id: 'local:@team/review', installed: true, local: true })
    expect(value.pluginFor(entry)).toBe('@team/review')
    value.register({ title: 'Review' }, () => null)
    expect(value.state.pinned).toEqual(['local:@team/review'])
  })
  it('keeps repository syntax separate from local names', () => {
    expect(isRepositoryWorkbenchId('owner/repo')).toBe(true)
    expect(isLocalWorkbenchId('owner/repo')).toBe(false)
    expect(isLocalWorkbenchId('local:owner/repo')).toBe(false)
    expect(isLocalWorkbenchId('LOCAL:name')).toBe(false)
  })
})
