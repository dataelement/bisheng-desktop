import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebOfficeModes } from '../packages/dsh-desktop-office/lib/web-modes.js'

it('reconciles persisted offline changes only when the detached PPT baseline is unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-handoff-'))
  try {
    let state = { documentMode: 'excel', activities: [{ revision: 1 }] }
    const delegate = {
      state: async () => state,
      select: async (_id, mode) => { state = { documentMode: mode, activities: [{ revision: 2 }] }; return true },
      selectTemplate: async () => true, deselectTemplate: async () => true, record: async () => true
    }
    let active = delegate
    const modes = createWebOfficeModes(root, () => active)
    expect((await modes.state('session')).documentMode).toBe('excel')
    active = undefined
    await modes.state('session')
    await modes.select('session', 'word')
    // Simulate Office plugin/server restart while PPT is still unavailable.
    const restored = createWebOfficeModes(root, () => active)
    expect((await restored.state('session')).documentMode).toBe('word')
    active = delegate
    expect((await restored.state('session')).documentMode).toBe('word')
    expect(state.documentMode).toBe('word')
    active = undefined
    await restored.state('session')
    await restored.select('session', 'excel')
    // An external owner advanced PPT while Office was detached. Its newer choice wins.
    state = { presentationMode: 'ppt', activities: [{ revision: 3 }] }
    active = delegate
    expect((await restored.state('session')).presentationMode).toBe('ppt')
    expect((await restored.state('session')).documentMode).toBeUndefined()
    expect((await restored.state('session'))._handoff).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
