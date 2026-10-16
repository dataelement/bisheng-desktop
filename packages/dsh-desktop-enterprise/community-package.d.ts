import type { BundleIdentity, BundleManifest } from './offline-bundle.js'
export declare function packageEntry(pkg: Record<string, unknown>): string
export declare function readCommunityPackage(bytes: Buffer, expected: BundleIdentity, target: string): Promise<{
  pkg: Record<string, unknown>
  files: Map<string, { data: Buffer; executable: boolean }>
  manifest: BundleManifest
}>
