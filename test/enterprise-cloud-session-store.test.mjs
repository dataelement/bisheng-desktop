import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCloudSessionStore } from '../packages/dsh-desktop-enterprise/cloud-session-store.js'
it('persists projects independently by account and rejects stale writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-cloud-sessions-'))
  let account = 'a'
  try {
    const store = createCloudSessionStore(root, () => account)
    const saved = await store.read()
    saved.state.cloudDevelopmentSessions.session = '12345678-1234-1234-1234-123456789abc'
    await store.write(saved)
    await expect(store.write(saved)).rejects.toMatchObject({ status: 409 })
    account = 'b'
    expect((await store.read()).state.cloudDevelopmentSessions).toEqual({})
    await expect(store.write(saved)).rejects.toThrow('account changed')
    account = 'a'
    expect((await store.read()).state.cloudDevelopmentSessions.session).toContain('12345678')
  } finally { await rm(root, { recursive: true, force: true }) }
})
