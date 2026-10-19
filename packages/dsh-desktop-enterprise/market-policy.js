/** Validate a fresh authenticated response; snapshots are kept in memory. */
export function validateMarketSnapshot(snapshot, account, device) {
  const identifier = value => typeof value === 'string' && /^[a-f0-9]{32}$/u.test(value)
  if (!snapshot || snapshot.tenant_id !== account.tenant.id || snapshot.user_id !== account.user.id ||
      snapshot.device_id !== device || !Number.isSafeInteger(snapshot.synced_at) ||
      !Array.isArray(snapshot.policies) || snapshot.policies.length > 10000) {
    throw new Error('Invalid enterprise market synchronization.')
  }
  const seen = new Set()
  for (const rule of snapshot.policies) {
    if (!rule || !identifier(rule.plugin_id) || seen.has(rule.plugin_id) || typeof rule.name !== 'string' ||
        typeof rule.disabled !== 'boolean' || !Number.isSafeInteger(rule.revision) || rule.revision < 0 ||
        (rule.current_version_id !== null && !identifier(rule.current_version_id)) || !Array.isArray(rule.versions) ||
        rule.versions.some(version => !version || !identifier(version.id) || typeof version.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(version.digest))) {
      throw new Error('Invalid enterprise plugin publication state.')
    }
    seen.add(rule.plugin_id)
  }
  return snapshot
}
