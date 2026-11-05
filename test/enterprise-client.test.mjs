import { describe, it, expect } from 'vitest'
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

