export const MOBILE_BIND_PATH = '/api/v1/dsh/mobile/bind'
export const MOBILE_UNBIND_PATH = '/api/v1/dsh/mobile/unbind'
export const MOBILE_ATTACH_PATH = '/api/v1/dsh/mobile/attach'
export const MOBILE_DESKTOPS_PATH = '/api/v1/dsh/mobile/desktops'

export const REMOTE_CHANNEL_HEADER = 'x-dsh-mobile-channel'
export const REMOTE_CHANNEL_TOKEN_HEADER = 'x-dsh-mobile-channel-token'
export const REMOTE_USER_HEADER = 'x-dsh-user-id'
export const REMOTE_TENANT_HEADER = 'x-dsh-tenant-id'

export const MOBILE_ACCESS_HEARTBEAT_MS = 20_000

export interface MobileAccessAccount {
  base?: string
  accessToken?: string
  userId?: string
  tenantId?: string
}

export function mobileAccessAccountKey(account: MobileAccessAccount): string {
  if (!account.base || !account.accessToken || !account.userId || !account.tenantId) return ''
  return `${account.base}\n${account.userId}\n${account.tenantId}`
}

export function accountsMatch(
  desktop: { userId?: string, tenantId?: string },
  presented: { userId?: string, tenantId?: string }
): boolean {
  return Boolean(
    desktop.userId &&
    desktop.tenantId &&
    presented.userId &&
    presented.tenantId &&
    desktop.userId === presented.userId &&
    desktop.tenantId === presented.tenantId
  )
}
