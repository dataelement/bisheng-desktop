import type { EnterprisePublicIdentity } from './enterprise-service'

export type ProfileRefreshReason = 'account' | 'foreground' | 'image' | 'window-focus' | 'profile-update'

/** Display metadata is memory-only: storage signatures must not enter the credential vault. */
export class EnterpriseProfileState {
  user: EnterprisePublicIdentity | undefined
  private attemptedAt = -Infinity
  private succeededAt = -Infinity
  private failures = 0
  private unsupported = false

  clear(): void {
    this.user = undefined
    this.attemptedAt = -Infinity
    this.succeededAt = -Infinity
    this.failures = 0
    this.unsupported = false
  }

  due(reason: ProfileRefreshReason, now: number): boolean {
    if (this.unsupported) return false
    if (reason === 'profile-update') return true
    // Returning to the native window can follow an external web save even
    // when the previous profile read was very recent.
    const freshnessMs = reason === 'window-focus' ? 0 : reason === 'foreground' ? 5_000 : 60_000
    const retryMs = this.failures ? Math.min(300_000, 60_000 * 2 ** Math.min(this.failures, 3)) : freshnessMs
    return now - this.attemptedAt >= retryMs && now - this.succeededAt >= freshnessMs
  }

  begin(now: number): void { this.attemptedAt = now }
  fail(unsupported = false): void { this.failures += 1; this.unsupported = unsupported }

  apply(body: unknown, base: string, userId: string, tenantId: string, now: number): void {
    if (!isRecord(body) || !isRecord(body.user) || !isRecord(body.tenant) || body.user.id !== userId || body.tenant.id !== tenantId) {
      throw new Error('Enterprise profile identity mismatch.')
    }
    const user = body.user
    if (typeof user.username !== 'string' || !user.username.trim() || typeof user.display_name !== 'string' || !user.display_name.trim()) {
      throw new Error('Invalid enterprise display profile.')
    }
    const account = typeof user.external_id === 'string' && user.external_id.trim() ? user.external_id : undefined
    let avatar: string | null | undefined
    if (Object.hasOwn(user, 'avatar')) {
      if (user.avatar === null || user.avatar === '') avatar = null
      else {
        if (typeof user.avatar !== 'string' || user.avatar.length > 16_384) throw new Error('Invalid enterprise avatar.')
        const url = new URL(user.avatar, base)
        // Normal uploads use the platform's MinIO reverse proxy; never expose arbitrary remote sources.
        if (url.origin !== new URL(base).origin || url.username || url.password || url.hash || !['https:', 'http:'].includes(url.protocol)) {
          throw new Error('Invalid enterprise avatar origin.')
        }
        avatar = url.href
      }
    }
    this.user = { id: userId, username: user.username, display_name: user.display_name,
      ...(account === undefined ? {} : { external_id: account }),
      ...(avatar === undefined ? {} : { avatar }) }
    this.succeededAt = now
    this.failures = 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
