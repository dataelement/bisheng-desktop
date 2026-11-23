import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const partitions = vi.hoisted(() => [] as Array<{
  name: string
  cookies: { set: ReturnType<typeof vi.fn> }
  clearStorageData: ReturnType<typeof vi.fn>
  closeAllConnections: ReturnType<typeof vi.fn>
  setPermissionRequestHandler: ReturnType<typeof vi.fn>
  setPermissionCheckHandler: ReturnType<typeof vi.fn>
}>)
vi.mock('electron', () => ({
  session: { fromPartition: vi.fn((name: string) => {
    const partition = { name, cookies: { set: vi.fn(async () => {}) }, clearStorageData: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}),
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    partitions.push(partition)
    return partition
  }) }
}))
import { HostedAppSession } from '../src/main/enterprise/hosted-app-session'
import type { EnterprisePublicState } from '../src/main/enterprise/enterprise-service'

function partition(index: number) { const value = partitions[index]; if (!value) throw new Error('Missing partition'); return value }
// Only the account fields the session reads; the rest of the public state is irrelevant here.
type AccountState = Pick<EnterprisePublicState, 'connected' | 'connectionKey'>
function account(initial: AccountState = { connected: true, connectionKey: 'a'.repeat(16) }) {
  let state = initial
  let listener: (next: EnterprisePublicState) => void = () => {}
  const unsubscribe = vi.fn()
  const webSession = vi.fn(async (connectionKey: string) => ({
    base: 'https://enterprise.test/prefix', cookie: 'web-session-cookie-value', cookieName: 'access_token_cookie', expiresAt: Date.now() + 300_000, connectionKey
  }))
  return {
    runtime: { snapshot: () => state as EnterprisePublicState, subscribe: (next: typeof listener) => { listener = next; return unsubscribe }, webSession },
    webSession, unsubscribe,
    change(next: AccountState) { state = next; listener(next as EnterprisePublicState) }
  }
}
let hosted: HostedAppSession | undefined
beforeEach(() => { partitions.length = 0 })
afterEach(() => { hosted?.dispose(); hosted = undefined; vi.useRealTimers() })

it('signs the user\'s web login into one session shared by every hosted app page', async () => {
  const a = account()
  hosted = new HostedAppSession(a.runtime, vi.fn())
  const [first, second] = await Promise.all([hosted.acquire(), hosted.acquire()])
  expect(a.webSession).toHaveBeenCalledExactlyOnceWith('a'.repeat(16))
  expect(first).toEqual(second)
  expect(first).toMatchObject({ origin: 'https://enterprise.test', connectionKey: 'a'.repeat(16) })
  expect(partitions).toHaveLength(1)
  expect(partition(0).name).toMatch(/^enterprise-hosted-apps-/u)
  // Same cookie, scope and flags Desktop Chat writes for this credential.
  expect(partition(0).cookies.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    url: 'https://enterprise.test/prefix', name: 'access_token_cookie', value: 'web-session-cookie-value', path: '/', httpOnly: true, secure: true, sameSite: 'lax'
  }))
  expect(await hosted.acquire()).toEqual(first)
  expect(a.webSession).toHaveBeenCalledOnce()
})

it('grants only sanitized clipboard writes from the enterprise origin', async () => {
  hosted = new HostedAppSession(account().runtime, vi.fn())
  await hosted.acquire()
  const request = partition(0).setPermissionRequestHandler.mock.calls[0]?.[0] as (c: unknown, p: string, cb: (ok: boolean) => void, d: { requestingUrl: string }) => void
  const check = partition(0).setPermissionCheckHandler.mock.calls[0]?.[0] as (c: unknown, p: string, origin: string) => boolean
  const answers: boolean[] = []
  request(null, 'clipboard-sanitized-write', ok => answers.push(ok), { requestingUrl: 'https://enterprise.test/apps/board/' })
  request(null, 'clipboard-sanitized-write', ok => answers.push(ok), { requestingUrl: 'https://enterprise.test.evil/apps/board/' })
  request(null, 'media', ok => answers.push(ok), { requestingUrl: 'https://enterprise.test/apps/board/' })
  expect(answers).toEqual([true, false, false])
  expect(check(null, 'clipboard-sanitized-write', 'https://enterprise.test')).toBe(true)
  expect(check(null, 'notifications', 'https://enterprise.test')).toBe(false)
})

it('renews the cookie before it lapses without replacing the session open pages use', async () => {
  vi.useFakeTimers()
  const a = account()
  hosted = new HostedAppSession(a.runtime, vi.fn())
  const first = await hosted.acquire()
  await vi.advanceTimersByTimeAsync(300_000 - 30_000)
  expect(a.webSession).toHaveBeenCalledTimes(2)
  expect(partitions).toHaveLength(1)
  expect(partition(0).cookies.set).toHaveBeenCalledTimes(2)
  expect((await hosted.acquire()).session).toBe(first.session)
})

it('notes a failed renewal and signs again on the next open', async () => {
  vi.useFakeTimers()
  const a = account()
  const note = vi.fn()
  hosted = new HostedAppSession(a.runtime, note)
  await hosted.acquire()
  a.webSession.mockRejectedValueOnce(new Error('network'))
  await vi.advanceTimersByTimeAsync(300_000 - 30_000)
  expect(note).toHaveBeenCalledWith('[hosted-app] session_renew_failed network')
  await hosted.acquire()
  expect(a.webSession).toHaveBeenCalledTimes(3)
})

it.each([
  ['an account switch', { connected: true, connectionKey: 'b'.repeat(16) }],
  ['logout', { connected: false, connectionKey: 'a'.repeat(16) }]
])('ends every page of the previous identity on %s', async (_case, next) => {
  const a = account()
  hosted = new HostedAppSession(a.runtime, vi.fn())
  const reset = vi.fn()
  hosted.onReset(reset)
  await hosted.acquire()
  a.change(next)
  expect(reset).toHaveBeenCalledOnce()
  expect(partition(0).clearStorageData).toHaveBeenCalledOnce()
  if (next.connected) {
    expect((await hosted.acquire()).connectionKey).toBe('b'.repeat(16))
    expect(partitions).toHaveLength(2)
  } else {
    await expect(hosted.acquire()).rejects.toThrow('Enterprise login required.')
  }
})

it('discards a web session signed for an account that changed during the exchange', async () => {
  const a = account()
  let finish: (() => void) | undefined
  a.webSession.mockImplementationOnce(connectionKey => new Promise(resolve => {
    finish = () => resolve({ base: 'https://enterprise.test', cookie: 'old-account-cookie-value', cookieName: 'access_token_cookie', expiresAt: Date.now() + 300_000, connectionKey })
  }))
  hosted = new HostedAppSession(a.runtime, vi.fn())
  const pending = hosted.acquire()
  await vi.waitFor(() => expect(finish).toBeDefined())
  a.change({ connected: true, connectionKey: 'b'.repeat(16) })
  finish?.()
  await expect(pending).rejects.toThrow('Enterprise account changed.')
  expect(partitions).toHaveLength(0)
})

it('refuses to sign without an enterprise login', async () => {
  const a = account({ connected: false, connectionKey: '' })
  hosted = new HostedAppSession(a.runtime, vi.fn())
  await expect(hosted.acquire()).rejects.toThrow('Enterprise login required.')
  expect(a.webSession).not.toHaveBeenCalled()
})

it('stops following the account when disposed', async () => {
  const a = account()
  hosted = new HostedAppSession(a.runtime, vi.fn())
  await hosted.acquire()
  hosted.dispose()
  expect(a.unsubscribe).toHaveBeenCalledOnce()
  expect(partition(0).clearStorageData).toHaveBeenCalledOnce()
  hosted = undefined
})
