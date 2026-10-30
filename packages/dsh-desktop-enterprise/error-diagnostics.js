const TEXT_LIMIT = 768
const STACK_LIMIT = 2048
const MAX_DEPTH = 4

function read(value, key) {
  try { return value?.[key] } catch { return undefined }
}

function safeText(value, limit = TEXT_LIMIT) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  // Sanitize before truncating so a cut URL or credential cannot escape filtering.
  return String(value)
    .slice(0, 16384)
    .replace(/https?:\/\/[^\s<>"']+/giu, raw => {
      try {
        const url = new URL(raw)
        return url.origin + url.pathname + (url.search ? '?[redacted]' : '')
      } catch { return '[redacted-url]' }
    })
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/giu, '$1 [redacted]')
    .replace(/\bsk-[a-z0-9_-]+/giu, '[redacted]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/giu, '[redacted]')
    .replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credential|capability|identity[_-]?ticket)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/giu, '$1[redacted]')
    .replace(/["']?\b(headers?|body|prompts?|messages?|tokens?)["']?\s*[:=][\s\S]*/giu, '$1=[redacted]')
    .replace(/\{\s*["'][\s\S]*/gu, '[payload redacted]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, ' ')
    .slice(0, limit)
}

function describe(error, seen = new Set(), depth = 0, budget = { remaining: 12 }) {
  if (budget.remaining-- <= 0 || depth >= MAX_DEPTH) return { message: '[cause limit]' }
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return { message: safeText(error) ?? 'Unknown failure' }
  }
  if (seen.has(error)) return { message: '[circular cause]' }
  seen.add(error)
  const result = {}
  for (const key of ['name', 'message', 'code', 'errorCode', 'status', 'requestId']) {
    const value = safeText(read(error, key))
    if (value !== undefined) result[key] = value
  }
  // LlmError carries code/status in its public failure projection.
  const failure = read(error, 'failure')
  for (const key of ['code', 'status', 'requestId']) {
    const value = safeText(read(failure, key))
    if (value !== undefined && result[key] === undefined) result[key] = value
  }
  const stack = read(error, 'stack')
  if (typeof stack === 'string') {
    // Exclude the repeated message and arbitrary payload lines from stack output.
    result.stack = safeText(stack.split('\n').filter(line => /^\s*at /u.test(line)).slice(0, 12).join('\n'), STACK_LIMIT)
  }
  const cause = read(error, 'cause')
  if (cause !== undefined) result.cause = describe(cause, seen, depth + 1, budget)
  const errors = read(error, 'errors')
  if (Array.isArray(errors)) result.errors = errors.slice(0, 4).map(item => describe(item, seen, depth + 1, budget))
  return result
}

/**
 * Best-effort debug diagnostics. Only scalar allowlisted context and error fields
 * are projected; request objects, headers and response bodies never reach logger.
 * @param {string} stage
 * @param {unknown} error
 * @param {{ protocol?: string, model?: string, purpose?: string, path?: string, status?: number, requestId?: string }} [context]
 */
export function serializeEnterpriseFailure(stage, error, context = {}) {
  try {
    const details = { stage: safeText(stage, 96), error: describe(error) }
    for (const key of ['protocol', 'model', 'purpose', 'path', 'status', 'requestId']) {
      const raw = read(context, key)
      const value = safeText(key === 'path' && typeof raw === 'string' ? raw.split(/[?#]/u)[0] : raw, 128)
      if (value !== undefined) details[key] = value
    }
    return JSON.stringify(details)
  } catch {
    return JSON.stringify({ stage: 'diagnostic', error: { message: 'Diagnostic unavailable' } })
  }
}

/** @param {{ debug?: Function } | ((name: string) => { debug?: Function }) | undefined} logger */
export function logEnterpriseFailure(logger, stage, error, context = {}) {
  try {
    const target = typeof logger === 'function' ? logger('enterprise-failure') : logger
    target?.debug?.('[enterprise-failure] %s', serializeEnterpriseFailure(stage, error, context))
  } catch {
    // Diagnostics must never replace the model failure or cancellation contract.
  }
}
