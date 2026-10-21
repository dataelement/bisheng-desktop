import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EnterpriseService } from './enterprise-service'
import { EnterpriseAuthError } from './enterprise-auth'

interface Grant {
  pluginId: string
  instanceId: string
  controllers: Set<AbortController>
}

type ReadBody = (request: IncomingMessage, limit: number) => Promise<unknown>
type SendJson = (response: ServerResponse, status: number, body: unknown) => void
const WIRE_LIMIT = 6 * 1024 * 1024
const MAX_GRANTS = 256
const MAX_IN_FLIGHT = 8

/** Only the trusted market owner can mint/revoke instance-scoped capabilities. */
export function createEnterpriseAuthBroker(service: EnterpriseService, readBody: ReadBody, sendJson: SendJson) {
  const grants = new Map<string, Grant>()
  const revoke = (key: string) => {
    const grant = grants.get(key)
    grants.delete(key)
    for (const controller of grant?.controllers ?? []) {
      controller.abort(new EnterpriseAuthError('authorization_denied', 403))
    }
  }
  return {
    revokeAll() {
      for (const key of grants.keys()) revoke(key)
    },
    async handle(request: IncomingMessage, response: ServerResponse, path: string, owner: boolean): Promise<void> {
      let controller: AbortController | undefined
      let grant: Grant | undefined
      let bodyTimer: ReturnType<typeof setTimeout> | undefined
      let abortUpload: (() => void) | undefined
      const abort = () => controller?.abort(new EnterpriseAuthError('request_aborted', 499))
      try {
        const expectedMethod = path === '/v1/auth/state' ? 'GET' : 'POST'
        if (!['/v1/auth/grant', '/v1/auth/revoke', '/v1/auth/state', '/v1/auth/request'].includes(path)) {
          throw new EnterpriseAuthError('invalid_request', 404)
        }
        if (request.method !== expectedMethod) throw new EnterpriseAuthError('invalid_request', 405)
        if (expectedMethod === 'POST' && request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
          throw new EnterpriseAuthError('invalid_request', 415)
        }
        if (path === '/v1/auth/grant' || path === '/v1/auth/revoke') {
          if (!owner) throw new EnterpriseAuthError('authorization_denied', 403)
          const body = await readBody(request, 4096)
          if (!isRecord(body)) throw new EnterpriseAuthError('invalid_request', 400)
          if (path === '/v1/auth/revoke') {
            if (Object.keys(body).length !== 1 || typeof body.capability !== 'string') throw new EnterpriseAuthError('invalid_request', 400)
            revoke(body.capability)
            sendJson(response, 200, { ok: true })
            return
          }
          if (Object.keys(body).length !== 2 || !validIdentity(body.pluginId) || !validIdentity(body.instanceId)) {
            throw new EnterpriseAuthError('invalid_request', 400)
          }
          if (grants.size >= MAX_GRANTS) throw new EnterpriseAuthError('too_many_requests', 429)
          // Duplicate instance ids may not mint parallel credentials.
          for (const existing of grants.values()) {
            if (existing.instanceId === body.instanceId) throw new EnterpriseAuthError('invalid_request', 409)
          }
          const key = randomBytes(32).toString('base64url')
          grants.set(key, { pluginId: body.pluginId, instanceId: body.instanceId, controllers: new Set() })
          sendJson(response, 200, { capability: key })
          return
        }
        const header = request.headers.authorization
        const key = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
        grant = grants.get(key)
        if (!grant) throw new EnterpriseAuthError('authorization_denied', 403)
        if (path === '/v1/auth/state') {
          sendJson(response, 200, service.authState())
          return
        }
        if (grant.controllers.size >= MAX_IN_FLIGHT) throw new EnterpriseAuthError('too_many_requests', 429)
        controller = new AbortController()
        grant.controllers.add(controller)
        request.once('aborted', abort)
        response.once('close', abort)
        abortUpload = () => request.destroy()
        controller.signal.addEventListener('abort', abortUpload, { once: true })
        bodyTimer = setTimeout(() => {
          controller?.abort(new EnterpriseAuthError('request_timeout', 504))
        }, 30_000)
        bodyTimer.unref?.()
        const body = await readBody(request, WIRE_LIMIT)
        clearTimeout(bodyTimer)
        controller.signal.removeEventListener('abort', abortUpload)
        if (grants.get(key) !== grant) throw new EnterpriseAuthError('authorization_denied', 403)
        const upstream = await service.authRequest({ pluginId: grant.pluginId, instanceId: grant.instanceId }, body, controller.signal)
        const assertCurrent = () => {
          controller?.signal.throwIfAborted()
          if (grants.get(key) !== grant) throw new EnterpriseAuthError('authorization_denied', 403)
          if (!isRecord(body) || body.sessionVersion !== service.authState().sessionVersion) throw new EnterpriseAuthError('session_changed', 409)
        }
        assertCurrent()
        const headers: Record<string, string> = { 'cache-control': 'no-store' }
        upstream.headers.forEach((value, name) => { if (name !== 'x-dsh-enterprise-error') headers[name] = value })
        response.writeHead(upstream.status, headers)
        response.flushHeaders()
        const reader = upstream.body?.getReader()
        // Stream invalidation must also interrupt a blocked downstream drain.
        void reader?.closed.catch(error => {
          controller?.abort(error)
          if (response.headersSent) response.destroy()
        })
        try {
          if (reader) while (true) {
            assertCurrent()
            const chunk = await reader.read()
            assertCurrent()
            if (chunk.done) break
            if (!response.write(chunk.value)) await waitForDrain(response, controller.signal)
          }
          assertCurrent()
          response.end()
        } finally {
          await reader?.cancel().catch(() => undefined) // Connection cleanup must not mask the transport error.
          reader?.releaseLock()
        }
      } catch (error) {
        if (response.headersSent) {
          response.destroy()
          return
        }
        const safe = error instanceof EnterpriseAuthError ? error : new EnterpriseAuthError('invalid_request', 400)
        response.setHeader('x-dsh-enterprise-error', safe.code)
        sendJson(response, safe.status, { errorCode: safe.code, error: safe.message })
      } finally {
        clearTimeout(bodyTimer)
        if (abortUpload) controller?.signal.removeEventListener('abort', abortUpload)
        request.off('aborted', abort)
        response.off('close', abort)
        if (controller) grant?.controllers.delete(controller)
      }
    }
  }
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9@._:/-]{1,200}$/u.test(value)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', done)
      response.off('close', cancelled)
      signal.removeEventListener('abort', cancelled)
    }
    const done = () => { cleanup(); resolve() }
    const cancelled = () => { cleanup(); reject(new EnterpriseAuthError('request_aborted', 499)) }
    response.once('drain', done)
    response.once('close', cancelled)
    signal.addEventListener('abort', cancelled, { once: true })
    if (signal.aborted || response.destroyed) cancelled()
  })
}
