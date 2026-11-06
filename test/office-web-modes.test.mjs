import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebOfficeModes } from '../packages/dsh-desktop-office/lib/web-modes.js'
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-web-modes-')); roots.push(root)
  const ctx = new Context()
  const modes = createWebOfficeModes(root, () => ctx.get('officeModes'))
  return { ctx, modes, root }
}
const template = { id: 'government-notice', mode: 'word', revision: 'abc123' }

it('serializes requests, persists mode/template selection and isolates sessions', async () => {
  const { modes, root } = await fixture()
  await Promise.all([modes.select('a', 'word'), modes.selectTemplate('a', template), modes.select('b', 'excel')])
  expect((await modes.state('a')).selectedDocumentTemplate).toEqual(template)
  expect(await modes.state('b')).toEqual({ documentMode: 'excel' })
  const restored = createWebOfficeModes(root, () => undefined)
  expect((await restored.state('a')).selectedDocumentTemplate).toEqual(template)
  await expect(modes.selectTemplate('b', template)).rejects.toThrow('matching')
  await modes.select('b', null)
  expect(await modes.state('b')).toEqual({})
})
it('follows real Cordis service activation/disposal without losing Office tools or replacing PPT ownership', async () => {
  const { ctx, modes } = await fixture()
  await modes.select('a', 'word'); await modes.selectTemplate('a', template)
  let state = { activities: [] }
  const provider = {
    state: async () => state,
    select: async (_id, mode) => { state = { documentMode: mode, activities: [{}] }; return true },
    selectTemplate: async (_id, value) => { state = { ...state, selectedDocumentTemplate: value }; return true },
    deselectTemplate: async () => true, record: async () => true
  }
  let ppt = ctx.plugin({ apply(owner) { owner.provide('officeModes', provider) } }); await ppt
  expect((await modes.state('a')).selectedDocumentTemplate).toEqual(template)
  expect(ctx.get('officeModes')).toBeTruthy()
  // A PPT-side RPC changed the selection after Office's last read.
  state = { documentMode: 'excel', activities: [{}] }
  await ppt.dispose()
  expect(ctx.get('officeModes')).toBeUndefined()
  expect((await modes.state('a')).documentMode).toBe('excel')
  await modes.select('a', 'excel')
  // A newer PPT selection (including an explicit return to conversation) wins on reactivation.
  state = { presentationMode: 'ppt', activities: [{}] }
  ppt = ctx.plugin({ apply(owner) { owner.provide('officeModes', provider) } }); await ppt
  expect((await modes.state('a')).presentationMode).toBe('ppt')
  state = { activities: [{}] }
  expect((await modes.state('a')).documentMode).toBeUndefined()
  await ppt.dispose()
  expect(await modes.state('a')).toEqual({})
})
