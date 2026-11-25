import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateStore, emptyState } from '../packages/dsh-desktop-enterprise/cloud-workbench-state.js'

it('reads the unchanged V1.3.1 cloud state and preserves identities, sessions and notes on removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-v131-state-'))
  const key = 'a'.repeat(16), appId = 'b'.repeat(32), id = `cloud:${key}:${appId}`
  const state = { ...emptyState(), added: [id], pinned: [id], active: id,
    cloudWorkbenches: { [id]: { appId, connectionKey: key, title: 'Board', description: '', versionId: null } },
    cloudDevelopmentSessions: { session: '12345678-1234-1234-1234-123456789abc' },
    sessionBindings: { session: id }, recentSessions: { [id]: 'session' }, notes: { [id]: 'Keep this note' }, hiddenWorkspaces: { [id]: ['workspace'] } }
  try {
    const raw = JSON.stringify({ revision: 7, state })
    await writeFile(join(root, 'state.json'), raw)
    const store = createStateStore(root)
    const saved = await store.read()
    expect(saved).toEqual({ revision: 7, state })
    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(raw)
    saved.state.added = []; saved.state.pinned = []; saved.state.active = null
    await store.write(saved)
    const restored = await createStateStore(root).read()
    expect(restored.state.notes).toEqual(state.notes)
    expect(restored.state.sessionBindings).toEqual(state.sessionBindings)
    expect(restored.state.cloudDevelopmentSessions).toEqual(state.cloudDevelopmentSessions)
    await expect(store.write({ ...restored, state: { ...restored.state, cloudWorkbenches: {} } })).rejects.toThrow('preserve its cloud identity')
    await expect(store.write({ ...restored, state: { ...restored.state, sessionBindings: {}, recentSessions: {} } })).rejects.toThrow('ownership')
    await expect(store.write(saved)).rejects.toMatchObject({ status: 409 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('preserves corrupt V1.3.1 state instead of replacing it with defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-v131-corrupt-'))
  try {
    await writeFile(join(root, 'state.json'), '{broken')
    const store = createStateStore(root)
    await expect(store.read()).rejects.toThrow('Restore or repair')
    await expect(store.write({ revision: 0, state: emptyState() })).rejects.toThrow('Restore or repair')
    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe('{broken')
  } finally { await rm(root, { recursive: true, force: true }) }
})
