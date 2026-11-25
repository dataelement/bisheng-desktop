import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type { ProfileBundlePackageBackend } from '@deepseek-ai/dsh-plugin-manager'
import type { runProfilePnpm } from '@deepseek-ai/dsh-plugin-manager/operations'
import type { Context } from '@deepseek-ai/cordis'

/** Called by Plugin Manager while it holds the active profile package lock. */
export function createWebPackageBackend(options: {
  profile: ProfileContext
  runPnpm?: typeof runProfilePnpm
}): ProfileBundlePackageBackend
export function registerWebPackageBackend(ctx: Context): void
