/** Display metadata only. Do not persist signed avatar URLs in the credential vault. */
export function parseDisplayProfile(body, base, userId, tenantId) {
    if (!isRecord(body) || !isRecord(body.user) || !isRecord(body.tenant) || body.user.id !== userId || body.tenant.id !== tenantId) {
      throw new Error('Enterprise profile identity mismatch.')
    }
    const user = body.user
    if (typeof user.username !== 'string' || !user.username.trim() || typeof user.display_name !== 'string' || !user.display_name.trim()) {
      throw new Error('Invalid enterprise display profile.')
    }
    const account = typeof user.external_id === 'string' && user.external_id.trim() ? user.external_id : undefined
    let avatar
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
    return { id: userId, username: user.username, display_name: user.display_name,
      ...(account === undefined ? {} : { external_id: account }),
      ...(avatar === undefined ? {} : { avatar }) }
}

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
