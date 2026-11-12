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

interface Connection {
  key: string
  account: MobileAccessAccount
  record: MobileAccessRecord
  controller: AbortController
  socket?: AccessSocket
  heart?: ReturnType<typeof setInterval>
  bindTask?: Promise<Response>
  cleanupTask?: Promise<void>
}

const OPEN = 1
const OPERATION_TIMEOUT_MS = 10_000

export function startMobileAccessClient(options: {
  account(): MobileAccessAccount
  /** Main-process credential handoff; never exposed to a renderer or mobile peer. */
  subscribeAccount?: (listener: (account: MobileAccessAccount) => void) => () => void
  bridge: MobileAccessBridge
  store: MobileAccessStore
  displayName(): string | undefined
  fetchImpl?: typeof fetch
  connectSocket?: (url: string, signal?: AbortSignal) => Promise<AccessSocket>
  note?: (message: string) => void
}): MobileAccessClient {
  const fetchImpl = options.fetchImpl ?? fetch
  let stopped = false
  let current: Connection | undefined
  let observedKey = ''
  // A disconnected/failed attach can still leave a successful server-side bind.
  let bound: Connection | undefined
  let retryAt = 0
  let missingPathNoted = false
  // Only the same account/device must wait: another account can connect independently.
  const cleanups = new Map<string, Promise<void>>()
  // Retired connections still own cleanup credentials until their mutations settle.
  const pendingCleanupConnections = new Set<Connection>()

  const owns = (connection: Connection) => !stopped && current === connection &&
    !connection.controller.signal.aborted && mobileAccessAccountKey(options.account()) === connection.key

  const close = (connection: Connection) => {
    connection.controller.abort()
    if (connection.heart) clearInterval(connection.heart)
    connection.socket?.close()
  }

  const retire = () => {
    const previous = current
    current = undefined
    if (previous) close(previous)
    return previous
  }

  const identity = (): MobileAccessRecord => {
    const stored = options.store.load()
    const next = ensureMobileAccessIdentity(stored)
    if (next.desktopId !== stored.desktopId || next.attachSecret !== stored.attachSecret) {
      if (!options.store.save(next)) throw new Error('Mobile access identity could not be stored.')
    }
    return next
  }

  const unbind = async (account: MobileAccessAccount, record: MobileAccessRecord) => {
    if (!account.base || !account.accessToken || !record.desktopId) return
    const controller = new AbortController()
    // Keep the same-device barrier until the transport actually settles. A
    // timeout alone cannot prove a server has stopped processing this mutation.
    const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS)
    timer.unref?.()
    try {
      const response = await fetchImpl(new URL(MOBILE_UNBIND_PATH, account.base), {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ desktopId: record.desktopId })
      })
      if (!response.ok) options.note?.(`[mobile-access] unbind_rejected status=${response.status}`)
    } catch {
      options.note?.('[mobile-access] unbind_failed')
    } finally {
      clearTimeout(timer)
    }
  }

  const cleanupKey = (account: MobileAccessAccount, record: MobileAccessRecord) =>
    `${mobileAccessAccountKey(account)}\n${record.desktopId ?? ''}`

  const queueUnbind = (binding: Connection) => {
    if (binding.cleanupTask) return binding.cleanupTask
    const key = cleanupKey(binding.account, binding.record)
    const previous = cleanups.get(key)
    const work = (previous ?? Promise.resolve()).then(async () => {
      // Abort only cancels our wait, not a server-side mutation. Join the actual
      // bind result before cleanup so late success cannot recreate a removed row.
      if (binding.bindTask) {
        try { await binding.bindTask } catch {
          // A failed/aborted bind may still have reached the server; unbind anyway.
        }
      }
      await unbind(binding.account, binding.record)
    })
    binding.cleanupTask = work
    pendingCleanupConnections.add(binding)
    cleanups.set(key, work)
    void work.finally(() => {
      pendingCleanupConnections.delete(binding)
      if (cleanups.get(key) === work) cleanups.delete(key)
    })
    return work
  }

  const send = (connection: Connection, frame: Record<string, unknown>) => {
    if (!owns(connection) || connection.socket?.readyState !== OPEN) return
    connection.socket.send(JSON.stringify(frame))
  }

  const forward = async (connection: Connection, frame: Record<string, unknown>) => {
    const port = options.bridge.port()
    const id = typeof frame.id === 'string' ? frame.id : ''
    if (!port || !id || !owns(connection)) return
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
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancelReader = () => {
      // Cancellation is best effort: a custom stream may itself never settle.
      void reader?.cancel().catch(() => options.note?.('[mobile-access] reader_cancel_failed'))
    }
    connection.controller.signal.addEventListener('abort', cancelReader, { once: true })
    try {
      const fetching = fetchImpl(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        redirect: 'error',
        signal: connection.controller.signal,
        ...(body !== undefined ? { body } : {})
      }).then((response) => {
        // A transport may ignore abort and resolve after its owner was retired.
        if (!owns(connection)) {
          void response.body?.cancel().catch(() => options.note?.('[mobile-access] body_cancel_failed'))
        }
        return response
      })
      const response = await untilAborted(connection.controller.signal, fetching)
      if (!owns(connection)) return
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') && response.body) {
        reader = response.body.getReader()
        send(connection, { type: 'response-start', id, status: response.status, headers: { 'content-type': contentType } })
        const decoder = new TextDecoder()
        while (owns(connection)) {
          const chunk = await untilAborted(connection.controller.signal, reader.read())
          if (chunk.done) break
          send(connection, { type: 'response-chunk', id, data: decoder.decode(chunk.value, { stream: true }) })
        }
        send(connection, { type: 'response-end', id })
      } else {
        const text = await untilAborted(connection.controller.signal, response.text())
        send(connection, { type: 'response', id, status: response.status, headers: { 'content-type': contentType }, body: text })
      }
    } catch {
      if (owns(connection)) {
        options.note?.('[mobile-access] forward_failed')
        send(connection, { type: 'response', id, status: 502, headers: {}, body: '' })
      }
    } finally {
      connection.controller.signal.removeEventListener('abort', cancelReader)
      cancelReader()
    }
  }

  const fail = (connection: Connection, delay: number) => {
    if (!owns(connection)) return
    retire()
    retryAt = Date.now() + delay
  }

  const connect = async (connection: Connection, record: MobileAccessRecord) => {
    let stage = 'bind'
    const displayName = record.displayName || options.displayName()
    try {
      // A delayed logout must finish before reusing its stable desktop ID.
      const cleanup = cleanups.get(cleanupKey(connection.account, record))
      if (cleanup) await untilAborted(connection.controller.signal, cleanup)
      if (!owns(connection)) return
      const response = await bounded(connection.controller, () => {
        const task = fetchImpl(new URL(MOBILE_BIND_PATH, connection.account.base), {
          method: 'POST',
          // The body contains the persistent attach secret; never forward it to a redirect target.
          redirect: 'error',
          signal: connection.controller.signal,
          headers: {
            authorization: `Bearer ${connection.account.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            desktopId: record.desktopId,
            attachSecret: record.attachSecret,
            ...(displayName ? { displayName } : {})
          })
        })
        connection.bindTask = task
        return task
      })
      if (!owns(connection)) {
        void queueUnbind(connection)
        return
      }
      if (response.status === 404 || response.status === 501) {
        if (!missingPathNoted) options.note?.(`[mobile-access] bind_unavailable status=${response.status}`)
        missingPathNoted = true
        fail(connection, 60_000)
        return
      }
      missingPathNoted = false
      if (!response.ok) {
        options.note?.(`[mobile-access] bind_rejected status=${response.status}`)
        fail(connection, 20_000)
        return
      }
      bound = connection
      stage = 'attach'
      const url = new URL(MOBILE_ATTACH_PATH, connection.account.base)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const opening = options.connectSocket
        ? options.connectSocket(url.toString(), connection.controller.signal)
        : openWebSocket(url.toString(), connection)
      // Hooks predating AbortSignal may resolve after cancellation; never retain that socket.
      void opening.then((opened) => {
        if (!owns(connection)) opened.close()
      }, () => undefined)
      const opened = await bounded(connection.controller, () => opening)
      if (!owns(connection)) { opened.close(); return }
      connection.socket = opened
      send(connection, { type: 'attach', desktopId: record.desktopId, attachSecret: record.attachSecret })
      connection.heart = setInterval(() => send(connection, { type: 'ping' }), MOBILE_ACCESS_HEARTBEAT_MS)
      connection.heart.unref?.()
    } catch {
      // Timeout aborts the operation too, but only the owner may change retry state.
      if (current !== connection || stopped || mobileAccessAccountKey(options.account()) !== connection.key) return
      options.note?.(`[mobile-access] ${stage}_failed`)
      retire()
      if (connection.bindTask) void queueUnbind(connection)
      retryAt = Date.now() + 20_000
    }
  }

  const updateCredentials = (account: MobileAccessAccount) => {
    const key = mobileAccessAccountKey(account)
    if (!key) return
    const connections = new Set(pendingCleanupConnections)
    if (current) connections.add(current)
    if (bound) connections.add(bound)
    for (const connection of connections) {
      if (connection.key === key) connection.account = { ...account }
    }
  }

  const sync = () => {
    if (stopped) return
    const account = { ...options.account() }
    const key = mobileAccessAccountKey(account)
    if (key !== observedKey) {
      const previous = retire()
      const previousBound = bound
      bound = undefined
      observedKey = key
      retryAt = 0
      missingPathNoted = false
      // Queue by account/device; unrelated identities need not wait for remote cleanup.
      if (previousBound) void queueUnbind(previousBound)
      if (previous && previous !== previousBound) void queueUnbind(previous)
    }
    // Token refresh does not change ownership, but cleanup must use fresh credentials.
    updateCredentials(account)
    if (!key || Date.now() < retryAt) return
    if (current) {
      if (!current.socket || current.socket.readyState === OPEN) return
      retire()
    }
    let record: MobileAccessRecord
    try {
      record = identity()
    } catch {
      // Do not create a server-side binding that cannot be recovered after restart.
      options.note?.('[mobile-access] identity_store_failed')
      retryAt = Date.now() + 20_000
      return
    }
    const connection: Connection = { key, account, record, controller: new AbortController() }
    current = connection
    void connect(connection, record)
  }

  // The retiring credential arrives before the getter becomes signed out.
  // Ownership checks still use the authoritative getter, never this event alone.
  const unsubscribe = options.subscribeAccount?.(account => {
    updateCredentials(account)
    sync()
  })
  sync()
  const watch = setInterval(sync, 2_000)
  watch.unref?.()

  return {
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(watch)
      unsubscribe?.()
      // stop() can run before the watcher observes the latest token refresh.
      const account = { ...options.account() }
      updateCredentials(account)
      const previous = retire()
      const previousBound = bound
      bound = undefined
      if (previousBound) void queueUnbind(previousBound)
      if (previous && previous !== previousBound) void queueUnbind(previous)
      const controller = new AbortController()
      try {
        await bounded(controller, () => Promise.all(cleanups.values()))
      } catch {
        // Shutdown stays bounded even for a transport that ignores cancellation.
        options.note?.('[mobile-access] cleanup_wait_timeout')
      }
    }
  }

  function openWebSocket(url: string, connection: Connection): Promise<AccessSocket> {
    return new Promise((resolve, reject) => {
      const opened = new WebSocket(url)
      const abort = () => opened.terminate()
      connection.controller.signal.addEventListener('abort', abort, { once: true })
      const wrapped: AccessSocket = {
        send: (data) => opened.send(data),
        close: () => opened.terminate(),
        get readyState() { return opened.readyState }
      }
      opened.once('open', () => resolve(wrapped))
      opened.once('error', () => reject(new Error('Mobile access socket failed.')))
      opened.on('message', (data) => {
        if (!owns(connection) || connection.socket !== wrapped) return
        let frame: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(data.toString())
          if (!isPlainObject(parsed)) return
          frame = parsed
        } catch { return }
        if (frame.type === 'rejected') {
          options.note?.('[mobile-access] attach_rejected')
          fail(connection, 20_000)
        } else if (frame.type === 'request') {
          void forward(connection, frame)
        }
      })
      opened.on('close', () => {
        connection.controller.signal.removeEventListener('abort', abort)
        fail(connection, 5_000)
      })
    })
  }
}

// Race even injected transports that ignore AbortSignal, so shutdown and ownership
// changes have a bounded exit independent of a remote server's cooperation.
function untilAborted<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('Mobile access operation cancelled.'))
    }
    // Always observe the original promise, including an already-cancelled race.
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function bounded<T>(controller: AbortController, operation: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS)
  timer.unref?.()
  try {
    return await untilAborted(controller.signal, operation())
  } finally {
    clearTimeout(timer)
  }
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
