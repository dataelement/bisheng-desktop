import { createDesktopBootstrap } from './index'
import { enforceCommunityPluginPolicy, readPersistedThirdPartyPolicy } from './enterprise/startup-plugin-policy'
import { ENTERPRISE_IDENTITY } from './product-identity'
import { migrateLegacyEnterpriseSettings } from './enterprise/legacy-settings-migration'
import { startEnterpriseExtension } from './enterprise/static-extension-adapter'
import { createEnterpriseChatDisposer, registerEnterpriseChatIpc } from './enterprise/chat-ipc'
import { enterpriseLoginFromArgv, parseEnterpriseLoginLink, registerEnterpriseLoginProtocol, sameHarnessOrigin } from './enterprise/login-link'

createDesktopBootstrap({
  identity: ENTERPRISE_IDENTITY,
  harnessPatches: {
    normal: 'dsh-desktop.patch.yml',
    safe: 'dsh-desktop-safe.patch.yml',
    market: 'dsh-desktop-market.patch.yml'
  },
  startupPluginPolicy: { enforce: enforceCommunityPluginPolicy, read: readPersistedThirdPartyPolicy },
  profileMaintenance: async ({ dshHome, note }) => {
    try {
      const legacyEnterprise = await migrateLegacyEnterpriseSettings(dshHome)
      if (legacyEnterprise.changed) {
        note(`[enterprise] retired legacy settings: ${legacyEnterprise.removed.join(', ')}`)
      }
    } catch (error) {
      note(`[enterprise] legacy settings migration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
  loginLink: {
    fromArgv: enterpriseLoginFromArgv,
    parse: parseEnterpriseLoginLink,
    registerProtocol: registerEnterpriseLoginProtocol,
    sameOrigin: sameHarnessOrigin
  },
  startEnterprise: startEnterpriseExtension,
  registerChatIpc: registerEnterpriseChatIpc,
  createChatDisposer: createEnterpriseChatDisposer
})()
