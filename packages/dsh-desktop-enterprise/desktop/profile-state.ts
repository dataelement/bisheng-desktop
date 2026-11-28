import { parseDisplayProfile } from '../display-profile.js'
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
    this.user = parseDisplayProfile(body, base, userId, tenantId)
    this.succeededAt = now
    this.failures = 0
  }
}
