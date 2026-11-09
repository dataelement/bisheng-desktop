export interface EnterpriseWorkbenchScreenshot {
  id: string
  url: string
  sha256: string
  media_type: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  bytes: number
  alt: string
}

export interface EnterpriseWorkbenchListItem {
  id: string
  identityKind: 'repository' | 'legacy'
  workbenchKey: string | null
  legacyId: string | null
  packageName: string
  displayName: string
  description: string
  verificationLevel: string
  updatedAt: string
  screenshots: EnterpriseWorkbenchScreenshot[]
  currentVersion: { id: string, version: string }
}

export interface EnterpriseWorkbenchDetail extends EnterpriseWorkbenchListItem {
  sha256: string
  sizeBytes: number
  artifactPath: string
  verifiable: boolean
  packageMetadata: {
    repositoryUrl: string | null
    patchEntryId: string | null
    serverEntry: string | null
    clientEntry: string | null
    bundlePatch: string | null
    license: string | null
    nodeEngine: string | null
    dependencies: string[]
    legacyManifest: boolean
  }
}

export interface EnterpriseWorkbenchCatalogResult {
  status: 'idle' | 'ready' | 'empty' | 'unavailable' | 'error'
  accountKey: string
  data: EnterpriseWorkbenchListItem[]
  total: number
  skipped: number
  error?: string
}

export function parseWorkbenchListItem(value: unknown): EnterpriseWorkbenchListItem | null
export function parseWorkbenchDetail(value: unknown, expectedId: string): EnterpriseWorkbenchDetail | null
export function createWorkbenchMarketController(accountController: {
  state: () => { connected?: boolean, connectionKey?: string }
  marketRequest: (path: string) => Promise<{ status_code?: number, status_message?: string, data?: unknown }>
  workbenchScreenshotRequest?: (path: string, signal: AbortSignal | undefined, image: EnterpriseWorkbenchScreenshot) => Promise<Uint8Array>
  verifyWorkbenchArtifact?: (input: unknown) => Promise<{ ok: boolean, stage?: string, error?: string }>
  materializeWorkbenchArtifact?: (input: unknown) => Promise<{ ok: boolean, path?: string, ticket?: string, stage?: string, error?: string }>
  releaseWorkbenchArtifact?: (ticket: string, connectionKey: string) => Promise<unknown>
  refreshState?: () => Promise<unknown>
}): {
  stop: () => void
  catalog: () => Promise<EnterpriseWorkbenchCatalogResult>
  detail: (id: string) => Promise<{ status: string, accountKey: string, detail: EnterpriseWorkbenchDetail | null }>
  screenshot: (id: string, versionId: string, imageId: string, signal: AbortSignal | undefined, accountKey: string) => Promise<{ bytes: Uint8Array, image: EnterpriseWorkbenchScreenshot }>
  verify: (id: string) => Promise<{ ok: boolean, stage?: string, error?: string }>
  packageForInstall: (id: string) => Promise<{ path: string, ticket: string, connectionKey: string, packageName: string, version: string }>
}
export function applyEnterpriseWorkbenchMarket(ctx: unknown, accountController: unknown): {
  stop: () => void
}
