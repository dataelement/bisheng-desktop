import { readPersistedThirdPartyPolicy, syncMarketBundle } from 'dsh-desktop-market-installer/enterprise-policy'

export { readPersistedThirdPartyPolicy } from 'dsh-desktop-market-installer/enterprise-policy'

type Note = (line: string) => void

/**
 * Align only the dshmarket bundle with the last known tenant policy.
 * Already installed community plugins stay loadable. A missing or unreadable
 * policy keeps the market out of the active profile.
 */
export async function enforceCommunityPluginPolicy(dshHome: string, note: Note): Promise<void> {
  const allowed = (await readPersistedThirdPartyPolicy(dshHome)).allowThirdPartyPlugins === true
  if (!await syncMarketBundle(dshHome, allowed)) return
  note(allowed
    ? '[desktop] restored dshmarket to the active profile'
    : '[desktop] removed dshmarket from the active profile until third-party plugins are allowed')
}

