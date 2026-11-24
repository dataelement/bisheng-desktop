import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createFavoriteStore, createAccountFavoriteController } from '../packages/dsh-desktop-enterprise/workbench-favorites.js'
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-favorites-'))
  roots.push(root)
  return { root, store: createFavoriteStore(root) }
}
const a = 'a'.repeat(16), b = 'b'.repeat(16)
const item = { kind: 'enterprise', id: '1'.repeat(32), title: 'Saved workbench', at: 1 }
it('persists legacy-compatible favorites and rejects a stale revision without losing records', async () => {
  const { root, store } = await setup()
  const current = await store.read()
  current.favorites.accounts[a] = [item]
  await store.write(current)
  await expect(store.write(current)).rejects.toMatchObject({ status: 409 })
  expect((await createFavoriteStore(root).read()).favorites.accounts[a]).toEqual([item])
  expect(JSON.parse(await readFile(join(root, 'favorites.json'), 'utf8')).revision).toBe(1)
})
it('isolates accounts, preserves revoked favorites, and permits their explicit removal', async () => {
  const { store } = await setup()
  let account = { connected: true, connectionKey: a }
  const controller = createAccountFavoriteController(store, () => account)
  await controller.write({ revision: 0, accountKey: a, items: [item] })
  account = { connected: true, connectionKey: b }
  expect((await controller.read()).items).toEqual([])
  await expect(controller.write({ revision: 1, accountKey: a, items: [] })).rejects.toMatchObject({ status: 409 })
  account = { connected: true, connectionKey: a }
  expect((await controller.read()).items).toEqual([item])
  await controller.write({ revision: 1, accountKey: a, items: [] })
  expect((await controller.read()).items).toEqual([])
  account.connected = false
  await expect(controller.read()).rejects.toMatchObject({ status: 401 })
})
it('preserves a corrupt document for recovery instead of silently resetting it', async () => {
  const { root, store } = await setup()
  await writeFile(join(root, 'favorites.json'), '{broken')
  await expect(store.read()).rejects.toMatchObject({ status: 500 })
  await expect(store.write({ revision: 0, favorites: { version: 1, accounts: {}, market: {} } })).rejects.toMatchObject({ status: 500 })
  expect(await readFile(join(root, 'favorites.json'), 'utf8')).toBe('{broken')
})
