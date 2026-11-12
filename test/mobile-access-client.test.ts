import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { startMobileAccessClient, type MobileAccessClient } from '../src/main/mobile/mobile-access-client'
import { MOBILE_BIND_PATH, MOBILE_UNBIND_PATH, type MobileAccessAccount } from '../src/main/mobile/mobile-access-protocol'
import type { MobileAccessRecord } from '../src/main/mobile/mobile-access-store'

const clients: MobileAccessClient[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  const stopping = Promise.all(clients.splice(0).map((client) => client.stop()))
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10_000)
  await stopping
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('deferred not initialized') }
  let reject: (error: Error) => void = () => { throw new Error('deferred not initialized') }
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function setup(fetchImpl: typeof fetch, connectSocket?: Parameters<typeof startMobileAccessClient>[0]['connectSocket'], base = 'http://access.invalid', subscribeAccount?: Parameters<typeof startMobileAccessClient>[0]['subscribeAccount']) {
  let account: MobileAccessAccount = { base, accessToken: 'secret-token', userId: 'a', tenantId: 'tenant' }
  let record: MobileAccessRecord = { desktopId: 'd'.repeat(32), attachSecret: 's'.repeat(32) }
  const notes: string[] = []
  const client = startMobileAccessClient({
    account: () => account,
    subscribeAccount,
    bridge: { port: () => 12345, channelToken: () => 'channel-secret' },
    store: { load: () => record, save: (value) => { record = value; return true } },
    displayName: () => 'desktop',
    fetchImpl,
    connectSocket,
    note: (message) => notes.push(message)
  })
  clients.push(client)
  return {
    client, notes,
    switchAccount: (userId: string) => { account = { ...account, userId } },
    signOut: () => { account = {} },
    setAccount: (value: MobileAccessAccount) => { account = value },
    refreshToken: (accessToken: string) => { account = { ...account, accessToken } }
  }
}

function fakeSocket() {
  return { readyState: 1, send: vi.fn<(data: string) => void>(), close: vi.fn<() => void>() }
}

const flush = async () => { await vi.advanceTimersByTimeAsync(0) }

describe('mobile access ownership and retry lifecycle', () => {
  it.each(['subscription', 'watcher', 'stop'] as const)('refreshes retired cleanup credentials via %s before late bind success', async source => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    let listener: ((account: MobileAccessAccount) => void) | undefined
    let registered = false
    let authorization: string | null = null
    const connect = vi.fn(async () => fakeSocket())
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) {
        authorization = new Headers(init?.headers).get('authorization')
        if (authorization !== 'Bearer fresh-token') return new Response(null, { status: 401 })
        registered = false
        return new Response()
      }
      await pending.promise
      registered = true
      return new Response()
    }, connect, 'http://access.invalid', fn => { listener = fn; return () => { listener = undefined } })
    // Timeout retires this unbound connection: only its cleanup queue retains it.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(state.notes).toContain('[mobile-access] bind_failed')
    state.refreshToken('fresh-token')
    let stopping: Promise<void> | undefined
    if (source === 'subscription') {
      listener?.({ base: 'http://access.invalid', accessToken: 'fresh-token', userId: 'a', tenantId: 'tenant' })
      state.signOut()
      listener?.({})
    } else if (source === 'watcher') {
      await vi.advanceTimersByTimeAsync(2_000)
      state.signOut()
      await vi.advanceTimersByTimeAsync(2_000)
    } else stopping = state.client.stop()
    pending.resolve(new Response())
    await flush()
    if (stopping) await stopping
    else await state.client.stop()
    expect(authorization).toBe('Bearer fresh-token')
    expect(registered).toBe(false)
    expect(connect).not.toHaveBeenCalled()
    expect(state.notes).not.toContain('[mobile-access] unbind_rejected status=401')
  })

  it('hands off refreshed credentials before immediate logout, without a watcher tick', async () => {
    vi.useFakeTimers()
    let listener: ((account: MobileAccessAccount) => void) | undefined
    const unsubscribe = vi.fn()
    let authorization: string | null = null
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) authorization = new Headers(init?.headers).get('authorization')
      return new Response()
    }, async () => fakeSocket(), 'http://access.invalid', fn => { listener = fn; return unsubscribe })
    await flush()
    state.refreshToken('fresh-token')
    state.signOut()
    // Enterprise sends a retiring snapshot before the revoked notification.
    listener?.({ base: 'http://access.invalid', accessToken: 'fresh-token', userId: 'a', tenantId: 'tenant' })
    listener?.({})
    await flush()
    expect(authorization).toBe('Bearer fresh-token')
    await state.client.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('cleans late bind success before replacement bind (stop=%s)', async stop => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    const order: string[] = []
    let registered = false
    let binds = 0
    const state = setup(async input => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) {
        order.push('unbind'); registered = false; return new Response()
      }
      binds++
      if (binds === 1) {
        order.push('bind-start')
        await pending.promise
        order.push('late-bind-commit'); registered = true
        return new Response()
      }
      order.push('replacement-bind'); registered = true; return new Response()
    }, async () => fakeSocket())
    state.signOut()
    await vi.advanceTimersByTimeAsync(2_000)
    let stopping: Promise<void> | undefined
    if (stop) stopping = state.client.stop()
    else {
      state.setAccount({ base: 'http://access.invalid', accessToken: 'new-token', userId: 'a', tenantId: 'tenant' })
      await vi.advanceTimersByTimeAsync(2_000)
    }
    // An abort-ignoring bind must hold the barrier beyond its nominal timeout.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(order).toEqual(['bind-start'])
    pending.resolve(new Response())
    await flush()
    if (stopping) await stopping
    expect(order).toEqual(stop ? ['bind-start', 'late-bind-commit', 'unbind'] : ['bind-start', 'late-bind-commit', 'unbind', 'replacement-bind'])
    expect(registered).toBe(!stop)
  })

  it.each([false, true])('cleans both the old bound connection and a pending retry (stop=%s)', async stop => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    const socket = fakeSocket()
    let binds = 0
    let registered = false
    let unbinds = 0
    const state = setup(async input => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) {
        unbinds++; registered = false; return new Response()
      }
      binds++
      if (binds === 2) await pending.promise
      registered = true
      return new Response()
    }, async () => socket)
    await flush()
    socket.readyState = 3
    await vi.advanceTimersByTimeAsync(2_000)
    expect(binds).toBe(2)
    let stopping: Promise<void> | undefined
    if (stop) stopping = state.client.stop()
    else { state.signOut(); await vi.advanceTimersByTimeAsync(2_000) }
    await flush()
    pending.resolve(new Response())
    await flush()
    if (stopping) await stopping
    expect(unbinds).toBe(2)
    expect(registered).toBe(false)
  })

  it('finishes an old unbind before rebinding the same account and device', async () => {
    vi.useFakeTimers()
    const oldCleanup = deferred<Response>()
    let registered = false
    let binds = 0
    let unbinds = 0
    const connect = vi.fn(async () => fakeSocket())
    const state = setup(async (input) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) {
        unbinds++
        if (unbinds === 1) { await oldCleanup.promise; registered = false }
        return new Response()
      }
      binds++
      registered = true
      return new Response()
    }, connect)
    await flush()
    state.signOut()
    await vi.advanceTimersByTimeAsync(2_000)
    state.setAccount({ base: 'http://access.invalid', accessToken: 'new-token', userId: 'a', tenantId: 'tenant' })
    // Even a transport that ignores its 10s abort must not release the barrier.
    await vi.advanceTimersByTimeAsync(12_000)
    expect(binds).toBe(1)
    expect(connect).toHaveBeenCalledTimes(1)
    oldCleanup.resolve(new Response())
    await flush()
    expect(binds).toBe(2)
    expect(registered).toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('uses refreshed cleanup credentials even without a watcher tick: %s', async tick => {
    vi.useFakeTimers()
    let authorization: string | null = null
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) authorization = new Headers(init?.headers).get('authorization')
      return new Response()
    }, async () => fakeSocket())
    await flush()
    state.refreshToken('fresh-token')
    if (tick) await vi.advanceTimersByTimeAsync(2_000)
    await state.client.stop()
    expect(authorization).toBe('Bearer fresh-token')
  })

  it.each([401, 500])('reports unbind HTTP %s without exposing credentials', async status => {
    vi.useFakeTimers()
    const state = setup(async input => new URL(String(input)).pathname === MOBILE_UNBIND_PATH
      ? new Response(null, { status }) : new Response(), async () => fakeSocket())
    await flush()
    await state.client.stop()
    expect(state.notes).toContain(`[mobile-access] unbind_rejected status=${status}`)
    expect(state.notes.join('\n')).not.toContain('secret-token')
  })

  it('does not bind an identity that could not be persisted and recovers on retry', async () => {
    vi.useFakeTimers()
    let stored: MobileAccessRecord = {}
    let writable = false
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response())
    const socket = fakeSocket()
    const client = startMobileAccessClient({
      account: () => ({ base: 'http://access.invalid', accessToken: 'token', userId: 'a', tenantId: 't' }),
      bridge: { port: () => 12345, channelToken: () => 'channel' },
      store: { load: () => stored, save: value => { if (!writable) return false; stored = value; return true } },
      displayName: () => 'desktop', fetchImpl, connectSocket: async () => socket
    })
    clients.push(client)
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(socket.send).not.toHaveBeenCalled()
    writable = true
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const boundId = stored.desktopId
    // Cleanup must use the exact bound identity, not a later disk read.
    stored = {}
    await client.stop()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({ desktopId: boundId })
  })

  it('does not forward bind credentials to a cross-origin redirect target', async () => {
    let leaked = 0
    const target = createServer((_request, response) => { leaked++; response.end('{}') })
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
    const address = target.address()
    if (!address || typeof address === 'string') throw new Error('target has no port')
    const origin = createServer((_request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${address.port}/unexpected` })
      response.end()
    })
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
    const source = origin.address()
    if (!source || typeof source === 'string') throw new Error('origin has no port')
    cleanups.push(async () => {
      await Promise.all([origin, target].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    })
    const failed = deferred<void>()
    const connect = vi.fn(async () => fakeSocket())
    const client = startMobileAccessClient({
      account: () => ({ base: `http://127.0.0.1:${source.port}`, accessToken: 'token', userId: 'a', tenantId: 't' }),
      bridge: { port: () => 12345, channelToken: () => 'channel' },
      store: { load: () => ({ desktopId: 'd'.repeat(32), attachSecret: 's'.repeat(32) }), save: () => true },
      displayName: () => 'desktop', connectSocket: connect,
      note: message => { if (message.includes('bind_failed')) failed.resolve() }
    })
    clients.push(client)
    await failed.promise
    expect(leaked).toBe(0)
    expect(connect).not.toHaveBeenCalled()
    await client.stop()
    expect(leaked).toBe(0)
  })

  it('keeps a slow bind singleflight across watch ticks', async () => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    const bind = vi.fn(() => pending.promise)
    const socket = fakeSocket()
    const connect = vi.fn(async () => socket)
    setup(async (input) => new URL(String(input)).pathname === MOBILE_UNBIND_PATH ? new Response() : bind(), connect)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(bind).toHaveBeenCalledTimes(1)
    pending.resolve(new Response())
    await flush()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(socket.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(bind).toHaveBeenCalledTimes(1)
  })

  it.each([{ status: 404, delay: 60_000 }, { status: 501, delay: 60_000 }, { status: 503, delay: 20_000 }, { status: 0, delay: 20_000 }])(
    'honors $delay ms backoff for status $status despite watch ticks', async ({ status, delay }) => {
      vi.useFakeTimers()
      const bind = vi.fn(async () => {
        if (!status) throw new Error('network failed')
        return new Response(null, { status })
      })
      const connect = vi.fn(async () => fakeSocket())
      const state = setup(async (input) => new URL(String(input)).pathname === MOBILE_UNBIND_PATH ? new Response() : bind(), connect)
      await flush()
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(bind).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(bind).toHaveBeenCalledTimes(2)
      expect(connect).not.toHaveBeenCalled()
      expect(state.notes.join('\n')).not.toContain('secret-token')
      state.switchAccount('b')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(bind).toHaveBeenCalledTimes(3)
    }
  )

  it('cancels pending bind on identity change without waiting for unbind or stale errors', async () => {
    vi.useFakeTimers()
    const old = deferred<Response>()
    const bind = vi.fn<typeof fetch>(async (_input, init) => init?.headers && 'authorization' in init.headers ? old.promise : new Response())
    let binds = 0
    let oldSignal: AbortSignal | null | undefined
    const connect = vi.fn(async () => fakeSocket())
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Promise<Response>(() => undefined)
      binds++
      if (binds === 1) { oldSignal = init?.signal; return bind(input, init) }
      return new Response()
    }, connect)
    state.switchAccount('b')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(oldSignal?.aborted).toBe(true)
    expect(connect).toHaveBeenCalledTimes(1)
    old.reject(new Error('old failed'))
    await flush()
    expect(state.notes).not.toContain('[mobile-access] bind_failed')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(binds).toBe(2)
  })

  it('closes a late attach hook and gives stop a bounded exit with pending unbind', async () => {
    vi.useFakeTimers()
    const opening = deferred<ReturnType<typeof fakeSocket>>()
    let attachSignal: AbortSignal | undefined
    const state = setup(async (input) => new URL(String(input)).pathname === MOBILE_UNBIND_PATH
      ? new Promise<Response>(() => undefined) : new Response(), async (_url, signal) => {
      attachSignal = signal
      return opening.promise
    })
    await flush()
    let stopped = false
    const stopping = state.client.stop().then(() => { stopped = true })
    expect(attachSignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    await stopping
    expect(stopped).toBe(true)
    const late = fakeSocket()
    opening.resolve(late)
    await flush()
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(late.send).not.toHaveBeenCalled()
  })

  it('bounds stop with a pending bind and cleans up its late success without attaching', async () => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    const connect = vi.fn(async () => fakeSocket())
    let signal: AbortSignal | null | undefined
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Response()
      signal = init?.signal
      return pending.promise
    }, connect)
    const stopping = state.client.stop()
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    await stopping
    pending.resolve(new Response())
    await flush()
    expect(connect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).not.toHaveBeenCalled()
  })

  it('starts a new identity while the old attach is pending and ignores its late failure', async () => {
    vi.useFakeTimers()
    const old = deferred<ReturnType<typeof fakeSocket>>()
    let calls = 0
    const replacement = fakeSocket()
    const state = setup(async () => new Response(), async () => {
      calls++
      return calls === 1 ? old.promise : replacement
    })
    await flush()
    state.switchAccount('b')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toBe(2)
    old.reject(new Error('old attach failed'))
    await flush()
    expect(state.notes).not.toContain('[mobile-access] attach_failed')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(calls).toBe(2)
    expect(replacement.close).not.toHaveBeenCalled()
  })

  it('unbinds a successful bind on stop even after attach failure retired the connection', async () => {
    vi.useFakeTimers()
    const unbind = vi.fn()
    const state = setup(async (input) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) unbind()
      return new Response()
    }, async () => { throw new Error('attach failed') })
    await flush()
    expect(state.notes).toContain('[mobile-access] attach_failed')
    await state.client.stop()
    expect(unbind).toHaveBeenCalledTimes(1)
  })

  it('times out pending bind and attach and retries after a real cooldown', async () => {
    vi.useFakeTimers()
    let binds = 0
    const connect = vi.fn(() => new Promise<ReturnType<typeof fakeSocket>>(() => undefined))
    setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Response()
      binds++
      // Retry is safe after the old transport settles, not merely after our deadline.
      return binds === 1 ? new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }) : new Response()
    }, connect)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(binds).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(binds).toBe(2)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(binds).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(binds).toBe(3)
  })
})

async function accessServer() {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  const arrivals: WebSocket[] = []
  const waiting: Array<(socket: WebSocket) => void> = []
  wss.on('connection', (socket) => {
    socket.once('message', () => {
      const resolve = waiting.shift()
      if (resolve) resolve(socket)
      else arrivals.push(socket)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server has no port')
  cleanups.push(async () => {
    for (const socket of wss.clients) socket.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return {
    base: `http://127.0.0.1:${address.port}`,
    next: () => {
      const socket = arrivals.shift()
      return socket ? Promise.resolve(socket) : new Promise<WebSocket>((resolve) => waiting.push(resolve))
    }
  }
}

async function turn() {
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
}

function request(socket: WebSocket, id: string) {
  socket.send(JSON.stringify({ type: 'request', id, path: '/api/v1/status', headers: {} }))
}

describe('mobile access forwarding over real WebSockets', () => {
  it.each([
    { change: 'account switch', sse: false },
    { change: 'same-account reconnect', sse: false },
    { change: 'account switch', sse: true },
    { change: 'same-account reconnect', sse: true }
  ])('drops late fetch and body responses after $change (SSE=$sse)', async ({ change, sse }) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const server = await accessServer()
    const pending = deferred<Response>()
    const body = deferred<string>()
    const started = deferred<void>()
    const secondStarted = deferred<void>()
    const signals: Array<AbortSignal | null | undefined> = []
    let calls = 0
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_BIND_PATH || new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Response()
      signals.push(init?.signal)
      calls++
      if (calls === 1) { started.resolve(); return pending.promise }
      const response = new Response('placeholder')
      response.text = () => body.promise
      secondStarted.resolve()
      return response
    }, undefined, server.base)
    const old = await server.next()
    request(old, 'late-fetch')
    await started.promise
    request(old, 'late-body')
    await secondStarted.promise
    await turn()
    if (change === 'account switch') state.switchAccount('b')
    else old.terminate()
    await turn()
    await vi.advanceTimersByTimeAsync(change === 'account switch' ? 2_000 : 8_000)
    const replacement = await server.next()
    const frames: string[] = []
    replacement.on('message', (frame) => frames.push(frame.toString()))
    pending.resolve(new Response('old secret response', sse ? { headers: { 'content-type': 'text/event-stream' } } : undefined))
    body.resolve('old secret body')
    await turn()
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
    expect(frames).toEqual([])
    expect(state.notes).not.toContain('[mobile-access] forward_failed')
  })

  it('closes this desktop stream after logout without invoking any mobile logout endpoint', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const server = await accessServer()
    const cancelled = vi.fn()
    const paths: string[] = []
    const state = setup(async (input) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path === MOBILE_BIND_PATH || path === MOBILE_UNBIND_PATH) return new Response()
      return new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } })
    }, undefined, server.base)
    const socket = await server.next()
    const first = new Promise<void>(resolve => socket.once('message', () => resolve()))
    request(socket, 'desktop-stream')
    await first
    state.signOut()
    await vi.advanceTimersByTimeAsync(2_000)
    await turn()
    expect(cancelled).toHaveBeenCalled()
    expect(socket.readyState).not.toBe(WebSocket.OPEN)
    expect(paths.filter(path => path === MOBILE_UNBIND_PATH)).toHaveLength(1)
    expect(paths.every(path => [MOBILE_BIND_PATH, MOBILE_UNBIND_PATH, '/api/v1/status'].includes(path))).toBe(true)
  })

  it('cancels a pending SSE reader and never sends chunks or end to the new account', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const server = await accessServer()
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller }, cancel: cancelled })
    const state = setup(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === MOBILE_BIND_PATH || path === MOBILE_UNBIND_PATH) return new Response()
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }, undefined, server.base)
    const old = await server.next()
    const first = new Promise<void>((resolve) => old.once('message', () => resolve()))
    request(old, 'events')
    await first
    streamController?.enqueue(new TextEncoder().encode('data: first\n\n'))
    await turn()
    state.switchAccount('b')
    await vi.advanceTimersByTimeAsync(2_000)
    const next = await server.next()
    const frames: string[] = []
    next.on('message', (frame) => frames.push(frame.toString()))
    await turn()
    expect(cancelled).toHaveBeenCalled()
    expect(frames).toEqual([])
  })
})
