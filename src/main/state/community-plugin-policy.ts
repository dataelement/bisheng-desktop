import { readQuarantinedPluginNames } from 'dsh-desktop-market-installer/community-quarantine'
import { isProtectedProfileBundle } from 'dsh-desktop-market-installer/profile-protection'

/** Existing Desktop profile protection baseline shared with package operations. */
export { isProtectedProfileBundle } from 'dsh-desktop-market-installer/profile-protection'

/**
 * Re-enable only a protected bundle that this Safe Mode page listed and that
 * is actually disabled. Renderer-supplied names are not trusted on their own.
 */
export function canReenableProfilePlugin(
  pluginName: string,
  listedPlugins: readonly string[],
  disabledPlugins: readonly string[]
): boolean {
  return isProtectedProfileBundle(pluginName)
    && listedPlugins.includes(pluginName)
    && disabledPlugins.includes(pluginName)
}

export { readQuarantinedPluginNames }
