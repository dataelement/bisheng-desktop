import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { it, expect } from 'vitest'
import { createCloudSessionStore } from '../packages/dsh-desktop-enterprise/cloud-session-store.js'
import { changeCloudMembership } from '../packages/dsh-desktop-enterprise/cloud-membership.js'
import { parseCloudBrowse } from '../packages/dsh-desktop-enterprise/cloud-browse.js'
const appId = 'a'.repeat(32)
it('retains notes and session ownership through removing and readding a local cloud entrance', async () => {
 const root = await mkdtemp(join(tmpdir(), 'cloud-membership-'))
 try {
  const store = createCloudSessionStore(root, () => 'owner')
  const change = (operation, extra = {}) => changeCloudMembership(store, parseCloudBrowse({ operation, appId, ...extra }), async () => ({ id: appId, name: 'Board' }), () => 'owner')
  const added = await change('add'), owner = added.state.added[0]
  expect(added.state.pinned).toContain(owner)
  await change('activate'); await change('note', { note: 'keep this' }); await change('bind', { sessionId: 'session-one' })
  const removed = await change('remove')
  expect(removed.state).toMatchObject({ added: [], pinned: [], active: null, notes: { [owner]: 'keep this' }, sessionBindings: { 'session-one': owner }, recentSessions: { [owner]: 'session-one' } })
  await expect(change('bind', { sessionId: 'session-two' })).rejects.toThrow('Add')
  const restored = await change('add')
  expect(restored.state.notes[owner]).toBe('keep this')
  expect(restored.state.added).toEqual([owner])
  expect(() => parseCloudBrowse({ operation: 'note', appId, note: 'x', connectionKey: 'other' })).toThrow()
 } finally { await rm(root, { recursive: true, force: true }) }
})
it('refuses stale catalog results after switching accounts', async () => {
 const root = await mkdtemp(join(tmpdir(), 'cloud-membership-'))
 try {
  let account = 'first'
  const store = createCloudSessionStore(root, () => account)
  await expect(changeCloudMembership(store, { operation: 'add', appId }, async () => { account = 'second'; return { name: 'Board' } }, () => account)).rejects.toThrow('account changed')
  expect((await store.read()).state.added).toEqual([])
 } finally { await rm(root, { recursive: true, force: true }) }
})
