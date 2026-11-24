export declare function parseDisplayProfile(body: unknown, base: string, userId: string, tenantId: string): {
  id: string
  username: string
  display_name: string
  external_id?: string
  avatar?: string | null
}
