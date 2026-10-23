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
  verifyWorkbenchArtifact?: (input: unknown) => Promise<{ ok: boolean, stage?: string, error?: string }>
  materializeWorkbenchArtifact?: (input: unknown) => Promise<{ ok: boolean, path?: string, ticket?: string, stage?: string, error?: string }>
  releaseWorkbenchArtifact?: (ticket: string, connectionKey: string) => Promise<unknown>
  refreshState?: () => Promise<unknown>
}): {
  stop: () => void
  catalog: () => Promise<EnterpriseWorkbenchCatalogResult>
  detail: (id: string) => Promise<{ status: string, accountKey: string, detail: EnterpriseWorkbenchDetail | null }>
  verify: (id: string) => Promise<{ ok: boolean, stage?: string, error?: string }>
  packageForInstall: (id: string) => Promise<{ path: string, ticket: string, connectionKey: string, packageName: string, version: string }>
}
export function applyEnterpriseWorkbenchMarket(ctx: unknown, accountController: unknown): {
  stop: () => void
}
