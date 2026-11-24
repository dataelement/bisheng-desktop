import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { adoptLegacyCloudState } from '../packages/dsh-desktop-enterprise/legacy-cloud-state.js'
import { emptyState } from '../packages/dsh-desktop-enterprise/cloud-workbench-state.js'
import { createCloudSessionStore } from '../packages/dsh-desktop-enterprise/cloud-session-store.js'
import { createStateStore as publicStore } from '../packages/dsh-desktop-workbenches/state.mjs'

it('adopts old cloud data before startup, keeps a byte-identical archive and imports removed entries by account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bisheng-cloud-adoption-'))
  try {
    const directory = join(root, 'desktop-workbenches'); await mkdir(directory)
    const key = createHash('sha256').update('account').digest('hex').slice(0, 16)
    const id = `cloud:${key}:${'a'.repeat(32)}`
    const saved = { revision: 3, state: { ...emptyState(), added: ['team/tool'], notes: { [id]: 'Retained note' }, sessionBindings: { session: id }, recentSessions: { [id]: 'session' }, cloudWorkbenches: { [id]: { appId: 'a'.repeat(32), connectionKey: key, title: 'Removed entry', description: '', versionId: null } }, cloudDevelopmentSessions: { session: '12345678-1234-1234-1234-123456789abc' } } }
    const raw = JSON.stringify(saved)
    await writeFile(join(directory, 'state.json'), raw)
    expect(adoptLegacyCloudState(directory)).toBe(true)
    expect(await readFile(join(directory, 'enterprise-cloud-v131.json'), 'utf8')).toBe(raw)
    const clean = await publicStore(directory).read()
    expect(clean.state.added).toEqual(['team/tool'])
    expect(clean.state.sessionBindings).toEqual({})
    expect(adoptLegacyCloudState(directory)).toBe(false)
    const store = createCloudSessionStore(join(root, 'enterprise'), () => 'account')
    const restored = await store.read()
    expect(restored.state.notes[id]).toBe('Retained note')
    expect(restored.state.sessionBindings.session).toBe(id)
    expect(restored.state.cloudDevelopmentSessions.session).toBe(saved.state.cloudDevelopmentSessions.session)
    expect((await createCloudSessionStore(join(root, 'enterprise'), () => 'another-account').read()).state.cloudWorkbenches).toEqual({})
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('refuses to overwrite a conflicting archive and leaves the original state untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bisheng-cloud-conflict-'))
  try {
    const raw = JSON.stringify({ revision: 1, state: { ...emptyState(), cloudWorkbenches: {} } })
    await writeFile(join(root, 'state.json'), raw)
    await writeFile(join(root, 'enterprise-cloud-v131.json'), 'different archive')
    expect(() => adoptLegacyCloudState(root)).toThrow('different content')
    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(raw)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('restores standalone development sessions from project ownership and preserves newer bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bisheng-cloud-project-adoption-'))
  try {
    const directory = join(root, 'desktop-workbenches'), projects = join(root, 'projects')
    await mkdir(directory)
    const project = '12345678-1234-1234-1234-123456789abc', newer = '12345678-1234-1234-1234-123456789def'
    const other = '22345678-1234-1234-1234-123456789abc'
    const key = createHash('sha256').update('account').digest('hex').slice(0, 16)
    for (const [id, connectionKey] of [[project, key], [other, 'b'.repeat(16)]]) {
      await mkdir(join(projects, id), { recursive: true })
      await writeFile(join(projects, id, 'origin.json'), JSON.stringify({ connectionKey }))
    }
    await writeFile(join(directory, 'state.json'), JSON.stringify({ revision: 2, state: { ...emptyState(), cloudDevelopmentSessions: { standalone: project, resumed: project, foreign: other } } }))
    adoptLegacyCloudState(directory)
    const before = createCloudSessionStore(join(root, 'enterprise'), () => 'account')
    const saved = await before.read()
    saved.state.cloudDevelopmentSessions.resumed = newer
    await before.write(saved)
    const store = createCloudSessionStore(join(root, 'enterprise'), () => 'account', projects)
    expect((await store.read()).state.cloudDevelopmentSessions).toEqual({ standalone: project, resumed: newer })
    expect((await createCloudSessionStore(join(root, 'enterprise'), () => 'another-account', projects).read()).state.cloudDevelopmentSessions).toEqual({})
    expect((await store.read()).state.cloudDevelopmentSessions.resumed).toBe(newer)
  } finally { await rm(root, { recursive: true, force: true }) }
})
