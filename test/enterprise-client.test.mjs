import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import { EnterpriseClient, EnterpriseHttpError } from '../packages/dsh-desktop-enterprise/enterprise-client.js'

function startMockUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise(res => server.close(res))
      })
    })
  })
}

describe('Enterprise Unified Client', () => {
  it('automatically fetches and caches web session cookie', async () => {
    let webSessionCalls = 0
    const upstream = await startMockUpstream((req, res) => {
      if (req.url === '/api/v1/dsh/web-session') {
        webSessionCalls++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: 'mock-web-cookie-1', expires_in: 300 }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    try {
      const client = new EnterpriseClient({
        getSessionAuth: async () => ({ base: upstream.base, tokens: { access_token: 'auth-1' } }),
        refreshSessionTokens: async () => { }
      })

      const c1 = await client.getWebSessionCookie()
      expect(c1).toBe('mock-web-cookie-1')
      expect(webSessionCalls).toBe(1)

      // Cached call
      const c2 = await client.getWebSessionCookie()
      expect(c2).toBe('mock-web-cookie-1')
      expect(webSessionCalls).toBe(1)

      // Force fresh
      const c3 = await client.getWebSessionCookie(true)
      expect(c3).toBe('mock-web-cookie-1')
      expect(webSessionCalls).toBe(2)
    } finally {
      await upstream.close()
    }
  })

  it('injects both Bearer Authorization and access_token_cookie into outbound requests', async () => {
    let capturedHeaders = null
    const upstream = await startMockUpstream((req, res) => {
      if (req.url === '/api/v1/dsh/web-session') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: 'web-session-jwt-123', expires_in: 300 }))
        return
      }
      if (req.url === '/api/v1/chat/list') {
        capturedHeaders = req.headers
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ chat_id: 'c-1', name: 'Test Chat' }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    try {
      const client = new EnterpriseClient({
        getSessionAuth: async () => ({ base: upstream.base, tokens: { access_token: 'oauth-token-xyz' } }),
        refreshSessionTokens: async () => { }
      })

      const result = await client.requestJson('/api/v1/chat/list')
      expect(result.data).toHaveLength(1)
      expect(capturedHeaders.authorization).toBe('Bearer web-session-jwt-123')
      expect(capturedHeaders.cookie).toContain('access_token_cookie=web-session-jwt-123')
    } finally {
      await upstream.close()
    }
  })

  it('preserves HTTP status fidelity on failure (401, 403, 404)', async () => {
    const upstream = await startMockUpstream((req, res) => {
      if (req.url === '/api/v1/dsh/web-session') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: 'web-token', expires_in: 300 }))
        return
      }
      if (req.url === '/api/v1/forbidden-resource') {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Access denied to tenant.' }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'Not found.' }))
    })

    try {
      const client = new EnterpriseClient({
        getSessionAuth: async () => ({ base: upstream.base, tokens: { access_token: 'auth' } }),
        refreshSessionTokens: async () => { }
      })

      await expect(client.requestJson('/api/v1/forbidden-resource')).rejects.toMatchObject({
        name: 'EnterpriseHttpError',
        status: 403,
        code: 'FORBIDDEN',
        message: 'Access denied to tenant.'
      })
    } finally {
      await upstream.close()
    }
  })

  it('handles work-resources directly in Web mode when broker is absent', async () => {
    const upstream = await startMockUpstream((req, res) => {
      if (req.url === '/api/v1/dsh/web-session') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: 'web-token', expires_in: 300 }))
        return
      }
      if (req.url === '/api/v1/knowledge/space/department') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 101, name: 'Dept Knowledge', description: 'Docs' }] }))
        return
      }
      if (req.url === '/api/v1/knowledge/space/mine') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 102, name: 'My Knowledge', description: 'Personal' }] }))
        return
      }
      if (req.url === '/api/v1/knowledge/space/joined') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [] }))
        return
      }
      if (req.url === '/api/v1/knowledge/space/retrieve') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ chunks: [{ text: 'Answer chunk' }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    try {
      const client = new EnterpriseClient({
        getSessionAuth: async () => ({ base: upstream.base, tokens: { access_token: 'auth' } }),
        refreshSessionTokens: async () => { }
      })

      // Catalog query
      const catalog = await client.handleWorkResources({ operation: 'catalog' })
      expect(catalog.spaces).toHaveLength(2)
      expect(catalog.spaces[0].name).toBe('Dept Knowledge')
      expect(catalog.spaces[1].name).toBe('My Knowledge')

      // Retrieve query
      const retrieve = await client.handleWorkResources({ operation: 'retrieve', query: 'test', spaceIds: [101] })
      expect(retrieve.chunks).toHaveLength(1)
    } finally {
      await upstream.close()
    }
  })
})

describe('Enterprise client 401 refresh', () => {
  const session = (token, user = 'one') => ({ base: 'https://enterprise.test', user: { id: user }, tenant: { id: 'tenant' }, tokens: { access_token: token, session_id: 'session' } })

  it('replays a POST once using new credentials and releases the first response', async () => {
    let auth = session('old')
    let cancelled = false
    const calls = []
    const fetchMock = vi.fn(async (url, options) => {
      if (url.endsWith('/web-session')) return Response.json({ cookie: auth.tokens.access_token + '-cookie' })
      calls.push(options)
      if (calls.length === 1) return new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 401 })
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new EnterpriseClient({ getSessionAuth: async () => auth, refreshSessionTokens: async () => { auth = session('new') } })
      expect(await client.requestJson('/post', { method: 'POST', body: { value: 1 }, headers: { Authorization: 'Bearer old' } })).toEqual({ ok: true })
      expect(calls).toHaveLength(2)
      expect(calls.map(call => call.body)).toEqual(['{"value":1}', '{"value":1}'])
      expect(calls[1].headers.authorization).toBe('Bearer new-cookie')
      expect(calls[1].headers.Authorization).toBeUndefined()
      expect(cancelled).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('propagates the retry response rather than the initial 401', async () => {
    let auth = session('old')
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url.endsWith('/web-session')) return Response.json({ cookie: auth.tokens.access_token })
      attempts++
      return Response.json({ detail: attempts === 1 ? 'expired' : 'forbidden' }, { status: attempts === 1 ? 401 : 403 })
    }))
    try {
      const client = new EnterpriseClient({ getSessionAuth: async () => auth, refreshSessionTokens: async () => { auth = session('new') } })
      await expect(client.request('/post', { method: 'POST', body: 'x' })).rejects.toMatchObject({ status: 403, message: 'forbidden' })
      expect(attempts).toBe(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('does not retry when refresh leaves the same token or switches account', async () => {
    for (const next of [session('old'), session('new', 'two')]) {
      let auth = session('old')
      let requests = 0
      vi.stubGlobal('fetch', vi.fn(async url => {
        if (url.endsWith('/web-session')) return Response.json({ cookie: 'cookie' })
        requests++
        return Response.json({ detail: 'denied' }, { status: 401 })
      }))
      try {
        const client = new EnterpriseClient({ getSessionAuth: async () => auth, refreshSessionTokens: async () => { auth = next } })
        await expect(client.request('/post', { method: 'POST', body: 'x' })).rejects.toMatchObject({ status: 401 })
        expect(requests).toBe(1)
      } finally { vi.unstubAllGlobals() }
    }
  })

  it('passes the failed token to an injected refresh callback', async () => {
    let auth = session('old')
    const refresh = vi.fn(async token => { expect(token).toBe('old'); auth = session('new') })
    const fallback = vi.fn()
    const client = new EnterpriseClient({ getSessionAuth: async () => auth, refreshAfter401: refresh, refreshSessionTokens: fallback })
    expect((await client.refreshAfter401(auth)).tokens.access_token).toBe('new')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not reuse a web cookie across accounts', async () => {
    let auth = session('one-token')
    const exchange = vi.fn(async (_url, options) => Response.json({ cookie: options.headers.authorization }))
    vi.stubGlobal('fetch', exchange)
    try {
      const client = new EnterpriseClient({ getSessionAuth: async () => auth })
      expect(await client.getWebSessionCookie()).toBe('Bearer one-token')
      auth = session('two-token', 'two')
      expect(await client.getWebSessionCookie()).toBe('Bearer two-token')
      expect(exchange).toHaveBeenCalledTimes(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('shares concurrent refresh and reuses the new token for a delayed 401', async () => {
    let auth = session('old')
    let count = 0
    let release
    const gate = new Promise(resolve => { release = resolve })
    const client = new EnterpriseClient({ getSessionAuth: async () => auth, refreshSessionTokens: async () => { count++; await gate; auth = session('new') } })
    const old = auth
    const first = client.refreshAfter401(old)
    const second = client.refreshAfter401(old)
    await Promise.resolve()
    release()
    expect((await first).tokens.access_token).toBe('new')
    expect((await second).tokens.access_token).toBe('new')
    expect((await client.refreshAfter401(old)).tokens.access_token).toBe('new')
    expect(count).toBe(1)
  })
})
