import type { BundleIdentity, BundleManifest, OfflineGeneration, PluginInstallOptions } from './offline-bundle.js'
export declare function installCommunityPackage(home: string, bytes: Buffer, expected: BundleIdentity, target: string, options: PluginInstallOptions): Promise<OfflineGeneration>
export declare function verifyCommunityPackage(generation: BundleIdentity & { directory: string; integrity?: string }, bytes: Buffer, target: string): Promise<{ manifest: BundleManifest }>
