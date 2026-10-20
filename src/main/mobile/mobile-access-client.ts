import WebSocket from 'ws'
import {
  MOBILE_ACCESS_HEARTBEAT_MS,
  MOBILE_ATTACH_PATH,
  MOBILE_BIND_PATH,
  MOBILE_UNBIND_PATH,
  REMOTE_CHANNEL_HEADER,
  REMOTE_CHANNEL_TOKEN_HEADER,
  REMOTE_TENANT_HEADER,
  REMOTE_USER_HEADER,
  mobileAccessAccountKey,
  type MobileAccessAccount
} from './mobile-access-protocol'
import {
  ensureMobileAccessIdentity,
  type MobileAccessRecord,
  type MobileAccessStore
} from './mobile-access-store'

export interface MobileAccessBridge {
  port(): number | undefined
  channelToken(): string
}

export interface MobileAccessClient {
  stop(): Promise<void>
}

interface AccessSocket {
  send(data: string): void
  close(): void
  readyState: number
}

const OPEN = 1

export function startMobileAccessClient(options: {
  account(): MobileAccessAccount
  bridge: MobileAccessBridge
  store: MobileAccessStore
  displayName(): string | undefined
  fetchImpl?: typeof fetch
  connectSocket?: (url: string) => Promise<AccessSocket>
  note?: (message: string) => void
}): MobileAccessClient {
  const fetchImpl = options.fetchImpl ?? fetch
  let stopped = false
  let socket: AccessSocket | undefined
  let attachedKey = ''
  let heart: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let missingPathNoted = false
  let boundAccount: MobileAccessAccount | undefined

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const closeSocket = () => {
    const current = socket
    socket = undefined
    attachedKey = ''
    if (heart) clearInterval(heart)
    heart = undefined
    current?.close()
  }

  const schedule = (delayMs: number) => {
    if (stopped) return
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void sync()
    }, delayMs)
    retryTimer.unref?.()
  }

  const identity = (): MobileAccessRecord => {
    const stored = options.store.load()
    const next = ensureMobileAccessIdentity(stored)
    if (next.desktopId !== stored.desktopId || next.attachSecret !== stored.attachSecret) {
      options.store.save(next)
    }
    return next
  }

  const unbind = async (account: MobileAccessAccount, record: MobileAccessRecord) => {
    if (!account.base || !account.accessToken || !record.desktopId) return
    try {
      await fetchImpl(new URL(MOBILE_UNBIND_PATH, account.base), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ desktopId: record.desktopId })
      })
    } catch {
      options.note?.('[mobile-access] unbind_failed')
    }
  }

  const forward = async (account: MobileAccessAccount, frame: Record<string, unknown>) => {
    const port = options.bridge.port()
    const id = typeof frame.id === 'string' ? frame.id : ''
    if (!port || !id) return
    const method = typeof frame.method === 'string' ? frame.method : 'GET'
    const path = typeof frame.path === 'string' ? frame.path : '/'
    const body = typeof frame.body === 'string' ? frame.body : undefined
    const incomingHeaders = isPlainObject(frame.headers) ? frame.headers : {}
    const headers: Record<string, string> = {
      [REMOTE_CHANNEL_HEADER]: 'remote',
      [REMOTE_CHANNEL_TOKEN_HEADER]: options.bridge.channelToken()
    }
    const userId = headerValue(incomingHeaders, REMOTE_USER_HEADER)
    const tenantId = headerValue(incomingHeaders, REMOTE_TENANT_HEADER)
    if (userId) headers[REMOTE_USER_HEADER] = userId
    if (tenantId) headers[REMOTE_TENANT_HEADER] = tenantId
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {})
      })
    } catch {
      socket?.send(JSON.stringify({ type: 'response', id, status: 502, headers: {}, body: '' }))
      return
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream') && response.body) {
      socket?.send(JSON.stringify({
        type: 'response-start',
        id,
        status: response.status,
        headers: { 'content-type': contentType }
      }))
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (!stopped) {
          const chunk = await reader.read()
          if (chunk.done) break
          socket?.send(JSON.stringify({
            type: 'response-chunk',
            id,
            data: decoder.decode(chunk.value, { stream: true })
          }))
        }
      } finally {
        socket?.send(JSON.stringify({ type: 'response-end', id }))
      }
      return
    }
    socket?.send(JSON.stringify({
      type: 'response',
      id,
      status: response.status,
      headers: { 'content-type': contentType },
      body: await response.text()
    }))
  }

  const attach = async (account: MobileAccessAccount, record: MobileAccessRecord, key: string, epoch: number) => {
    const url = new URL(MOBILE_ATTACH_PATH, account.base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const opened = options.connectSocket
      ? await options.connectSocket(url.toString())
      : await openWebSocket(url.toString())
    if (stopped || epoch !== generation) {
      opened.close()
      return
    }
    socket = opened
    attachedKey = key
    boundAccount = account
    opened.send(JSON.stringify({
      type: 'attach',
      desktopId: record.desktopId,
      attachSecret: record.attachSecret
    }))
    heart = setInterval(() => {
      if (socket?.readyState === OPEN) socket.send(JSON.stringify({ type: 'ping' }))
    }, MOBILE_ACCESS_HEARTBEAT_MS)
    heart.unref?.()
  }

  const sync = async () => {
    if (stopped) return
    const epoch = ++generation
    const account = options.account()
    const key = mobileAccessAccountKey(account)
    const record = identity()
    if (!key || (boundAccount && mobileAccessAccountKey(boundAccount) !== key)) {
      const previous = boundAccount
      boundAccount = undefined
      closeSocket()
      if (previous) await unbind(previous, record)
      if (!key) return
    }
    if (socket && attachedKey === key && socket.readyState === OPEN) return
    closeSocket()
    const displayName = record.displayName || options.displayName()
    let bindStatus = 0
    try {
      const response = await fetchImpl(new URL(MOBILE_BIND_PATH, account.base), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          desktopId: record.desktopId,
          attachSecret: record.attachSecret,
          ...(displayName ? { displayName } : {})
        })
      })
      bindStatus = response.status
    } catch {
      options.note?.('[mobile-access] bind_failed')
      schedule(20_000)
      return
    }
    if (stopped || epoch !== generation) return
    if (bindStatus === 404 || bindStatus === 501) {
      if (!missingPathNoted) {
        missingPathNoted = true
        options.note?.(`[mobile-access] bind_unavailable status=${bindStatus}`)
      }
      schedule(60_000)
      return
    }
    missingPathNoted = false
    if (bindStatus < 200 || bindStatus >= 300) {
      options.note?.(`[mobile-access] bind_rejected status=${bindStatus}`)
      schedule(20_000)
      return
    }
    try {
      await attach(account, record, key, epoch)
    } catch {
      options.note?.('[mobile-access] attach_failed')
      schedule(20_000)
    }
  }

  void sync()
  const watch = setInterval(() => {
    void sync()
  }, 2_000)
  watch.unref?.()

  return {
    async stop() {
      stopped = true
      clearInterval(watch)
      clearRetry()
      const account = options.account()
      const record = options.store.load()
      closeSocket()
      if (mobileAccessAccountKey(account)) await unbind(account, record)
    }
  }

  function openWebSocket(url: string): Promise<AccessSocket> {
    return new Promise((resolve, reject) => {
      const opened = new WebSocket(url)
      const wrapped: AccessSocket = {
        send: (data) => opened.send(data),
        close: () => opened.close(),
        get readyState() {
          return opened.readyState
        }
      }
      opened.once('open', () => resolve(wrapped))
      opened.once('error', () => reject(new Error('Mobile access socket failed.')))
      opened.on('message', (data) => {
        if (socket !== wrapped) return
        let frame: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(data.toString())
          if (!isPlainObject(parsed)) return
          frame = parsed
        } catch {
          return
        }
        if (frame.type === 'rejected') {
          options.note?.('[mobile-access] attach_rejected')
          closeSocket()
          schedule(20_000)
          return
        }
        if (frame.type === 'request') void forward(options.account(), frame)
      })
      opened.on('close', () => {
        if (socket !== wrapped || stopped) return
        closeSocket()
        schedule(5_000)
      })
    })
  }
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
