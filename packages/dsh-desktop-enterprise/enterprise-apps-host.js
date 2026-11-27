import { isIP } from 'node:net'
import { EnterpriseAuthError } from './enterprise-auth-client.js'
import { validateEnterpriseAppId } from './enterprise-apps-contract.js'

export { validateEnterpriseAppId, assertEnterprisePublicRequestPath } from './enterprise-apps-contract.js'

const MAX_RESPONSE_BYTES = 64 * 1024
const TIMEOUT_MS = 15_000
const ENVELOPE_KEYS = ['protocol_version', 'app_id', 'audience', 'base_url', 'token_type', 'access_token', 'expires_in', 'scope']

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
  if (typeof value !== 'string' || value.length > 8192 || !/^https:\/\//iu.test(value) || /[\\\s\x00-\x1f\x7f]/u.test(value)) throw failure()
  let url
  try { url = new URL(value) } catch { throw failure() }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[?#]/u.test(value)) throw failure()
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

function validateEnvelope(value, appId, hostToken) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== ENVELOPE_KEYS.length || Object.keys(value).some(key => !ENVELOPE_KEYS.includes(key)) ||
      value.protocol_version !== 1 || value.app_id !== appId ||
      typeof value.audience !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value.audience) ||
      value.token_type !== 'Bearer' || typeof value.access_token !== 'string' ||
      !/^bapp_v1_[A-Za-z0-9_-]{43}$/u.test(value.access_token) || value.access_token === hostToken ||
      !Number.isInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 60 ||
      typeof value.scope !== 'string' || value.scope.length > 2048 ||
      !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/u.test(value.scope)) throw failure()
  return { base: trustedBase(value.base_url), token: value.access_token }
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
  if (!reader) throw failure()
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
export async function resolveEnterpriseAppAccess({ appId, path, plugin, base, accessToken, fetchImpl = fetch, signal, assertCurrent }) {
  validateEnterpriseAppId(appId)
  relativePath(path)
  if (!plugin || typeof plugin.pluginId !== 'string' || !/^[a-f0-9]{32}$/u.test(plugin.pluginId) ||
      typeof plugin.instanceId !== 'string' || !/^[a-z0-9-]{1,128}$/iu.test(plugin.instanceId) ||
      typeof accessToken !== 'string' || !accessToken || /[\r\n]/u.test(accessToken) || typeof assertCurrent !== 'function') throw failure('invalid_request', 400)
  const enterpriseBase = trustedBase(base)
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const check = () => { combined.throwIfAborted(); assertCurrent() }
  let response
  try {
    check()
    response = await abortable(Promise.resolve(fetchImpl(enterpriseBase + '/api/v1/dsh/integrations/' + appId + '/delegations', {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: combined,
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json',
        'x-dsh-plugin-id': plugin.pluginId, 'x-dsh-plugin-instance-id': plugin.instanceId }, body: '{}'
    })).then(value => {
      // A custom host fetch may finish after cancellation; discard its unused body.
      if (combined.aborted) void value.body?.cancel().catch(() => undefined)
      return value
    }), combined)
    check()
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 404) throw failure('app_unavailable', 404)
      if (response.status >= 400 && response.status < 500) throw failure('authorization_denied', response.status)
      throw failure()
    }
    const envelope = await readEnvelope(response, combined, check)
    const value = validateEnvelope(envelope, appId, accessToken)
    check()
    // Concatenation preserves the registry's path prefix even for a leading slash path.
    return { endpoint: value.base + path, accessToken: value.token }
  } catch (error) {
    if (combined.aborted) throw failure(signal?.aborted ? 'request_aborted' : 'request_timeout', signal?.aborted ? 499 : 504)
    if (error instanceof EnterpriseAuthError) throw failure(error.errorCode, error.status)
    throw failure()
  } finally {
    // Cleanup must not mask a session or transport failure. readEnvelope owns locked bodies.
    if (response?.body && !response.bodyUsed && !response.body.locked) void response.body.cancel().catch(() => undefined)
  }
}
