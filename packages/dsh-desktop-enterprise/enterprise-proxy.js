import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { EnterpriseClient } from './enterprise-client.js'

export const PROXY_ROUTE_PREFIXES = Object.freeze([
  '/workspace',
  '/api/v1',
  '/api/auth',
  '/api/user',
  '/api/files',
  '/api/share',
  '/api/keys',
  '/api/agents',
  '/api/assistants',
  '/api/messages'
])

const STRIP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only'
])

function cleanCookieHeader(cookieValue) {
  if (!cookieValue) return cookieValue
  // Strip remote domain attribute so cookies bind to local origin (3080)
  return cookieValue.replace(/;\s*Domain=[^;]+/gi, '')
}

export function createEnterpriseProxyHandler({ getSessionAuth, refreshSessionTokens, enterpriseClient }) {
  const client = enterpriseClient || new EnterpriseClient({ getSessionAuth, refreshSessionTokens })

  return async function handleEnterpriseProxy(req, res) {
    let auth = null
    try {
      auth = await client._getSessionAuth()
    } catch (err) {
      console.warn('[enterprise-proxy] failed to obtain session auth', err)
    }

    if (!auth?.base || !auth?.tokens?.access_token) {
      if (req.method === 'GET' && req.url.startsWith('/workspace')) {
        res.writeHead(302, {
          location: '/?login=enterprise',
          'cache-control': 'no-store'
        })
        res.end()
        return
      }
      res.writeHead(401, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end(JSON.stringify({ error: 'Enterprise session not available or expired.' }))
      return
    }

    // Buffer the request body for possible 401 retry
    let bodyBuffer = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const chunks = []
        for await (const chunk of req) {
          chunks.push(chunk)
        }
        bodyBuffer = Buffer.concat(chunks)
      } catch (err) {
        console.warn('[enterprise-proxy] failed to read request body', err)
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to read request body.' }))
        return
      }
    }

    const forward = async (sessionAuth, isRetry = false) => {
      const targetBase = sessionAuth.base.replace(/\/+$/, '')
      const targetUrl = new URL(req.url, targetBase)
      const isHttps = targetUrl.protocol === 'https:'
      const httpClient = isHttps ? https : http

      const outgoingHeaders = { ...req.headers }
      delete outgoingHeaders.host
      delete outgoingHeaders.connection
      delete outgoingHeaders['content-length']

      // Obtain web session cookie from unified client
      const webCookie = await client.getWebSessionCookie(isRetry)
      const activeToken = webCookie || sessionAuth.tokens.access_token

      const existingCookie = outgoingHeaders.cookie || ''
      const cookieParts = existingCookie
        .split(';')
        .map(p => p.trim())
        .filter(p => p && !p.startsWith('access_token_cookie='))
      cookieParts.push(`access_token_cookie=${activeToken}`)
      const dshLocale = targetUrl.searchParams.get('dshLocale')
      if (dshLocale === 'zh') {
        outgoingHeaders['accept-language'] = 'zh-CN,zh;q=0.9,en;q=0.8'
        if (!cookieParts.some(p => p.startsWith('umi_locale='))) {
          cookieParts.push('umi_locale=zh-CN')
        }
      } else if (dshLocale === 'en') {
        outgoingHeaders['accept-language'] = 'en-US,en;q=0.9'
        if (!cookieParts.some(p => p.startsWith('umi_locale='))) {
          cookieParts.push('umi_locale=en-US')
        }
      }
      outgoingHeaders.cookie = cookieParts.join('; ')

      // Inject Bearer Authorization header if not already present
      if (!outgoingHeaders.authorization) {
        outgoingHeaders.authorization = `Bearer ${activeToken}`
      }

      outgoingHeaders.host = targetUrl.host

      if (req.method === 'GET' && req.url.startsWith('/workspace')) {
        outgoingHeaders['accept-encoding'] = 'identity'
      }

      if (bodyBuffer) {
        outgoingHeaders['content-length'] = String(bodyBuffer.length)
      }

      const proxyReq = httpClient.request(targetUrl, {
        method: req.method,
        headers: outgoingHeaders,
        rejectUnauthorized: false
      })

      proxyReq.on('error', (err) => {
        console.warn('[enterprise-proxy] request error to target', targetUrl.href, err)
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: `Proxy upstream connect failure: ${err.message}` }))
        }
      })

      if (bodyBuffer && bodyBuffer.length > 0) {
        proxyReq.write(bodyBuffer)
      }
      proxyReq.end()

      proxyReq.on('response', async (proxyRes) => {
        // If 401 and we haven't retried yet, refresh web session or OAuth tokens
        if (proxyRes.statusCode === 401 && !isRetry) {
          console.info('[enterprise-proxy] received 401, refreshing web session / token...')
          proxyRes.resume()
          try {
            // First attempt: force new web session cookie
            const newWebCookie = await client.getWebSessionCookie(true)
            if (newWebCookie && newWebCookie !== webCookie) {
              return forward(sessionAuth, true)
            }
            // Second attempt: refresh OAuth session tokens
            if (typeof client._refreshSessionTokens === 'function') {
              await client._refreshSessionTokens()
              const freshAuth = await client._getSessionAuth()
              if (freshAuth?.tokens?.access_token) {
                return forward(freshAuth, true)
              }
            }
          } catch (refreshErr) {
            console.warn('[enterprise-proxy] refresh on 401 failed', refreshErr)
          }
        }

        const resHeaders = {}
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          const lowerKey = key.toLowerCase()
          if (STRIP_RESPONSE_HEADERS.has(lowerKey)) {
            continue
          }
          if (lowerKey === 'set-cookie') {
            if (Array.isArray(value)) {
              resHeaders[key] = value.map(cleanCookieHeader)
            } else if (typeof value === 'string') {
              resHeaders[key] = cleanCookieHeader(value)
            }
            continue
          }
          resHeaders[key] = value
        }

        // Also seed access_token_cookie and umi_locale to the local browser on page loads
        if (req.method === 'GET' && req.url.startsWith('/workspace')) {
          const cookieLang = (targetUrl.searchParams.get('dshLocale') === 'en') ? 'en-US' : 'zh-CN'
          const langCookie = `umi_locale=${cookieLang}; Path=/; SameSite=Lax`
          const cookiesToAdd = [langCookie]
          if (webCookie) cookiesToAdd.push(`access_token_cookie=${webCookie}; Path=/; SameSite=Lax`)
          const existingSetCookie = resHeaders['set-cookie']
          const currentCookies = Array.isArray(existingSetCookie) ? existingSetCookie : (existingSetCookie ? [existingSetCookie] : [])
          resHeaders['set-cookie'] = [...currentCookies, ...cookiesToAdd]
        }

        const isHtml = (proxyRes.headers['content-type'] || '').toLowerCase().includes('text/html')
        if (isHtml && (proxyRes.statusCode === 200 || !proxyRes.statusCode)) {
          const chunks = []
          proxyRes.on('data', chunk => chunks.push(chunk))
          proxyRes.on('end', () => {
            const rawHtml = Buffer.concat(chunks).toString('utf8')
            const shim = `<script>(function(){try{var p=new URLSearchParams(window.location.search);var l=p.get('dshLocale')||(document.documentElement.lang&&document.documentElement.lang.startsWith('zh')?'zh':'zh');document.documentElement.dataset.dshHostLocale=l;window.dispatchEvent(new CustomEvent('dsh:locale',{detail:{locale:l}}));}catch(e){}window.addEventListener('message',function(ev){if((ev.data?.channel==='dsh:locale'||ev.data?.type==='dsh:locale')&&ev.data?.locale){try{document.documentElement.dataset.dshHostLocale=ev.data.locale;window.dispatchEvent(new CustomEvent('dsh:locale',{detail:{locale:ev.data.locale}}));}catch(err){}}});if(window.dshChatPresentation)return;window.dshChatPresentation={reportNavigation:function(n){try{window.parent.postMessage({channel:'enterprise-chat:navigation',navigation:n},'*');}catch(e){}},reportLanding:function(l){try{window.parent.postMessage({channel:'enterprise-chat:landing',landing:l},'*');}catch(e){}}};})();</script>`
            let modified
            if (rawHtml.includes('<head>')) {
              modified = rawHtml.replace('<head>', `<head>${shim}`)
            } else if (/<head[^>]*>/i.test(rawHtml)) {
              modified = rawHtml.replace(/<head[^>]*>/i, `$&${shim}`)
            } else if (/<html[^>]*>/i.test(rawHtml)) {
              modified = rawHtml.replace(/<html[^>]*>/i, `$&<head>${shim}</head>`)
            } else {
              modified = `${shim}${rawHtml}`
            }
            delete resHeaders['content-length']
            delete resHeaders['transfer-encoding']
            resHeaders['content-length'] = Buffer.byteLength(modified)
            res.writeHead(proxyRes.statusCode || 200, proxyRes.statusMessage, resHeaders)
            res.end(modified)
          })
          return
        }

        res.writeHead(proxyRes.statusCode || 200, proxyRes.statusMessage, resHeaders)
        proxyRes.pipe(res)
      })
    }

    await forward(auth)
  }
}
