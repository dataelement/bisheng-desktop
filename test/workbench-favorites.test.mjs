import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFavoriteStore, emptyFavorites, MAX_FAVORITES_BYTES, validateFavorites } from '../packages/dsh-desktop-workbenches/favorites.mjs'
import { createStateStore, emptyState, validateState } from '../packages/dsh-desktop-workbenches/state.mjs'
import { apply } from '../packages/dsh-desktop-workbenches/index.js'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-favorites-'))
  roots.push(root)
  return { root, store: createFavoriteStore(root) }
}
const ACCOUNT = 'a'.repeat(16)
const ENTERPRISE = 'e'.repeat(32)
const CLOUD = 'c'.repeat(32)
const populated = () => ({ version: 1, market: { 'example/writer': { title: 'Writer', at: 1 } }, accounts: {
  [ACCOUNT]: [{ kind: 'enterprise', id: ENTERPRISE, title: 'Sales weekly', at: 2 }, { kind: 'cloud', id: CLOUD, title: 'Team board', at: 3 }]
} })

describe('desktop workbench favorites store', () => {
  it('starts empty, writes with a revision check and keeps the file private', async () => {
    const { root, store } = await fixture()
    expect(await store.read()).toEqual({ revision: 0, favorites: emptyFavorites() })
    expect(await store.write({ revision: 0, favorites: populated() })).toEqual({ revision: 1, favorites: populated() })
    expect(await store.read()).toEqual({ revision: 1, favorites: populated() })
    await expect(store.write({ revision: 0, favorites: emptyFavorites() })).rejects.toMatchObject({ status: 409 })
    expect((await stat(join(root, 'favorites.json'))).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['an unknown field', value => ({ ...value, extra: true })],
    ['a newer version', value => ({ ...value, version: 2 })],
    ['a non-repository market ID', value => ({ ...value, market: { 'Example/Writer': { at: 1 } } })],
    ['a market record without time', value => ({ ...value, market: { 'example/writer': { title: 'Writer' } } })],
    ['an invalid account key', value => ({ ...value, accounts: { 'not-a-key': [] } })],
    ['an unknown kind', value => ({ ...value, accounts: { [ACCOUNT]: [{ kind: 'market', id: ENTERPRISE, title: 'x', at: 1 }] } })],
    ['a non-hex resource ID', value => ({ ...value, accounts: { [ACCOUNT]: [{ kind: 'cloud', id: 'enterprise-board', title: 'x', at: 1 }] } })],
    ['an empty title', value => ({ ...value, accounts: { [ACCOUNT]: [{ kind: 'cloud', id: CLOUD, title: '', at: 1 }] } })],
    ['a duplicate favorite', value => ({ ...value, accounts: { [ACCOUNT]: [{ kind: 'cloud', id: CLOUD, title: 'a', at: 1 }, { kind: 'cloud', id: CLOUD, title: 'b', at: 2 }] } })],
    ['prototype keys', value => JSON.parse(JSON.stringify(value).replace('"market":{', '"market":{"__proto__":{"at":1},'))]
  ])('rejects %s without touching the saved file', async (_name, change) => {
    const { root, store } = await fixture()
    await store.write({ revision: 0, favorites: populated() })
    const before = await readFile(join(root, 'favorites.json'), 'utf8')
    await expect(store.write({ revision: 1, favorites: change(populated()) })).rejects.toMatchObject({ status: 400 })
    expect(await readFile(join(root, 'favorites.json'), 'utf8')).toBe(before)
  })

  it('rejects oversized favorites and fails closed on a corrupt file', async () => {
    const { root, store } = await fixture()
    const many = Array.from({ length: 500 }, (_, index) => ({ kind: 'cloud', id: index.toString(16).padStart(32, '0'), title: '工'.repeat(300), at: index }))
    expect(() => validateFavorites({ version: 1, market: {}, accounts: { [ACCOUNT]: many, ['b'.repeat(16)]: many } })).toThrow('too large')
    expect(MAX_FAVORITES_BYTES).toBe(512 * 1024)
    await writeFile(join(root, 'favorites.json'), '{"revision":1,"favorites":{"version":1,"market":{},"accounts":{"bad":[]}}}')
    await expect(store.read()).rejects.toMatchObject({ status: 500 })
    await expect(store.write({ revision: 1, favorites: emptyFavorites() })).rejects.toMatchObject({ status: 500 })
  })

  it('leaves state.json readable by clients that only know the V1.3.0 state schema', async () => {
    const { root, store } = await fixture()
    const state = createStateStore(root)
    await state.write({ revision: 0, state: { ...emptyState(), favorites: ['example/writer'] } })
    const stateBefore = await readFile(join(root, 'state.json'), 'utf8')
    await store.write({ revision: 0, favorites: populated() })
    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(stateBefore)
    expect((await state.read()).state.favorites).toEqual(['example/writer'])
    // The reason favorites.json exists: state.json cannot hold these entries
    // without an older client rejecting the whole file.
    expect(() => validateState({ ...emptyState(), favorites: [`enterprise:${ACCOUNT}:${ENTERPRISE}`] })).toThrow()
    expect(() => validateState({ ...emptyState(), favoriteRecords: {} })).toThrow('Unknown workbench state field')
  })

  it('serves favorites through the plugin routes', async () => {
    const { root } = await fixture()
    const routes = new Map()
    apply({ effect: fn => fn(), inject() {}, reflect: { provide() {} }, logger: { warn() {} }, connection: { fetch: { register(route) { routes.set(route.path, route) } } } }, { root })
    const read = await routes.get('/api/desktop-workbenches/favorites').fetch(new Request('http://localhost/api/desktop-workbenches/favorites'))
    expect(await read.json()).toEqual({ revision: 0, favorites: emptyFavorites() })
    const write = await routes.get('/api/desktop-workbenches/favorites/write').fetch(new Request('http://localhost/api/desktop-workbenches/favorites/write', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 0, favorites: populated() })
    }))
    expect(write.status).toBe(200)
    expect(await write.json()).toEqual({ revision: 1, favorites: populated() })
    const conflict = await routes.get('/api/desktop-workbenches/favorites/write').fetch(new Request('http://localhost/api/desktop-workbenches/favorites/write', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 0, favorites: emptyFavorites() })
    }))
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('cache-control')).toBe('no-store')
  })
})
