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

function setup(fetchImpl: typeof fetch, connectSocket?: Parameters<typeof startMobileAccessClient>[0]['connectSocket'], base = 'http://access.invalid') {
  let account: MobileAccessAccount = { base, accessToken: 'secret-token', userId: 'a', tenantId: 'tenant' }
  let record: MobileAccessRecord = { desktopId: 'd'.repeat(32), attachSecret: 's'.repeat(32) }
  const notes: string[] = []
  const client = startMobileAccessClient({
    account: () => account,
    bridge: { port: () => 12345, channelToken: () => 'channel-secret' },
    store: { load: () => record, save: (value) => { record = value; return true } },
    displayName: () => 'desktop',
    fetchImpl,
    connectSocket,
    note: (message) => notes.push(message)
  })
  clients.push(client)
  return { client, notes, switchAccount: (userId: string) => { account = { ...account, userId } } }
}

function fakeSocket() {
  return { readyState: 1, send: vi.fn<(data: string) => void>(), close: vi.fn<() => void>() }
}

const flush = async () => { await vi.advanceTimersByTimeAsync(0) }

describe('mobile access ownership and retry lifecycle', () => {
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

  it('stops pending bind immediately without accepting its late success', async () => {
    vi.useFakeTimers()
    const pending = deferred<Response>()
    const connect = vi.fn(async () => fakeSocket())
    let signal: AbortSignal | null | undefined
    const state = setup(async (input, init) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Response()
      signal = init?.signal
      return pending.promise
    }, connect)
    await state.client.stop()
    expect(signal?.aborted).toBe(true)
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
    setup(async (input) => {
      if (new URL(String(input)).pathname === MOBILE_UNBIND_PATH) return new Response()
      binds++
      return binds === 1 ? new Promise<Response>(() => undefined) : new Response()
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
