import { isIP } from 'node:net'
import { EnterpriseAuthError } from './enterprise-auth-client.js'
import { validateEnterpriseAppId } from './enterprise-apps-contract.js'

export { validateEnterpriseAppId, assertEnterprisePublicRequestPath } from './enterprise-apps-contract.js'

const MAX_RESPONSE_BYTES = 64 * 1024
const TIMEOUT_MS = 15_000

function failure(code = 'request_failed', status = 502) {
  return new EnterpriseAuthError(code, 'Enterprise application request failed (' + code + ').', status)
}

// Check before WHATWG URL parsing, which normalizes literal and encoded dot segments.
function relativePath(value) {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('/') || value.startsWith('//') ||
      /[\\#\s\x00-\x1f\x7f]/u.test(value) || /%0[ad]|%5c/iu.test(value)) throw failure('invalid_request', 400)
  const pathname = value.split('?')[0]
  for (const segment of pathname.split('/')) {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { throw failure('invalid_request', 400) }
    // Nested encodings and encoded separators must not change the destination at a proxy.
    if (decoded === '.' || decoded === '..' || /[%/\\\x00-\x20\x7f]/u.test(decoded)) throw failure('invalid_request', 400)
  }
  return value
}

function trustedBase(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//iu.test(value) || /[\\\s\x00-\x1f\x7f]/u.test(value)) throw failure()
  let url
  try { url = new URL(value) } catch { throw failure() }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[?#]/u.test(value)) throw failure()
  // Validate the source spelling too: URL parsing can erase a traversal segment.
  const authorityStart = value.indexOf('://') + 3
  const pathStart = value.indexOf('/', authorityStart)
  const authority = value.slice(authorityStart, pathStart < 0 ? undefined : pathStart)
  if (!authority || authority.includes('@')) throw failure()
  const rawPath = pathStart < 0 ? '/' : value.slice(pathStart)
  try { relativePath(rawPath) } catch { throw failure() }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase().replace(/\.$/u, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata' ||
      hostname === 'metadata.google.internal' || hostname.endsWith('.metadata.google.internal')) throw failure()
  if (isIP(hostname) === 4) {
    const octets = hostname.split('.').map(Number)
    if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224 ||
        octets[0] === 169 && octets[1] === 254 || hostname === '100.100.100.200') throw failure()
  }
  if (isIP(hostname) === 6 && (hostname.startsWith('::') || /^fe[89ab]/u.test(hostname) ||
      hostname.startsWith('ff') || hostname.startsWith('64:ff9b:'))) throw failure()
  return url.href.replace(/\/$/u, '')
}

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
const PLATFORM_SESSION_TYPE = 'urn:bisheng:params:oauth:token-type:platform-session'
const IDENTITY_SCOPES = new Set(['openid', 'profile', 'email'])
const OAUTH_ERRORS = new Set(['consent_required', 'invalid_grant', 'invalid_target', 'invalid_scope',
  'invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'invalid_request', 'temporarily_unavailable'])

function requestGrant(appId, appBaseUrl, appScopes, accessToken) {
  if (typeof appBaseUrl !== 'string' || !appBaseUrl) throw failure('invalid_request', 400)
  const targetBase = trustedBase(appBaseUrl)
  // Match the ordinary identity flow; optional email requires an explicit app request.
  const scopes = appScopes ?? ['openid', 'profile']
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 3 ||
      scopes.some(scope => !IDENTITY_SCOPES.has(scope)) || new Set(scopes).size !== scopes.length) throw failure('invalid_request', 400)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: accessToken, subject_token_type: PLATFORM_SESSION_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE, audience: appId, scope: scopes.join(' ')
  })
  return { targetBase, body: body.toString(), subjectToken: accessToken, scopes }
}

function validateExchange(value, subjectToken, hostToken, scopes, startedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.issued_token_type !== ACCESS_TOKEN_TYPE || typeof value.token_type !== 'string' ||
      value.token_type.toLowerCase() !== 'bearer' || typeof value.access_token !== 'string' ||
      value.access_token.length > 16384 || !/^[A-Za-z0-9\-._~+/]+=*$/u.test(value.access_token) ||
      value.access_token === subjectToken || value.access_token === hostToken ||
      !Number.isInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 300 ||
      startedAt + value.expires_in * 1000 <= Date.now() ||
      'refresh_token' in value || 'id_token' in value || typeof value.scope !== 'string') throw failure()
  const granted = value.scope.split(' ')
  if (granted.length !== scopes.length || new Set(granted).size !== granted.length ||
      granted.some(scope => !scopes.includes(scope))) throw failure()
  return value.access_token
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined)
  })
}

async function readEnvelope(response, signal, check) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => undefined)
    throw failure('response_too_large', 413)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new SyntaxError('Empty enterprise application response.')
  let completed = false
  try {
    let size = 0
    const chunks = []
    while (true) {
      check()
      const { done, value } = await abortable(reader.read(), signal)
      check()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw failure('response_too_large', 413)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    check()
    completed = true
    return result
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Host-only exchange. The result must never be returned to a business plugin or renderer. */
async function resolveAppAccess({ appId, path, plugin, base, accessToken, context, appBaseUrl, appScopes, fetchImpl = fetch, signal, assertCurrent }, diagnostic) {
  validateEnterpriseAppId(appId)
  relativePath(path)
  if (!plugin || typeof plugin.pluginId !== 'string' || !/^[a-f0-9]{32}$/u.test(plugin.pluginId) ||
      typeof plugin.instanceId !== 'string' || !/^[a-z0-9-]{1,128}$/iu.test(plugin.instanceId) ||
      typeof accessToken !== 'string' || !accessToken || /[\r\n]/u.test(accessToken) || typeof assertCurrent !== 'function') throw failure('invalid_request', 400)
  diagnostic.stage = 'enterprise_url'
  const enterpriseBase = trustedBase(base)
  if (!context || context.base !== base || ['userId', 'tenantId', 'sessionVersion'].some(key => typeof context[key] !== 'string' || !context[key])) {
    throw failure('invalid_request', 400)
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const check = () => { combined.throwIfAborted(); assertCurrent() }
  let response
  try {
    check()
    // The plugin supplies its configured service URL. Only BiSheng decides target-client authorization.
    diagnostic.stage = 'target_validation'
    const grant = requestGrant(appId, appBaseUrl, appScopes, accessToken)
    check()
    diagnostic.stage = 'token_exchange'
    const startedAt = Date.now()
    response = await abortable(Promise.resolve(fetchImpl(enterpriseBase + '/api/v1/oauth2/token', {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: combined,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: grant.body
    })).then(value => {
      if (combined.aborted) void value.body?.cancel().catch(() => undefined)
      return value
    }), combined)
    check()
    if (!response.ok) {
      let code = response.status >= 400 && response.status < 500 ? 'authorization_denied' : 'request_failed'
      if (response.status >= 400 && response.status < 500) {
        try {
          const error = await readEnvelope(response, combined, check)
          if (OAUTH_ERRORS.has(error?.error)) code = error.error
        } catch (error) {
          // An HTML/plain-text denial still preserves its HTTP status; bounded-read and session failures must propagate.
          if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error
        }
      }
      throw failure(code, response.status >= 400 && response.status < 500 ? response.status : 502)
    }
    diagnostic.stage = 'token_response'
    const value = await readEnvelope(response, combined, check)
    const token = validateExchange(value, grant.subjectToken, accessToken, grant.scopes, startedAt)
    check()
    return { endpoint: grant.targetBase + path, accessToken: token }
  } catch (error) {
    if (combined.aborted) throw failure(signal?.aborted ? 'request_aborted' : 'request_timeout', signal?.aborted ? 499 : 504)
    if (error instanceof EnterpriseAuthError) throw failure(error.errorCode, error.status)
    throw failure()
  } finally {
    if (response?.body && !response.bodyUsed && !response.body.locked) void response.body.cancel().catch(() => undefined)
  }
}

/** Keep failure diagnostics at the Host even when a business plugin collapses the public error. */
export async function resolveEnterpriseAppAccess(options) {
  const diagnostic = { stage: 'validation' }
  try {
    return await resolveAppAccess(options, diagnostic)
  } catch (error) {
    const appId = typeof options?.appId === 'string' && options.appId.length <= 64 &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.appId) ? options.appId : undefined
    const code = error instanceof EnterpriseAuthError && /^[a-z_]{1,64}$/u.test(error.errorCode)
      ? error.errorCode : 'request_failed'
    const status = error instanceof EnterpriseAuthError && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status : 502
    // Never log the exception, URL, request body, source credential or returned token.
    console.warn('[enterprise-app-access]', { appId, stage: diagnostic.stage, code, status })
    throw error
  }
}
