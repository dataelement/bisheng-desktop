export interface MarketPublication {
  plugin_id: string
  name: string
  disabled: boolean
  revision: number
  current_version_id: string | null
  versions: { id: string; digest: string }[]
}
export interface MarketSnapshot {
  tenant_id: string
  user_id: string
  device_id: string
  synced_at: number
  policies: MarketPublication[]
}
export declare function validateMarketSnapshot(snapshot: unknown, account: { tenant: { id: string }; user: { id: string } }, device: string): MarketSnapshot
