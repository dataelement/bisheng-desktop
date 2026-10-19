const object = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const ERROR_CODES = new Set([
  'invalid_request', 'invalid_response', 'not_connected', 'authorization_denied',
  'session_changed', 'request_aborted', 'request_timeout', 'request_failed', 'tool_not_found'
])
const BACKEND_CODES = new Set([
  'invalid_request', 'unsupported_parameter', 'context_length_exceeded',
  'invalid_access_token', 'session_expired', 'session_revoked', 'permission_denied', 'internal_error',
  'tool_not_found', 'tool_permission_denied', 'tool_unsupported', 'tool_arguments_invalid',
  'tool_concurrency_exceeded', 'tool_upstream_failed', 'tool_result_invalid',
  'tool_execution_timeout', 'tool_service_unavailable', 'tool_input_too_large', 'tool_output_too_large'
])
const MESSAGES = {
  invalid_request: 'Invalid enterprise tool request.',
  invalid_response: 'Enterprise tool returned an invalid response.',
  not_connected: 'Sign in to your enterprise account to invoke tools.',
  authorization_denied: 'Enterprise tool permission was denied.',
  session_changed: 'Enterprise session changed during tool invocation.',
  request_aborted: 'Enterprise tool invocation was cancelled.',
  request_timeout: 'Enterprise tool invocation timed out.',
  request_failed: 'Enterprise tool invocation failed.',
  tool_not_found: 'Enterprise tool was not found.'
}

function diagnostics(value) {
  return {
    ...(Number.isInteger(value?.status) && value.status >= 100 && value.status <= 599 ? { status: value.status } : {}),
    ...(BACKEND_CODES.has(value?.backendCode) ? { backendCode: value.backendCode } : {}),
    ...(typeof value?.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.requestId) ? { requestId: value.requestId } : {})
  }
}

export class EnterpriseToolError extends Error {
  constructor(errorCode, details = {}) {
    const code = ERROR_CODES.has(errorCode) ? errorCode : 'request_failed'
    const safe = diagnostics(details)
    const suffix = [safe.status && 'HTTP ' + safe.status, safe.backendCode && 'code=' + safe.backendCode,
      safe.requestId && 'request_id=' + safe.requestId].filter(Boolean).join('; ')
    super(MESSAGES[code] + (suffix ? ' (' + suffix + ')' : ''))
    this.name = 'EnterpriseToolError'
    this.errorCode = code
    Object.assign(this, safe)
  }
}

function session(getState) {
  const state = getState()
  if (!object(state) || typeof state.connected !== 'boolean' ||
      typeof state.sessionVersion !== 'string' || !state.sessionVersion || state.sessionVersion.length > 256 ||
      ['enterpriseId', 'userId'].some(key => state[key] !== undefined &&
        (typeof state[key] !== 'string' || !state[key] || state[key].length > 256))) {
    throw new EnterpriseToolError('invalid_response')
  }
  return { connected: state.connected, identity: JSON.stringify([state.sessionVersion, state.enterpriseId, state.userId]) }
}

function unchanged(getState, original) {
  const current = session(getState)
  if (!current.connected || current.identity !== original.identity) throw new EnterpriseToolError('session_changed')
}

function waitFor(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    const settle = callback => value => { signal.removeEventListener('abort', abort); callback(value) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(settle(resolve), settle(reject))
    if (signal.aborted) abort()
  })
}

function cancel(reader) {
  // Cleanup must not delay timeout/error delivery, even for a stalled underlying source.
  try { void Promise.resolve(reader.cancel()).catch(() => {}) } catch {}
}

async function readJson(response, signal, maxBytes) {
  const reader = response.body?.getReader()
  if (!reader) throw new EnterpriseToolError('invalid_response')
  const abort = () => cancel(reader)
  signal.addEventListener('abort', abort, { once: true })
  const chunks = []
  let size = 0
  try {
    signal.throwIfAborted()
    while (true) {
      const { done, value } = await waitFor(reader.read(), signal)
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new EnterpriseToolError('invalid_response')
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      throw new EnterpriseToolError('invalid_response')
    }
  } finally {
    signal.removeEventListener('abort', abort)
    cancel(reader)
    reader.releaseLock()
  }
}

async function httpFailure(response, signal, maxBytes) {
  const diagnostic = new AbortController()
  const timer = setTimeout(() => diagnostic.abort(), 1000)
  let payload
  try {
    payload = await readJson(response, AbortSignal.any([signal, diagnostic.signal]), Math.min(maxBytes, 16 * 1024))
  } catch {
    // Status remains authoritative if diagnostic JSON is oversized, broken or stalled.
  } finally { clearTimeout(timer) }
  const errorCode = ({ 400: 'invalid_request', 401: 'not_connected', 403: 'authorization_denied', 404: 'tool_not_found' })[response.status] ?? 'request_failed'
  return new EnterpriseToolError(errorCode, {
    status: response.status,
    backendCode: object(payload?.error) ? payload.error.code : undefined,
    requestId: payload?.request_id
  })
}

/** Callbacks must retain the invoking Cordis service receiver, not the provider context. */
export async function invokeEnterpriseTool({ getState, request }, toolName, args, options = {}) {
  if (!object(options) || typeof toolName !== 'string' || !/^[A-Za-z0-9_-]{1,125}$/u.test(toolName)) {
    throw new EnterpriseToolError('invalid_request')
  }
  const { signal, timeoutMs = 60_000, maxInputBytes = 65536, maxResponseBytes = 4 * 1024 * 1024 } = options
  if (![timeoutMs, maxInputBytes, maxResponseBytes].every(value => Number.isSafeInteger(value) && value > 0) ||
      (signal !== undefined && !(signal instanceof AbortSignal))) throw new EnterpriseToolError('invalid_request')
  const timeout = new AbortController()
  let remaining = timeoutMs
  let timer
  const schedule = () => {
    const duration = Math.min(remaining, 2147483647)
    timer = setTimeout(() => {
      remaining -= duration
      if (remaining > 0) schedule()
      else timeout.abort()
    }, duration)
  }
  schedule()
  const execution = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
  try {
    execution.throwIfAborted()
    const original = session(getState)
    if (!original.connected) throw new EnterpriseToolError('not_connected')
    let body
    try {
      body = JSON.stringify({ arguments: args })
      if (!Object.hasOwn(JSON.parse(body), 'arguments')) throw new Error('Missing JSON arguments')
    } catch { throw new EnterpriseToolError('invalid_request') }
    if (Buffer.byteLength(body, 'utf8') > maxInputBytes) throw new EnterpriseToolError('invalid_request')
    const pending = Promise.resolve().then(() => {
      execution.throwIfAborted()
      unchanged(getState, original)
      return request('/api/v1/dsh/tools/' + toolName + '/invoke', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: execution
      })
    })
    // A legacy host might ignore cancellation until after headers arrive.
    void pending.then(response => { if (execution.aborted && response?.body) cancel(response.body) }, () => {})
    const response = await waitFor(pending, execution)
    execution.throwIfAborted()
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || typeof response.ok !== 'boolean') {
      throw new EnterpriseToolError('invalid_response')
    }
    if (!response.ok) {
      const failure = await httpFailure(response, execution, maxResponseBytes)
      unchanged(getState, original)
      throw failure
    }
    const payload = await readJson(response, execution, maxResponseBytes)
    execution.throwIfAborted()
    unchanged(getState, original)
    if (!object(payload) || payload.tool !== toolName) throw new EnterpriseToolError('invalid_response')
    if (payload.error !== undefined && payload.error !== null) throw new EnterpriseToolError('request_failed')
    if (!Object.hasOwn(payload, 'result')) throw new EnterpriseToolError('invalid_response')
    return payload.result
  } catch (error) {
    if (signal?.aborted) throw new EnterpriseToolError('request_aborted')
    // A known HTTP status survives the total deadline while reading best-effort diagnostics.
    if (error instanceof EnterpriseToolError) throw error
    if (timeout.signal.aborted) throw new EnterpriseToolError('request_timeout')
    const errorCode = ERROR_CODES.has(error?.errorCode) ? error.errorCode :
      ({ request_too_large: 'invalid_request', response_too_large: 'invalid_response' })[error?.errorCode] ?? 'request_failed'
    throw new EnterpriseToolError(errorCode)
  } finally { clearTimeout(timer) }
}
