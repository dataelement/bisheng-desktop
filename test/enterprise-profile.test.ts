import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseProfileState } from '../src/main/enterprise/profile-state'
import { EnterpriseService } from '../src/main/enterprise/enterprise-service'
import { type EnterpriseFetch } from '../src/main/enterprise/platform-fetch'
import { ENTERPRISE_VAULT_FILENAME, SecureEnterpriseCredentialVault } from '../src/main/enterprise/secure-credential-vault'

const BASE = 'https://enterprise.example'
const START = Date.parse('2026-01-01T00:00:00Z')
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length) await cleanups.pop()?.()
  vi.restoreAllMocks()
})

function profile(avatar: unknown = '/minio/avatar.png?X-Amz-Signature=display-secret') {
  return { user: { id: 'user-1', username: 'alice', display_name: 'Alice Updated', avatar }, tenant: { id: 'tenant-1' } }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized') }
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function runtime(profileFetch: EnterpriseFetch = async () => Response.json(profile())) {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-profile-'))
  const filename = join(directory, ENTERPRISE_VAULT_FILENAME)
  const vault = new SecureEnterpriseCredentialVault(filename, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: value => Buffer.from(value),
    decryptString: value => Buffer.from(value as Buffer).toString('utf8')
  })
  await vault.replace(0, {
    base: BASE, access_token: 'fixture-access', refresh_token: 'fixture-refresh',
    access_expires_at: new Date(START + 24 * 60 * 60_000).toISOString(),
    refresh_expires_at: new Date(START + 48 * 60 * 60_000).toISOString(),
    user: { id: 'user-1', username: 'alice', display_name: 'Stored Alice' },
    tenant: { id: 'tenant-1', name: 'Fixture Enterprise' }
  })
  const storedBytes = await readFile(filename)
  const replace = vi.spyOn(vault, 'replace')
  let now = START
  const requests: string[] = []
  const notes: string[] = []
  const service = new EnterpriseService({
    vault, now: () => now, allowInsecureLoopback: false,
    note: entry => notes.push(entry.event),
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname
      requests.push(path)
      if (path === '/api/v1/dsh/profile') return profileFetch(input, init)
      if (path === '/api/v1/dsh/models') return Response.json({ object: 'list', data: [{
        id: 'bisheng:1', display_name: 'Assigned model',
        capabilities: { streaming: true, tools: true, reasoning_content: false }
      }] })
      if (path === '/api/v1/dsh/config') return Response.json({ enabled: false })
      if (path === '/api/v1/dsh/usage') return Response.json({})
      if (path === '/api/v1/dsh/logout') return Response.json({})
      throw new Error(`Unexpected request: ${path}`)
    }
  })
  cleanups.push(async () => {
    await service.stop()
    // directory is the exact temporary root created above, never a user Profile.
    await rm(directory, { recursive: true, force: true })
  })
  await service.restore()
  return { service, vault, replace, filename, storedBytes, requests, notes,
    at: (elapsed: number) => { now = START + elapsed },
    profileRequests: () => requests.filter(path => path === '/api/v1/dsh/profile') }
}

describe('enterprise display profile parser', () => {
  it.each([
    ['/minio/avatar.png?X-Amz-Signature=a%2Fb&X-Amz-Expires=60', 'https://enterprise.example/minio/avatar.png?X-Amz-Signature=a%2Fb&X-Amz-Expires=60'],
    ['avatars/alice.png?signature=abc', 'https://enterprise.example/avatars/alice.png?signature=abc'],
    ['https://enterprise.example/minio/a.png?signature=abc', 'https://enterprise.example/minio/a.png?signature=abc']
  ])('resolves %s without removing storage signatures', (avatar, expected) => {
    const state = new EnterpriseProfileState()
    state.apply(profile(avatar), BASE, 'user-1', 'tenant-1', START)
    expect(state.user).toEqual({ id: 'user-1', username: 'alice', display_name: 'Alice Updated', avatar: expected })
  })

  it.each([null, ''])('preserves explicit avatar removal %j as null', avatar => {
    const state = new EnterpriseProfileState()
    state.apply(profile(avatar), BASE, 'user-1', 'tenant-1', START)
    expect(state.user?.avatar).toBeNull()
  })

  it('does not invent an avatar when the field is missing', () => {
    const state = new EnterpriseProfileState()
    const body = { user: { id: 'user-1', username: 'alice', display_name: 'Alice' }, tenant: { id: 'tenant-1' } }
    state.apply(body, BASE, 'user-1', 'tenant-1', START)
    expect(state.user).not.toHaveProperty('avatar')
  })

  it.each([
    7, {}, [], 'x'.repeat(16_385), 'https://other.example/a.png', '//other.example/a.png',
    'https://user:password@enterprise.example/a.png', '/a.png#fragment',
    'data:image/png;base64,a', 'javascript:alert(1)', 'file:///tmp/avatar.png', 'http://enterprise.example/a.png', 'https://['
  ])('rejects invalid or untrusted avatar %j atomically', avatar => {
    const state = new EnterpriseProfileState()
    state.apply(profile(), BASE, 'user-1', 'tenant-1', START)
    const previous = state.user
    expect(() => state.apply(profile(avatar), BASE, 'user-1', 'tenant-1', START + 60_000)).toThrow()
    expect(state.user).toBe(previous)
  })

  it.each([
    null, [], {}, { user: {}, tenant: {} },
    { ...profile(), user: { ...profile().user, id: 'other-user' } },
    { ...profile(), tenant: { id: 'other-tenant' } },
    { ...profile(), user: { ...profile().user, username: ' ' } },
    { ...profile(), user: { ...profile().user, display_name: null } }
  ])('rejects missing, malformed and mismatched identities %j', body => {
    const state = new EnterpriseProfileState()
    expect(() => state.apply(body, BASE, 'user-1', 'tenant-1', START)).toThrow()
    expect(state.user).toBeUndefined()
  })
})

describe('enterprise service display profile refresh', () => {
  it('warms after session restore, publishes detached metadata, and never writes signed URLs into the vault', async () => {
    const r = await runtime()
    await r.service.refreshProfile()
    await r.service.refreshModels()
    expect(r.profileRequests()).toHaveLength(1)
    expect(r.service.snapshot()).toMatchObject({ connected: true, phase: 'connected', modelsAvailable: true,
      user: { display_name: 'Alice Updated', avatar: 'https://enterprise.example/minio/avatar.png?X-Amz-Signature=display-secret' } })
    const before = r.service.snapshot()
    if (before.user) before.user.display_name = 'Caller mutation'
    expect(r.service.snapshot().user?.display_name).toBe('Alice Updated')
    expect(r.replace).not.toHaveBeenCalled()
    expect(await readFile(r.filename)).toEqual(r.storedBytes)
    expect(JSON.stringify(await r.vault.read())).not.toContain('display-secret')
    expect((await r.vault.read()).session?.user?.display_name).toBe('Stored Alice')
  })

  it.each(['account', 'image'] as const)('throttles explicit %s events to 60 seconds', async reason => {
    const r = await runtime()
    await r.service.refreshProfile()
    await r.service.refreshModels(true)
    r.at(59_999)
    await r.service.refreshProfile(reason)
    expect(r.profileRequests()).toHaveLength(1)
    r.at(60_000)
    const before = r.service.snapshot()
    await r.service.refreshProfile(reason)
    expect(r.profileRequests()).toHaveLength(2)
    // Catalog requests also update diagnostic request IDs; compare the actual metadata,
    // not the revision that can publish those deferred diagnostics.
    const after = r.service.snapshot()
    expect({ ...after, revision: 0 }).toEqual({ ...before, revision: 0 })
  })

  it('publishes a changed avatar and clears it when the platform removes it', async () => {
    let avatar: string | null = '/minio/first.png?signature=first'
    const r = await runtime(async () => Response.json(profile(avatar)))
    await r.service.refreshProfile()
    expect(r.service.snapshot().user?.avatar).toBe('https://enterprise.example/minio/first.png?signature=first')
    avatar = '/minio/second.png?signature=second'
    r.at(60_000)
    await r.service.refreshProfile('account')
    expect(r.service.snapshot().user?.avatar).toBe('https://enterprise.example/minio/second.png?signature=second')
    avatar = null
    r.at(120_000)
    await r.service.refreshProfile('account')
    expect(r.service.snapshot().user?.avatar).toBeNull()
    expect(r.replace).not.toHaveBeenCalled()
  })

  it('uses a five-minute freshness window for foreground events', async () => {
    const r = await runtime()
    await r.service.refreshProfile()
    r.at(299_999)
    await r.service.refreshProfile('foreground')
    expect(r.profileRequests()).toHaveLength(1)
    r.at(300_000)
    await r.service.refreshProfile('foreground')
    expect(r.profileRequests()).toHaveLength(2)
  })

  it('coalesces simultaneous restore/account/image/foreground requests', async () => {
    const gate = deferred<Response>()
    const entered = deferred<void>()
    const r = await runtime(async () => { entered.resolve(); return gate.promise })
    await entered.promise
    const pending = [r.service.refreshProfile('account'), r.service.refreshProfile('image'), r.service.refreshProfile('foreground')]
    expect(r.profileRequests()).toHaveLength(1)
    gate.resolve(Response.json(profile()))
    await Promise.all(pending)
    expect(r.profileRequests()).toHaveLength(1)
    expect(r.service.snapshot().user?.display_name).toBe('Alice Updated')
  })

  it('aborts and ignores an old profile response after logout', async () => {
    const gate = deferred<Response>()
    const entered = deferred<void>()
    let signal: AbortSignal | null | undefined
    const r = await runtime(async (_input, init) => { signal = init?.signal; entered.resolve(); return gate.promise })
    await entered.promise
    const pending = r.service.refreshProfile()
    await r.service.logout()
    expect(signal?.aborted).toBe(true)
    gate.resolve(Response.json(profile()))
    await pending
    expect(r.service.snapshot()).toMatchObject({ connected: false, models: [], modelsAvailable: false })
    expect(r.service.snapshot().user).toBeUndefined()
    expect(r.notes).not.toContain('profile_refresh_failed')
    expect((await r.vault.read()).session).toBeNull()
  })

  it('backs off failures (120s, 240s, capped 300s), recovers, and never degrades assigned models', async () => {
    let fail = false
    const r = await runtime(async () => fail ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json(profile()))
    await r.service.refreshProfile()
    await r.service.refreshModels()
    const before = r.service.snapshot()
    fail = true
    for (const [attemptAt, retryAt] of [[60_000, 180_000], [180_000, 420_000], [420_000, 720_000], [720_000, 1_020_000]] as const) {
      r.at(attemptAt)
      await r.service.refreshProfile('image')
      const count = r.profileRequests().length
      r.at(retryAt - 1)
      await r.service.refreshProfile('account')
      expect(r.profileRequests()).toHaveLength(count)
      expect(r.service.snapshot()).toMatchObject({ phase: 'connected', connected: true, modelsAvailable: true,
        models: before.models, user: before.user })
    }
    fail = false
    r.at(1_020_000)
    await r.service.refreshProfile()
    r.at(1_080_000)
    await r.service.refreshProfile()
    expect(r.profileRequests()).toHaveLength(7)
    expect(r.notes.filter(note => note === 'profile_refresh_failed')).toHaveLength(4)
    expect(r.replace).not.toHaveBeenCalled()
  })

  it.each([404, 405])('disables unsupported profile endpoints after HTTP %s', async status => {
    const r = await runtime(async () => Response.json({ error: 'unsupported' }, { status }))
    await r.service.refreshProfile()
    r.at(24 * 60 * 60_000)
    await r.service.refreshProfile('account')
    await r.service.refreshProfile('foreground')
    expect(r.profileRequests()).toHaveLength(1)
    expect(r.service.snapshot().connected).toBe(true)
  })

  it('does not poll or retry in the background, including repeated state reads', async () => {
    const r = await runtime(async () => Response.json({ error: 'unavailable' }, { status: 503 }))
    await r.service.refreshProfile()
    await r.service.refreshModels(true)
    r.requests.length = 0
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    r.at(60 * 60_000)
    for (let i = 0; i < 5; i++) await r.service.readState()
    expect(r.requests).toEqual([])
  })
})
