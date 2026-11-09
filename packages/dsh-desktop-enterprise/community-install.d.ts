export function installCommunityPackage(
  home: string,
  bytes: Buffer,
  expected: { name: string; version: string; digest: string },
  target: string,
  options?: { dshEntryPath?: string; installOptions?: Record<string, unknown> }
): Promise<{ id: string; directory: string; pluginName: string; version: string; manifest: unknown; integrity: string }>

export function verifyCommunityPackage(
  generation: { name: string; version: string; digest: string; directory: string; integrity: string },
  bytes: Buffer,
  target: string
): Promise<{ manifest: { schema_version: number } }>
