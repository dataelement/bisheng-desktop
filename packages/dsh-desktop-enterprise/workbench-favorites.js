import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export class StateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

// Favorite records live beside state.json instead of inside it. V1.3.0 rejects
// unknown state fields and non-repository favorite IDs when it reads
// state.json, so enterprise/cloud favorites there would make an older client
// (or another development branch sharing the profile) refuse all workbench
// state. Public market membership stays in state.favorites; this file only adds
// account-scoped enterprise/cloud favorites and the remembered title and time
// used to order and label favorites.
export const MAX_FAVORITES_BYTES = 512 * 1024
const MAX_MARKET_RECORDS = 1000
const MAX_ACCOUNTS = 50
const MAX_ACCOUNT_FAVORITES = 500
const MAX_TITLE_LENGTH = 300
const ACCOUNT_KINDS = ['enterprise', 'cloud']

const fail = (message) => { throw new StateError(message) }
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const validTitle = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_TITLE_LENGTH
const validTime = value => Number.isSafeInteger(value) && value >= 0
// Same identity rules as state.mjs: market favorites use the repository
// identity, account favorites the enterprise connection fingerprint.
const validRepositoryId = value => typeof value === 'string' && value.length <= 255
  && /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(value)
const validConnectionKey = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
const validResourceId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)

export function emptyFavorites() {
  return { version: 1, market: {}, accounts: {} }
}

export function validateFavorites(value) {
  if (!isObject(value) || value.version !== 1) fail('Unsupported workbench favorites version.')
  if (Object.keys(value).some(key => !['version', 'market', 'accounts'].includes(key))) fail('Unknown workbench favorites field.')
  if (!isObject(value.market) || Object.keys(value.market).length > MAX_MARKET_RECORDS) fail('Invalid market favorite records.')
  for (const [id, record] of Object.entries(value.market)) {
    if (!validRepositoryId(id) || !isObject(record) || Object.keys(record).some(key => !['title', 'at'].includes(key))
      || !validTime(record.at) || (record.title !== undefined && !validTitle(record.title))) fail('Invalid market favorite records.')
  }
  if (!isObject(value.accounts) || Object.keys(value.accounts).length > MAX_ACCOUNTS) fail('Invalid account favorites.')
  for (const [account, items] of Object.entries(value.accounts)) {
    if (!validConnectionKey(account) || !Array.isArray(items) || items.length > MAX_ACCOUNT_FAVORITES) fail('Invalid account favorites.')
    const seen = new Set()
    for (const item of items) {
      if (!isObject(item) || Object.keys(item).some(key => !['kind', 'id', 'title', 'at'].includes(key))
        || !ACCOUNT_KINDS.includes(item.kind) || !validResourceId(item.id) || !validTitle(item.title) || !validTime(item.at)) fail('Invalid account favorites.')
      const key = `${item.kind}:${item.id}`
      if (seen.has(key)) fail('Duplicate account favorite.')
      seen.add(key)
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_FAVORITES_BYTES - 100) fail('Workbench favorites are too large.')
  return structuredClone(value)
}

// Reads and writes share one queue and re-read the disk, like state.json, so a
// second window cannot silently overwrite newer favorites.
export function createFavoriteStore(root) {
  const path = join(root, 'favorites.json')
  let pending = Promise.resolve()
  const queue = (operation) => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }
  async function read() {
    let raw
    try { raw = await readFile(path) } catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, favorites: emptyFavorites() }
      throw error
    }
    try {
      if (raw.length > MAX_FAVORITES_BYTES) throw new Error('File exceeds size limit')
      const saved = JSON.parse(raw.toString('utf8'))
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('Invalid revision')
      return { revision: saved.revision, favorites: validateFavorites(saved.favorites) }
    } catch {
      throw new StateError('Stored workbench favorites are invalid. Restore or repair favorites.json before saving.', 500)
    }
  }
  const write = (input) => {
    const payload = structuredClone(input)
    return queue(async () => {
      if (!isObject(payload) || !Number.isSafeInteger(payload.revision) || payload.revision < 0) fail('A valid revision is required.')
      const current = await read()
      if (payload.revision !== current.revision) throw new StateError('Workbench favorites changed. Reload before saving.', 409)
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new StateError('Workbench favorites revision exhausted.', 500)
      const next = { revision: current.revision + 1, favorites: validateFavorites(payload.favorites) }
      await mkdir(root, { recursive: true })
      const temporary = join(root, `.favorites-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      return next
    })
  }
  return { read: () => queue(read), write }
}

/** Only the current account's records cross the authenticated UI boundary. */
export function createAccountFavoriteController(store, state) {
  const current = () => {
    const value = state()
    if (!value?.connected || typeof value.connectionKey !== 'string' || !value.connectionKey) throw new StateError('Sign in to your enterprise account first.', 401)
    return value.connectionKey
  }
  const storageKey = () => {
    const value = state()
    return value?.base && value?.tenant?.id && value?.user?.id
      ? createHash('sha256').update(JSON.stringify([value.base, value.tenant.id, value.user.id])).digest('hex').slice(0, 16)
      : current()
  }
  const project = (saved, key, owner) => ({ revision: saved.revision, accountKey: key, items: saved.favorites.accounts[owner] || [], market: saved.favorites.market })
  return {
    async read() {
      const key = current(), owner = storageKey()
      const saved = await store.read()
      if (current() !== key) throw new StateError('Enterprise account changed.', 409)
      return project(saved, key, owner)
    },
    async write(input) {
      const key = current(), owner = storageKey()
      if (!isObject(input) || input.accountKey !== key) throw new StateError('Enterprise account changed.', 409)
      const saved = await store.read()
      if (current() !== key) throw new StateError('Enterprise account changed.', 409)
      const favorites = saved.favorites
      // Preserve other accounts and old market metadata during the migration.
      favorites.accounts[owner] = input.items
      if (Object.hasOwn(input, 'market')) favorites.market = input.market
      const result = await store.write({ revision: input.revision, favorites })
      if (current() !== key) throw new StateError('Enterprise account changed.', 409)
      return project(result, key, owner)
    }
  }
}

export function applyWorkbenchFavorites(ctx, account, root) {
  const controller = createAccountFavoriteController(createFavoriteStore(root), account.state)
  for (const [path, method] of [['/api/enterprise.workbenches/favorites', 'GET'], ['/api/enterprise.workbenches/favorites/write', 'POST']]) {
    ctx.connection.fetch.register({ path, methods: [method], requestBody: 'buffered', async fetch(request) {
      try {
        await account.refreshState?.()
        let input
        if (method === 'POST') {
          const bytes = new Uint8Array(await request.arrayBuffer())
          if (bytes.length > MAX_FAVORITES_BYTES) throw new StateError('Favorites request is too large.', 413)
          try { input = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new StateError('Invalid favorites JSON.') }
        }
        return Response.json(method === 'GET' ? await controller.read() : await controller.write(input), { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error.message }, { status: error instanceof StateError ? error.status : 500, headers: { 'cache-control': 'no-store' } })
      }
    } })
  }
}
