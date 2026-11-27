import { URL } from 'node:url'

export class EnterpriseHttpError extends Error {
  constructor(message, { status = 500, code = 'ENTERPRISE_HTTP_ERROR', cause = null } = {}) {
    super(message)
    this.name = 'EnterpriseHttpError'
    this.status = status
    this.code = code
    if (cause) this.cause = cause
  }
}

export class EnterpriseClient {
  constructor({ getSessionAuth, refreshSessionTokens, refreshAfter401, getBroker = () => undefined }) {
    this._getSessionAuth = getSessionAuth
    this._refreshSessionTokens = refreshSessionTokens
    this._refreshAfter401 = refreshAfter401
    this._getBroker = getBroker
    this._cachedWebCookie = null
    this._cachedExpiresAt = 0
    this._webCookiePromise = null
    this._webCookieKey = null
    this._refreshPromise = null
  }

  _sameSession(a, b) {
    if (!a?.base || !b?.base || a.base.replace(/\/+$/, '') !== b.base.replace(/\/+$/, '')) return false
    for (const [left, right] of [[a.user?.id, b.user?.id], [a.tenant?.id, b.tenant?.id], [a.tokens?.session_id, b.tokens?.session_id]]) {
      if ((left != null || right != null) && left !== right) return false
    }
    return true
  }

  async getWebSessionCookie(forceFresh = false, sessionAuth) {
    const auth = sessionAuth || await this._getSessionAuth()
    if (!auth?.base || !auth?.tokens?.access_token) return null
    const key = JSON.stringify([auth.base, auth.user?.id, auth.tenant?.id, auth.tokens?.session_id, auth.tokens.access_token])
    if (!forceFresh && this._webCookieKey === key && this._cachedWebCookie && Date.now() < this._cachedExpiresAt - 30_000) return this._cachedWebCookie
    if (this._webCookiePromise?.key === key) return this._webCookiePromise.promise

    const promise = (async () => {
      try {
        const res = await fetch(`${auth.base.replace(/\/+$/, '')}/api/v1/dsh/web-session`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ redirect_to: '/workspace/c/new' })
        })
        if (!res.ok) {
          await res.body?.cancel().catch(() => {})
          console.warn('[enterprise-client] failed to exchange web session cookie', res.status)
          return null
        }
        const data = await res.json().catch(() => null)
        const current = await this._getSessionAuth()
        if (!this._sameSession(auth, current) || current.tokens?.access_token !== auth.tokens.access_token) return null
        if (data?.cookie) {
          this._webCookieKey = key
          this._cachedWebCookie = data.cookie
          this._cachedExpiresAt = Date.now() + (Number(data.expires_in) || 300) * 1000
          return data.cookie
        }
        return null
      } catch (err) {
        console.warn('[enterprise-client] error during web session exchange', err)
        return null
      }
    })()
    this._webCookiePromise = { key, promise }
    try { return await promise } finally {
      if (this._webCookiePromise?.promise === promise) this._webCookiePromise = null
    }
  }

  async refreshAfter401(auth) {
    const token = auth?.tokens?.access_token
    const current = await this._getSessionAuth()
    if (!token || !this._sameSession(auth, current) || !current.tokens?.access_token) return null
    if (current.tokens.access_token !== token) return current
    if (typeof this._refreshAfter401 !== 'function' && typeof this._refreshSessionTokens !== 'function') return null
    if (!this._refreshPromise || !this._sameSession(this._refreshPromise.auth, auth) || this._refreshPromise.token !== token) {
      const promise = (async () => {
        if (typeof this._refreshAfter401 === 'function') await this._refreshAfter401(token)
        else await this._refreshSessionTokens()
        return this._getSessionAuth()
      })()
      this._refreshPromise = { auth, token, promise }
      promise.finally(() => {
        if (this._refreshPromise?.promise === promise) this._refreshPromise = null
      }).catch(() => {})
    }
    const fresh = await this._refreshPromise.promise
    return this._sameSession(auth, fresh) && fresh?.tokens?.access_token && fresh.tokens.access_token !== token ? fresh : null
  }

  async request(path, options = {}) {
    const auth = await this._getSessionAuth()
    if (!auth?.base || !auth?.tokens?.access_token) {
      throw new EnterpriseHttpError('Enterprise session not available or expired.', { status: 401, code: 'UNAUTHORIZED' })
    }

    const {
      method = 'GET',
      headers = {},
      body,
      signal,
      binary = false,
      timeoutMs = 60_000
    } = options

    const execute = async (sessionAuth, isRetry = false, failedCredential = null) => {
      const base = sessionAuth.base.replace(/\/+$/, '')
      const targetUrl = new URL(path, base)

      // Get web session cookie (double guarantee)
      const webCookie = await this.getWebSessionCookie(isRetry, sessionAuth)
      const current = await this._getSessionAuth()
      if (!this._sameSession(sessionAuth, current) || current?.tokens?.access_token !== sessionAuth.tokens.access_token) {
        throw new EnterpriseHttpError('Enterprise session changed.', { status: 409, code: 'SESSION_CHANGED' })
      }
      const activeToken = (isRetry && webCookie === failedCredential ? null : webCookie) || sessionAuth.tokens.access_token
      if (isRetry && activeToken === failedCredential) {
        throw new EnterpriseHttpError('Enterprise session refresh failed.', { status: 401, code: 'UNAUTHORIZED' })
      }

      const reqHeaders = { ...headers }
      // Merge cookies
      const existingCookie = reqHeaders.cookie || reqHeaders.Cookie || ''
      const parts = existingCookie
        .split(';')
        .map(p => p.trim())
        .filter(p => p && !p.startsWith('access_token_cookie='))
      parts.push(`access_token_cookie=${activeToken}`)
      reqHeaders.cookie = parts.join('; ')

      // Replace caller credentials on replay so the failed token is never reused.
      if (isRetry) {
        delete reqHeaders.authorization
        delete reqHeaders.Authorization
      }
      if (!reqHeaders.authorization && !reqHeaders.Authorization) {
        reqHeaders.authorization = `Bearer ${activeToken}`
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

      let response
      try {
        response = await fetch(targetUrl.href, {
          method,
          headers: reqHeaders,
          ...(body === undefined ? {} : { body: typeof body === 'object' && !(body instanceof Buffer) ? JSON.stringify(body) : body }),
          signal: combinedSignal
        })
      } catch (err) {
        if (signal?.aborted) throw err
        throw new EnterpriseHttpError(`Enterprise request failed: ${err.message}`, { status: 502, code: 'NETWORK_ERROR', cause: err })
      }

      if (response.status === 401 && !isRetry) {
        let freshAuth
        try {
          freshAuth = await this.refreshAfter401(sessionAuth)
        } catch (refreshErr) {
          console.warn('[enterprise-client] refresh on 401 failed', refreshErr)
        }
        if (freshAuth) {
          // This response is discarded when the request is replayed.
          await response.body?.cancel().catch(() => {})
          return execute(freshAuth, true, activeToken)
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const message = errorBody?.detail || errorBody?.error?.message || errorBody?.error || `Enterprise request failed (${response.status})`
        const code = errorBody?.errorCode || errorBody?.code || (response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'API_ERROR')
        throw new EnterpriseHttpError(message, { status: response.status, code })
      }

      return binary ? Buffer.from(await response.arrayBuffer()) : response
    }

    return execute(auth)
  }

  async requestJson(path, options = {}) {
    const response = await this.request(path, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined && typeof options.body === 'object' ? { 'content-type': 'application/json' } : {}),
        ...options.headers
      }
    })
    return response.json().catch(() => ({}))
  }

  // Fallback for work resources (Knowledge Spaces) in Web mode
  async handleWorkResources(body, signal) {
    const broker = this._getBroker()
    if (broker) {
      const res = await fetch(new URL('/v1/work-resources', broker.origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new EnterpriseHttpError(`Broker work-resources failed (${res.status})`, { status: res.status })
      return res.json()
    }

    // Direct Web mode execution
    if (body?.operation === 'retrieve') {
      return this.requestJson('/api/v1/knowledge/space/retrieve', {
        method: 'POST',
        body: { query: body.query, space_ids: body.spaceIds },
        signal
      })
    }

    // Catalog query: aggregate department, mine, joined
    const spaces = []
    const seen = new Set()
    for (const group of ['department', 'mine', 'joined']) {
      try {
        const res = await this.requestJson(`/api/v1/knowledge/space/${group}`, { signal })
        const list = Array.isArray(res?.data) ? res.data : []
        for (const item of list) {
          const id = Number(item.id || item.space_id)
          if (!id || seen.has(id)) continue
          seen.add(id)
          spaces.push({
            id,
            name: String(item.name || item.space_name || '').slice(0, 200),
            description: String(item.description || '').slice(0, 1000),
            group,
            updatedAt: String(item.update_time || item.create_time || '').slice(0, 50)
          })
        }
      } catch (err) {
        console.warn(`[enterprise-client] failed to list knowledge spaces for group: ${group}`, err.message)
      }
    }
    return { spaces }
  }

  // Fallback for work skills in Web mode
  async handleWorkSkills(body, signal) {
    const broker = this._getBroker()
    if (broker) {
      const res = await fetch(new URL('/v1/work-skills', broker.origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new EnterpriseHttpError(`Broker work-skills failed (${res.status})`, { status: res.status })
      const isBinary = body?.operation === 'bundle'
      return isBinary ? Buffer.from(await res.arrayBuffer()) : res.json()
    }

    // Direct Web mode execution
    if (body?.operation === 'bundle') {
      const path = `/api/v1/linsight/skill/runtime/${encodeURIComponent(body.id)}/bundle?version=${encodeURIComponent(body.version || 'latest')}`
      return this.request(path, { binary: true, signal })
    }

    if (body?.operation === 'dependencies') {
      const path = `/api/v1/dsh/work/skills/${encodeURIComponent(body.id)}/dependencies?version=${encodeURIComponent(body.version || 'latest')}`
      const res = await this.requestJson(path, { signal })
      return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
    }

    const res = await this.requestJson('/api/v1/linsight/skill/runtime/catalog', { signal })
    return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
  }

  // Fallback for work capabilities (tools/MCP) in Web mode
  async handleWorkCapabilities(body, signal) {
    const broker = this._getBroker()
    if (broker) {
      const res = await fetch(new URL('/v1/work-mcp', broker.origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw new EnterpriseHttpError(`Broker work-tools failed (${res.status})`, { status: res.status })
      return res.json()
    }

    // Direct Web mode execution
    return this.requestJson('/api/v1/dsh/work/capabilities', { method: 'POST', body, signal })
  }
}