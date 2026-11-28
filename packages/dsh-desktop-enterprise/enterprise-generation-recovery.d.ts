import type { BundleIdentity, EnterpriseBundleInstallOptions } from './offline-bundle.js'

export interface RecoverableEnterpriseGeneration extends BundleIdentity {
  generation_id: string
  directory: string
  integrity?: string
}
/** Caller revalidates the current account, exact version authorization and operation epoch. */
export declare function prepareEnterpriseGeneration<T extends RecoverableEnterpriseGeneration>(
  home: string,
  record: T,
  target: string,
  options: {
    assertCurrent(): void
    fetchArtifact(): Promise<Buffer>
    installOptions?: EnterpriseBundleInstallOptions
  }
): Promise<T>
