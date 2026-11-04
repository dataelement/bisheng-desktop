export interface StartupPluginPolicy {
  enforce: (dshHome: string, note: (line: string) => void) => Promise<void>
  read: (dshHome: string) => Promise<{ allowThirdPartyPlugins: boolean }>
}

export function bindStartupPluginPolicy(policy: StartupPluginPolicy, dshHome: string, note: (line: string) => void) {
  return {
    enforceCommunityPluginPolicy: () => policy.enforce(dshHome, note),
    thirdPartyPluginsAllowed: async () => (await policy.read(dshHome)).allowThirdPartyPlugins === true
  }
}
