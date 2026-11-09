import { EnterpriseAuthError } from './enterprise-auth.js'

const MAX_REQUEST = 1024 * 1024
const MAX_RESPONSE = 32 * 1024 * 1024
const RESPONSE_HEADERS = new Set(['content-type', 'content-language', 'content-disposition', 'cache-control', 'expires', 'last-modified', 'etag', 'retry-after', 'x-request-id', 'request-id'])

function failure(code, status = 403) {
  return new EnterpriseAuthError(code, `Enterprise authorization failed (${code}).`, status)
}

function validateRequest(path, init) {
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//') || /[\\#\s\x00-\x1f\x7f]/u.test(path) || /%5c|%0[ad]/iu.test(path)) throw failure('invalid_request', 400)
  const origin = 'https://enterprise.invalid'
  const url = new URL(path, origin)
  if (url.origin !== origin || url.username || url.password) throw failure('invalid_request', 400)
  const method = init.method ?? 'GET'
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw failure('invalid_request', 400)
  let headers
  try { headers = new Headers(init.headers) } catch { throw failure('invalid_request', 400) }
  let count = 0, size = 0
  for (const [name, value] of headers) {
    count++
    size += Buffer.byteLength(name) + Buffer.byteLength(value)
    if (/authorization|cookie|token|secret|credential|api[-_]?key/iu.test(name) || /^(host|connection|content-length|transfer-encoding|te|trailer|upgrade|expect|origin|referer|forwarded|via|accept-encoding|proxy-.*|sec-.*|x-forwarded-.*|x-dsh-.*)$/iu.test(name) || /[^\x20-\x7e\t]/u.test(value)) throw failure('invalid_request', 400)
  }
  if (count > 64 || size > 16 * 1024) throw failure('invalid_request', 400)
  let body = init.body
  if (body != null) {
    if (method === 'GET' || method === 'HEAD') throw failure('invalid_request', 400)
    if (typeof body === 'string') body = Buffer.from(body)
    else if (body instanceof ArrayBuffer) body = Buffer.from(body)
    else if (ArrayBuffer.isView(body)) body = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    else throw failure('invalid_request', 400)
    if (body.byteLength > MAX_REQUEST) throw failure('request_too_large', 413)
  }
  return { path: url.pathname + url.search, method, headers, body }
}

/** Instance-scoped authorization for the standalone Web host. */
export function createWebEnterpriseAuth({ getAccount, getSessionAuth, fetchImpl = fetch }) {
  const grants = new Map()
  const requests = new Map()
  const assertSession = (grant, version = grant.connectionKey) => {
    const account = getAccount()
    if (!grant.active || !account?.connected || !grant.connectionKey || account.connectionKey !== grant.connectionKey || version !== grant.connectionKey) throw failure('session_changed', 409)
    return account
  }
  return {
    async grant(identity) {
      if (!identity || typeof identity.pluginId !== 'string' || !/^[a-f0-9]{32}$/u.test(identity.pluginId) || typeof identity.instanceId !== 'string' || !/^[a-z0-9-]{1,128}$/iu.test(identity.instanceId)) throw failure('invalid_request', 400)
      const account = getAccount()
      if (!account?.connected || !account.connectionKey) throw failure('authorization_denied')
      const grant = { active: true, connectionKey: account.connectionKey, pluginId: identity.pluginId, instanceId: identity.instanceId, controllers: new Set() }
      const transport = {
        async state(signal) {
          if (signal?.aborted) throw failure('request_aborted', 499)
          const current = assertSession(grant)
          return { connected: true, enterpriseId: current.tenant?.id, userId: current.user?.id, sessionVersion: grant.connectionKey }
        },
        async request(path, init = {}) {
          const parsed = validateRequest(path, init)
          assertSession(grant, init.sessionVersion)
          if (requests.size >= 8 || grant.controllers.size >= 4) throw failure('too_many_requests', 429)
          const controller = new AbortController()
          grant.controllers.add(controller)
          requests.set(controller, grant)
          const abort = () => controller.abort(failure('request_aborted', 499))
          init.signal?.addEventListener('abort', abort, { once: true })
          if (init.signal?.aborted) abort()
          const total = setTimeout(() => controller.abort(failure('request_timeout', 504)), 300000)
          const header = setTimeout(() => controller.abort(failure('request_timeout', 504)), 15000)
          let cleaned = false
          const cleanup = () => {
            if (cleaned) return
            cleaned = true
            clearTimeout(total); clearTimeout(header)
            init.signal?.removeEventListener('abort', abort)
            grant.controllers.delete(controller); requests.delete(controller)
          }
          try {
            const session = await getSessionAuth()
            assertSession(grant, init.sessionVersion)
            if (!session?.base || !session.tokens?.access_token) throw failure('authorization_denied')
            const base = new URL(session.base)
            const target = new URL(parsed.path, base)
            if (target.origin !== base.origin || !['http:', 'https:'].includes(target.protocol)) throw failure('invalid_request', 400)
            parsed.headers.set('authorization', `Bearer ${session.tokens.access_token}`)
            parsed.headers.set('x-dsh-plugin-id', grant.pluginId)
            parsed.headers.set('x-dsh-plugin-instance-id', grant.instanceId)
            const upstream = await fetchImpl(target, { method: parsed.method, headers: parsed.headers, ...(parsed.body == null ? {} : { body: parsed.body }), redirect: 'error', signal: controller.signal })
            clearTimeout(header)
            assertSession(grant, init.sessionVersion)
            const headers = new Headers()
            upstream.headers.forEach((value, name) => { if (RESPONSE_HEADERS.has(name)) headers.set(name, value) })
            if (!upstream.body || parsed.method === 'HEAD' || [204, 205, 304].includes(upstream.status)) {
              await upstream.body?.cancel()
              cleanup()
              return new Response(null, { status: upstream.status, headers })
            }
            const reader = upstream.body.getReader()
            let bytes = 0, idle
            const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(failure('request_timeout', 504)), 60000) }
            const finish = async (reason) => { clearTimeout(idle); try { await reader.cancel(reason) } finally { reader.releaseLock(); cleanup() } }
            const onAbort = () => { void finish(controller.signal.reason).catch(() => {}) }
            controller.signal.addEventListener('abort', onAbort, { once: true })
            resetIdle()
            const stream = new ReadableStream({
              async pull(targetController) {
                try {
                  assertSession(grant, init.sessionVersion)
                  const chunk = await reader.read()
                  assertSession(grant, init.sessionVersion)
                  if (chunk.done) {
                    clearTimeout(idle); controller.signal.removeEventListener('abort', onAbort); reader.releaseLock(); cleanup(); targetController.close(); return
                  }
                  bytes += chunk.value.byteLength
                  if (bytes > MAX_RESPONSE) throw failure('response_too_large', 502)
                  resetIdle(); targetController.enqueue(chunk.value)
                } catch (error) {
                  controller.signal.removeEventListener('abort', onAbort)
                  await finish(error).catch(() => {})
                  targetController.error(error instanceof EnterpriseAuthError ? error : failure('request_failed', 502))
                }
              },
              async cancel(reason) { controller.signal.removeEventListener('abort', onAbort); await finish(reason) }
            }, { highWaterMark: 0 })
            return new Response(stream, { status: upstream.status, headers })
          } catch (error) {
            cleanup()
            if (error instanceof EnterpriseAuthError) throw error
            if (controller.signal.aborted) throw controller.signal.reason
            throw failure('request_failed', 502)
          }
        }
      }
      grants.set(transport, grant)
      return transport
    },
    async revoke(transport) {
      const grant = grants.get(transport)
      if (!grant) return
      grant.active = false
      for (const controller of grant.controllers) controller.abort(failure('authorization_denied'))
      grants.delete(transport)
    },
    invalidate() {
      for (const grant of grants.values()) {
        grant.active = false
        for (const controller of grant.controllers) controller.abort(failure('session_changed', 409))
      }
      grants.clear()
    }
  }
}
