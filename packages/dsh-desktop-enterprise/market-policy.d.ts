export declare function acceptMarketSnapshot(
  snapshot: unknown,
  account: { tenant?: { id: string }; user?: { id: string } },
  device: string,
  now?: number
): {
  tenant_id: string
  user_id: string
  device_id: string
  synced_at: number
  policies: Array<{ plugin_id: string; name: string; disabled: boolean; revision: number; current_version_id?: string | null; versions: Array<{ id: string; digest: string }> }>
}
