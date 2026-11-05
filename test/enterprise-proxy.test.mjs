import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { createEnterpriseProxyHandler, PROXY_ROUTE_PREFIXES } from '../packages/dsh-desktop-enterprise/enterprise-proxy.js'

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

describe('Enterprise Proxy Middleware', () => {
  it('defines the required proxy prefix paths', () => {
    expect(PROXY_ROUTE_PREFIXES).toContain('/workspace')
    expect(PROXY_ROUTE_PREFIXES).toContain('/api/v1')
    expect(PROXY_ROUTE_PREFIXES).toContain('/api/auth')
    expect(PROXY_ROUTE_PREFIXES).toContain('/api/user')
  })

  it('proxies requests and injects access_token_cookie and Authorization', async () => {
    let capturedHeaders = null
    const upstream = await startMockUpstream((req, res) => {
      capturedHeaders = req.headers
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
        'set-cookie': 'some_session=abc; Domain=remote.example.com; Path=/'
      })
      res.end('<html><body>Workspace App</body></html>')
    })

    try {
      const mockAuth = {
        base: upstream.base,
        tokens: { access_token: 'mock-access-token-123' }
      }

      const handler = createEnterpriseProxyHandler({
        getSessionAuth: async () => mockAuth,
        refreshSessionTokens: async () => {}
      })

      const localServer = http.createServer(handler)
      await new Promise(res => localServer.listen(0, '127.0.0.1', res))
      const localPort = localServer.address().port

      try {
        const clientRes = await fetch(`http://127.0.0.1:${localPort}/workspace/knowledge?embed=dsh&dshLocale=zh`, {
          headers: {
            'x-custom-client': 'test-1'
          }
        })

        expect(clientRes.status).toBe(200)
        const text = await clientRes.text()
        expect(text).toContain('Workspace App')
        expect(text).toContain('dshChatPresentation')
        expect(text).toContain('dshHostLocale')
        expect(text).toContain('dsh:locale')

        // Verify injected headers on upstream
        expect(capturedHeaders['x-custom-client']).toBe('test-1')
        expect(capturedHeaders.authorization).toBe('Bearer mock-access-token-123')
        expect(capturedHeaders.cookie).toContain('access_token_cookie=mock-access-token-123')
        expect(capturedHeaders.cookie).toContain('umi_locale=zh-CN')
        expect(capturedHeaders['accept-language']).toContain('zh-CN')

        // Verify stripped headers on downstream
        expect(clientRes.headers.get('x-frame-options')).toBeNull()
        expect(clientRes.headers.get('content-security-policy')).toBeNull()

        // Verify cleaned set-cookie and seeded locale cookie
        const setCookie = clientRes.headers.get('set-cookie')
        expect(setCookie).toContain('some_session=abc')
        expect(setCookie).toContain('umi_locale=zh-CN')
        expect(setCookie?.toLowerCase()).not.toContain('domain=')
      } finally {
        await new Promise(res => localServer.close(res))
      }
    } finally {
      await upstream.close()
    }
  })

  it('automatically refreshes token and retries on 401', async () => {
    let attempts = 0
    let tokensUsed = []

    const upstream = await startMockUpstream((req, res) => {
      const auth = req.headers.authorization
      if (req.url.startsWith('/api/v1/dsh/web-session')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: 'web-cookie-for-' + (auth?.split(' ')[1] || 'none'), expires_in: 300 }))
        return
      }
      attempts++
      tokensUsed.push(auth)

      if (auth?.includes('initial-expired-token')) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Token expired' }))
        return
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, attempts }))
    })

    try {
      let currentToken = 'initial-expired-token'
      const handler = createEnterpriseProxyHandler({
        getSessionAuth: async () => ({
          base: upstream.base,
          tokens: { access_token: currentToken }
        }),
        refreshSessionTokens: async () => {
          currentToken = 'fresh-valid-token'
        }
      })

      const localServer = http.createServer(handler)
      await new Promise(res => localServer.listen(0, '127.0.0.1', res))
      const localPort = localServer.address().port

      try {
        const clientRes = await fetch(`http://127.0.0.1:${localPort}/api/v1/user/info`, {
          method: 'GET'
        })

        expect(clientRes.status).toBe(200)
        const data = await clientRes.json()
        expect(data.ok).toBe(true)
        expect(attempts).toBe(2)
        expect(tokensUsed).toEqual(['Bearer web-cookie-for-initial-expired-token', 'Bearer web-cookie-for-fresh-valid-token'])
      } finally {
        await new Promise(res => localServer.close(res))
      }
    } finally {
      await upstream.close()
    }
  })

  it('redirects /workspace to login when no session is active', async () => {
    const handler = createEnterpriseProxyHandler({
      getSessionAuth: async () => null,
      refreshSessionTokens: async () => {}
    })

    const localServer = http.createServer(handler)
    await new Promise(res => localServer.listen(0, '127.0.0.1', res))
    const localPort = localServer.address().port

    try {
      const clientRes = await fetch(`http://127.0.0.1:${localPort}/workspace/c/new`, {
        redirect: 'manual'
      })
      expect(clientRes.status).toBe(302)
      expect(clientRes.headers.get('location')).toContain('login=enterprise')

      const apiRes = await fetch(`http://127.0.0.1:${localPort}/api/v1/user/info`)
      expect(apiRes.status).toBe(401)
    } finally {
      await new Promise(res => localServer.close(res))
    }
  })
})
