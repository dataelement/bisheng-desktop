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
  constructor({ getSessionAuth, refreshSessionTokens, getBroker = () => undefined }) {
    this._getSessionAuth = getSessionAuth
    this._refreshSessionTokens = refreshSessionTokens
    this._getBroker = getBroker
    this._cachedWebCookie = null
    this._cachedExpiresAt = 0
    this._webCookiePromise = null
  }

  async getWebSessionCookie(forceFresh = false) {
    const now = Date.now()
    if (!forceFresh && this._cachedWebCookie && now < this._cachedExpiresAt - 30_000) {
      return this._cachedWebCookie
    }
    if (this._webCookiePromise) return this._webCookiePromise

    this._webCookiePromise = (async () => {
      try {
        const auth = await this._getSessionAuth()
        if (!auth?.base || !auth?.tokens?.access_token) {
          this._cachedWebCookie = null
          this._cachedExpiresAt = 0
          return null
        }
        const base = auth.base.replace(/\/+$/, '')
        const res = await fetch(`${base}/api/v1/dsh/web-session`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${auth.tokens.access_token}`,
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify({ redirect_to: '/workspace/c/new' })
        })
        if (!res.ok) {
          console.warn('[enterprise-client] failed to exchange web session cookie', res.status)
          return null
        }
        const data = await res.json().catch(() => null)
        if (data?.cookie) {
          this._cachedWebCookie = data.cookie
          const expiresIn = Number(data.expires_in) || 300
          this._cachedExpiresAt = Date.now() + expiresIn * 1000
          return this._cachedWebCookie
        }
        return null
      } catch (err) {
        console.warn('[enterprise-client] error during web session exchange', err)
        return null
      } finally {
        this._webCookiePromise = null
      }
    })()

    return this._webCookiePromise
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

    const execute = async (sessionAuth, isRetry = false) => {
      const base = sessionAuth.base.replace(/\/+$/, '')
      const targetUrl = new URL(path, base)

      // Get web session cookie (double guarantee)
      const webCookie = await this.getWebSessionCookie(isRetry)
      const activeToken = webCookie || sessionAuth.tokens.access_token

      const reqHeaders = { ...headers }
      // Merge cookies
      const existingCookie = reqHeaders.cookie || reqHeaders.Cookie || ''
      const parts = existingCookie
        .split(';')
        .map(p => p.trim())
        .filter(p => p && !p.startsWith('access_token_cookie='))
      parts.push(`access_token_cookie=${activeToken}`)
      reqHeaders.cookie = parts.join('; ')

      // Ensure Authorization header
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

      // Handle 401 auto-retry
      if (response.status === 401 && !isRetry) {
        console.info('[enterprise-client] received 401, attempting token & cookie refresh...')
        try {
          // 1. Refresh web session cookie first
          const newCookie = await this.getWebSessionCookie(true)
          if (newCookie && newCookie !== webCookie) {
            return execute(sessionAuth, true)
          }
          // 2. Refresh OAuth tokens
          if (typeof this._refreshSessionTokens === 'function') {
            await this._refreshSessionTokens()
            const freshAuth = await this._getSessionAuth()
            if (freshAuth?.tokens?.access_token) {
              return execute(freshAuth, true)
            }
          }
        } catch (refreshErr) {
          console.warn('[enterprise-client] refresh on 401 failed', refreshErr)
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
      const res = await fetch(new URL('/v1/work-tools', broker.origin), {
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
