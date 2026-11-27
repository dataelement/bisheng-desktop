import { EnterpriseAuthError } from './enterprise-auth-client.js'

/** Application registry identifier; never a URL or a path. */
export function validateEnterpriseAppId(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new EnterpriseAuthError('invalid_request', 'Invalid enterprise application identifier.', 400)
  }
  return value
}

/** Keep integration credentials inside the host, even through the ordinary request transport. */
export function assertEnterprisePublicRequestPath(path) {
  const invalid = () => { throw new EnterpriseAuthError('invalid_request', 'Invalid enterprise request path.', 400) }
  if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//')) invalid()
  let pathname = path.split(/[?#]/u)[0]
  // Decoding only shortens an encoded path; the byte-length bound also bounds this loop.
  while (pathname.includes('%')) {
    let decoded
    try { decoded = decodeURIComponent(pathname) } catch { invalid() }
    if (decoded === pathname) break
    pathname = decoded
  }
  if (/[\x00-\x20\x7f]/u.test(pathname)) invalid()
  // Proxies may normalize backslashes, duplicate separators, matrix parameters and dots.
  pathname = pathname.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/')
    .split('/').map(segment => segment.split(';')[0]).join('/')
  const normalized = new URL(pathname, 'https://enterprise.invalid').pathname.toLowerCase()
  if (normalized === '/api/v1/dsh/integrations' || normalized.startsWith('/api/v1/dsh/integrations/')) {
    throw new EnterpriseAuthError('authorization_denied', 'Integration credentials are restricted to the host.', 403)
  }
}
