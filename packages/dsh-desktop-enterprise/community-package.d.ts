export function packageEntry(pkg: { exports?: unknown; main?: string }): string

export function readCommunityPackage(
  bytes: Buffer,
  expected: { name: string; version: string; digest: string },
  target: string
): Promise<{
  pkg: Record<string, unknown>
  files: Map<string, { data: Buffer; executable: boolean }>
  manifest: { schema_version: number; format: string; plugin: Record<string, unknown>; targets: Record<string, Record<string, string>> }
}>

export function looksLikeCommunityArchive(bytes: Buffer): boolean
