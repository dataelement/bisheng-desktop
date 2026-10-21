const PLUGIN_ID = /^[a-f0-9]{32}$/u
const DIGEST = /^[a-f0-9]{64}$/u
const MAX_SKEW_MS = 60_000
const MAX_AGE_MS = 5 * 60_000

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_snapshot' })
}

/** Accept a fresh, unsigned publication snapshot for this account and device. */
export function acceptMarketSnapshot(snapshot, account, device, now = Date.now()) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw invalid('Invalid market snapshot.')
  if (snapshot.tenant_id !== account?.tenant?.id || snapshot.user_id !== account?.user?.id || snapshot.device_id !== device) {
    throw invalid('Enterprise market snapshot belongs to another account.')
  }
  if (!Number.isSafeInteger(snapshot.synced_at)) throw invalid('Invalid market snapshot time.')
  const age = now - snapshot.synced_at * 1000
  if (age < -MAX_SKEW_MS || age > MAX_AGE_MS) throw invalid('Enterprise market snapshot is stale.')
  if (!Array.isArray(snapshot.policies) || snapshot.policies.length > 500) throw invalid('Invalid market snapshot.')
  const pluginIds = new Set()
  for (const policy of snapshot.policies) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw invalid('Invalid market policy.')
    if (!PLUGIN_ID.test(policy.plugin_id) || typeof policy.name !== 'string' || policy.name.length > 214) throw invalid('Invalid market policy.')
    if (pluginIds.has(policy.plugin_id)) throw invalid('Duplicate market policy.')
    pluginIds.add(policy.plugin_id)
    if (typeof policy.disabled !== 'boolean' || !Number.isSafeInteger(policy.revision) || policy.revision < 0) throw invalid('Invalid market policy.')
    if (policy.current_version_id != null && !PLUGIN_ID.test(policy.current_version_id)) throw invalid('Invalid market policy.')
    if (!Array.isArray(policy.versions) || policy.versions.length > 100) throw invalid('Invalid market policy.')
    const versionIds = new Set()
    for (const version of policy.versions) {
      if (!version || typeof version !== 'object' || !PLUGIN_ID.test(version.id) || !DIGEST.test(version.digest)) throw invalid('Invalid market policy digest.')
      if (versionIds.has(version.id)) throw invalid('Duplicate market version.')
      versionIds.add(version.id)
    }
  }
  return snapshot
}
