import { observeRequestResponse } from './request-status.js'

export class EnterpriseAuthError extends Error {
  constructor(errorCode, message, status = 503) {
    super(message)
    this.name = 'EnterpriseAuthError'
    this.errorCode = errorCode
    this.status = status
  }
}

export function enterpriseAuthState(value) {
  if (!value || typeof value.connected !== 'boolean' || typeof value.sessionVersion !== 'string') {
    throw new EnterpriseAuthError('request_failed', 'Invalid enterprise authentication state.')
  }
  return Object.freeze({
    connected: value.connected,
    ...(typeof value.enterpriseId === 'string' ? { enterpriseId: value.enterpriseId } : {}),
    ...(typeof value.userId === 'string' ? { userId: value.userId } : {}),
    sessionVersion: value.sessionVersion
  })
}

/** A host-authorized transport is the only identity source. Never starts SSO or exposes tokens. */
export async function createEnterpriseAuthClient(transport, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new EnterpriseAuthError('invalid_request', 'Invalid authentication polling interval.', 400)
  }
  const lifetime = new AbortController()
  let state = enterpriseAuthState(await transport.state(lifetime.signal))
  let active = true, refreshing, requestRevision = 0
  let session = new AbortController()
  const listeners = new Set()
  const revoked = () => new EnterpriseAuthError('authorization_denied', 'This plugin instance was revoked.', 403)
  const assertActive = () => { if (!active) throw revoked() }
  const update = value => {
    if (!active) return
    const next = enterpriseAuthState(value)
    const changed = ['connected', 'enterpriseId', 'userId', 'sessionVersion'].some(key => next[key] !== state[key])
    if (!changed) return
    state = next
    // Cancel work belonging to an old user/session, including after a failed state read.
    session.abort(new EnterpriseAuthError('session_changed', 'Enterprise session changed.', 409))
    session = new AbortController()
    for (const listener of [...listeners]) {
      if (!active) break
      try { listener({ ...state }) }
      catch { console.warn('[enterprise-auth] state listener failed') }
    }
  }
  const refresh = () => {
    assertActive()
    return refreshing ??= Promise.resolve().then(async () => {
      try {
        const next = await transport.state(lifetime.signal)
        assertActive()
        update(next)
        return { ...state }
      } catch (error) {
        if (active) update({ connected: false, sessionVersion: state.sessionVersion })
        throw error
      } finally { refreshing = undefined }
    })
  }
  const timer = pollIntervalMs ? setInterval(() => { void refresh().catch(() => undefined) }, pollIntervalMs) : undefined
  timer?.unref?.()
  return {
    getState() { assertActive(); return { ...state } },
    async refresh() { return refresh() },
    subscribe(listener) {
      assertActive()
      if (typeof listener !== 'function') throw new EnterpriseAuthError('invalid_request', 'A state listener is required.', 400)
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async request(path, init = {}) {
      assertActive()
      const signals = [lifetime.signal, session.signal, ...(init.signal ? [init.signal] : [])]
      const signal = AbortSignal.any(signals)
      if (signal.aborted) throw signal.reason
      const revision = ++requestRevision
      const settle = error => {
        if (active && !signal.aborted && revision === requestRevision) options.onRequestSettled?.(error)
      }
      try {
        const response = await transport.request(path, { ...init, signal, sessionVersion: state.sessionVersion })
        if (signal.aborted) {
          await response.body?.cancel(signal.reason).catch(() => undefined)
          throw signal.reason
        }
        return options.onRequestSettled ? observeRequestResponse(response, signal, settle) : response
      } catch (error) {
        settle(error)
        throw error
      } finally {
        // Background reads fail closed; explicit refresh() preserves the original error for callers.
        if (active) void refresh().catch(() => undefined)
      }
    },
    dispose() {
      if (!active) return
      active = false
      clearInterval(timer)
      listeners.clear()
      lifetime.abort(revoked())
    }
  }
}
