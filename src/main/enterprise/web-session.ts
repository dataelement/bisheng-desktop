export interface EnterpriseWebSession {
  base: string
  cookie: string
  expiresAt: number
  connectionKey: string
}

/** The platform chooses the cookie value; the host fixes its origin and flags. */
export function parseWebSession(value: unknown, base: string, connectionKey: string, now = Date.now()): EnterpriseWebSession {
  if (!value || typeof value !== 'object') throw new Error('Invalid enterprise web session.')
  const body = value as Record<string, unknown>
  if (typeof body.cookie !== 'string' || body.cookie.length < 20 || body.cookie.length > 16384 ||
    !/^[A-Za-z0-9._-]+$/u.test(body.cookie) || typeof body.expires_in !== 'number' ||
    !Number.isInteger(body.expires_in) || body.expires_in < 30 || body.expires_in > 600) {
    throw new Error('Invalid enterprise web session.')
  }
  return { base, cookie: body.cookie, expiresAt: now + body.expires_in * 1000, connectionKey }
}
