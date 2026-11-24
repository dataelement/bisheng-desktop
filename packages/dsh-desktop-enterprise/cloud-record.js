/** Persist display metadata only; access is always revalidated by the host. */
export const validCloudId = value => typeof value === 'string' && /^cloud:[a-f0-9]{16}:[a-f0-9]{32}$/.test(value)
export function validCloudRecord(id, value) {
  return validCloudId(id) && value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => ['appId', 'connectionKey', 'title', 'description', 'versionId'].includes(key))
    && /^[a-f0-9]{32}$/.test(value.appId) && /^[a-f0-9]{16}$/.test(value.connectionKey)
    && id === `cloud:${value.connectionKey}:${value.appId}`
    && typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 300
    && typeof value.description === 'string' && value.description.length <= 2000
    && (value.versionId === null || /^[a-f0-9]{32}$/.test(value.versionId))
}
