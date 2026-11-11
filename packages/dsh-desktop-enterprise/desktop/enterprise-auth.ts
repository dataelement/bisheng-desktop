import type { EnterpriseFetch } from './platform-fetch'

export const AUTH_MAX_REQUEST_BYTES = 1024 * 1024
export const AUTH_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
export const AUTH_MAX_CONCURRENT = 8
export const AUTH_MAX_INSTANCE_CONCURRENT = 4
export const AUTH_HEADER_TIMEOUT_MS = 15_000
export const AUTH_IDLE_TIMEOUT_MS = 60_000
export const AUTH_TOTAL_TIMEOUT_MS = 5 * 60_000

export class EnterpriseAuthError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`Enterprise auth request failed (${code}).`)
    this.name = 'EnterpriseAuthError'
  }
}

export interface EnterpriseAuthState {
  connected: boolean
  enterpriseId?: string
  userId?: string
  sessionVersion: string
}

export interface EnterpriseAuthRequest {
  path: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
  sessionVersion: string
}

function invalid(): never { throw new EnterpriseAuthError('invalid_request', 400) }

export function parseEnterpriseAuthRequest(input: unknown): EnterpriseAuthRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid()
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !['path', 'method', 'headers', 'body', 'bodyEncoding', 'sessionVersion'].includes(key))) invalid()
  const { path, sessionVersion } = value
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//') ||
      /[\\#\s\x00-\x1f\x7f]/u.test(path) || /%5c|%0[ad]/iu.test(path) ||
      typeof sessionVersion !== 'string' || !sessionVersion || sessionVersion.length > 256) invalid()
  const origin = 'https://enterprise.invalid'
  let url: URL
  try { url = new URL(path, origin) } catch { return invalid() }
  if (url.origin !== origin || url.username || url.password) invalid()
  const method = value.method === undefined ? 'GET' : value.method
  if (typeof method !== 'string' || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) invalid()
  const headers: Record<string, string> = {}
  if (value.headers !== undefined) {
    if (!value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers)) invalid()
    const entries = Object.entries(value.headers)
    if (entries.length > 64) invalid()
    let size = 0
    for (const [name, content] of entries) {
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name) || typeof content !== 'string' || /[^\x20-\x7e\t]/u.test(content) ||
          /authorization|cookie|token|secret|credential|api[-_]?key/iu.test(name) ||
          /^(host|connection|content-length|transfer-encoding|te|trailer|upgrade|expect|origin|referer|forwarded|via|accept-encoding|proxy-.*|sec-.*|x-forwarded-.*|x-dsh-.*)$/iu.test(name)) invalid()
      size += Buffer.byteLength(name) + Buffer.byteLength(content)
      if (size > 16 * 1024 || Object.hasOwn(headers, name.toLowerCase())) invalid()
      Object.defineProperty(headers, name.toLowerCase(), { value: content, enumerable: true, configurable: true })
    }
  }
  if (value.bodyEncoding !== undefined && value.bodyEncoding !== 'base64') invalid()
  let body: Uint8Array | undefined
  if (value.body !== undefined) {
    if (typeof value.body !== 'string' || method === 'GET' || method === 'HEAD') invalid()
    if (value.body.length > AUTH_MAX_REQUEST_BYTES * 2) throw new EnterpriseAuthError('request_too_large', 413)
    const decoded = Buffer.from(value.body, value.bodyEncoding === 'base64' ? 'base64' : 'utf8')
    if (value.bodyEncoding === 'base64' && decoded.toString('base64') !== value.body) invalid()
    body = decoded
    if (body.byteLength > AUTH_MAX_REQUEST_BYTES) throw new EnterpriseAuthError('request_too_large', 413)
  } else if (value.bodyEncoding !== undefined) invalid()
  return { path, method, headers, ...(body === undefined ? {} : { body }), sessionVersion }
}

const RESPONSE_HEADERS = new Set(['content-type', 'content-language', 'content-disposition', 'cache-control', 'expires', 'last-modified', 'etag', 'retry-after', 'x-request-id', 'request-id'])

function safeError(error: unknown): EnterpriseAuthError {
  return error instanceof EnterpriseAuthError ? error : new EnterpriseAuthError('request_failed', 502)
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(safeError(signal.reason))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined)
  })
}

export class EnterpriseAuthTransport {
  private readonly active = new Map<AbortController, string>()

  invalidate(): void {
    for (const controller of this.active.keys()) controller.abort(new EnterpriseAuthError('session_changed', 409))
  }

  async request(plugin: { pluginId: string; instanceId: string }, input: unknown, signal: AbortSignal, options: {
    assertSession: (version: string) => void
    access: (request: EnterpriseAuthRequest) => Promise<{ endpoint: string; accessToken: string }>
    fetch: EnterpriseFetch
    audit: (entry: { pluginId: string; path: string; status: number; duration: number }) => void
  }): Promise<Response> {
    const audit = (entry: { pluginId: string; path: string; status: number; duration: number }) => {
      try { options.audit(entry) } catch {
        // Telemetry failure must not interrupt body cleanup or reveal diagnostics.
      }
    }
    let request: EnterpriseAuthRequest
    try { request = parseEnterpriseAuthRequest(input) } catch (error) {
      audit({ pluginId: plugin.pluginId, path: '/', status: safeError(error).status, duration: 0 })
      throw safeError(error)
    }
    try {
      options.assertSession(request.sessionVersion)
      if (this.active.size >= AUTH_MAX_CONCURRENT || [...this.active.values()].filter(id => id === plugin.instanceId).length >= AUTH_MAX_INSTANCE_CONCURRENT) {
        throw new EnterpriseAuthError('too_many_requests', 429)
      }
    } catch (error) {
      audit({ pluginId: plugin.pluginId, path: request.path.split('?')[0] ?? '/', status: safeError(error).status, duration: 0 })
      throw safeError(error)
    }
    const controller = new AbortController()
    const started = Date.now()
    let status = 502
    let finished = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let upstream: Response | undefined
    let output: ReadableStreamDefaultController<Uint8Array> | undefined
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const timer = (ms: number) => {
      const handle = setTimeout(() => controller.abort(new EnterpriseAuthError('request_timeout', 504)), ms)
      handle.unref?.()
      timers.add(handle)
      return handle
    }
    const finish = () => {
      if (finished) return
      finished = true
      this.active.delete(controller)
      for (const handle of timers) clearTimeout(handle)
      signal.removeEventListener('abort', onCallerAbort)
      controller.signal.removeEventListener('abort', onAbort)
      audit({ pluginId: plugin.pluginId, path: request.path.split('?')[0] ?? '/', status, duration: Date.now() - started })
    }
    const cancelReader = () => {
      // Cancellation failures are cleanup-only; never expose backend diagnostics.
      if (reader) void reader.cancel().then(() => reader?.releaseLock()).catch(() => undefined)
      else void upstream?.body?.cancel().catch(() => undefined)
    }
    const onAbort = () => {
      const error = safeError(controller.signal.reason)
      status = error.status
      output?.error(error)
      cancelReader()
      finish()
    }
    const onCallerAbort = () => controller.abort(new EnterpriseAuthError('request_aborted', 499))
    const guard = () => {
      if (controller.signal.aborted) throw safeError(controller.signal.reason)
      options.assertSession(request.sessionVersion)
    }
    this.active.set(controller, plugin.instanceId)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    signal.addEventListener('abort', onCallerAbort, { once: true })
    timer(AUTH_TOTAL_TIMEOUT_MS)
    const headerTimer = timer(AUTH_HEADER_TIMEOUT_MS)
    if (signal.aborted) onCallerAbort()
    try {
      guard()
      const { endpoint, accessToken } = await abortable(options.access(request), controller.signal)
      guard()
      const upstreamPromise = options.fetch(endpoint, {
        method: request.method, headers: { ...request.headers, authorization: `Bearer ${accessToken}`, 'x-dsh-plugin-id': plugin.pluginId, 'x-dsh-plugin-instance-id': plugin.instanceId },
        ...(request.body === undefined ? {} : { body: Buffer.from(request.body) }),
        signal: controller.signal, redirect: 'error', credentials: 'omit'
      })
      // A fetch adapter may settle after cancellation; never leave its body open.
      void upstreamPromise.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined) }, () => undefined)
      upstream = await abortable(upstreamPromise, controller.signal)
      clearTimeout(headerTimer)
      timers.delete(headerTimer)
      guard()
      status = upstream.status
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        void upstream.body?.cancel().catch(() => undefined)
        throw new EnterpriseAuthError('redirect_rejected', 502)
      }
      const headers = new Headers()
      upstream.headers.forEach((value, name) => { if (RESPONSE_HEADERS.has(name)) headers.set(name, value) })
      if (!upstream.body || request.method === 'HEAD' || [204, 205, 304].includes(status)) {
        void upstream.body?.cancel().catch(() => undefined)
        guard()
        finish()
        return new Response(null, { status, headers })
      }
      reader = upstream.body.getReader()
      const responseReader = reader
      let bytes = 0
      let idleTimer = timer(AUTH_IDLE_TIMEOUT_MS)
      const body = new ReadableStream<Uint8Array>({
        start: stream => { output = stream },
        pull: async stream => {
          try {
            guard()
            const chunk = await abortable(responseReader.read(), controller.signal)
            guard()
            clearTimeout(idleTimer)
            timers.delete(idleTimer)
            if (chunk.done) { stream.close(); responseReader.releaseLock(); finish(); return }
            bytes += chunk.value.byteLength
            if (bytes > AUTH_MAX_RESPONSE_BYTES) throw new EnterpriseAuthError('response_too_large', 413)
            stream.enqueue(chunk.value)
            idleTimer = timer(AUTH_IDLE_TIMEOUT_MS)
          } catch (error) {
            if (!controller.signal.aborted) controller.abort(safeError(error))
          }
        },
        cancel: () => { controller.abort(new EnterpriseAuthError('request_aborted', 499)) }
      }, { highWaterMark: 0 })
      guard()
      return new Response(body, { status, headers })
    } catch (error) {
      const sanitized = controller.signal.aborted ? safeError(controller.signal.reason) : safeError(error)
      status = sanitized.status
      if (!controller.signal.aborted) controller.abort(sanitized)
      cancelReader()
      finish()
      throw sanitized
    }
  }
}
