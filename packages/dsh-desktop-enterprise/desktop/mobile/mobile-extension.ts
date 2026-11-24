import { hostname } from 'node:os'
import type { MobileProductExtension } from '../../../../src/main/mobile/product-extension'
import type { EnterpriseDesktopRuntime } from '../enterprise-desktop'
import { startMobileAccessClient } from './mobile-access-client'
import { accountsMatch, REMOTE_TENANT_HEADER, REMOTE_USER_HEADER } from './mobile-access-protocol'
import { createFileMobileAccessStore, mobileAccessStorePath } from './mobile-access-store'
import { renderMobilePage } from './mobile-pages'
import { EnterpriseMobileRpc, transcriptFollowValue } from './mobile-rpc'

export function createEnterpriseMobileExtension(account: Pick<EnterpriseDesktopRuntime, 'readMobileAccessAccount' | 'subscribeMobileAccessAccount'>, userDataPath: string): MobileProductExtension {
  let rpc: EnterpriseMobileRpc | undefined
  return {
    authorizeRemote(headers) {
      const user = headers[REMOTE_USER_HEADER], tenant = headers[REMOTE_TENANT_HEADER]
      return accountsMatch(account.readMobileAccessAccount(), {
        userId: typeof user === 'string' ? user : undefined,
        tenantId: typeof tenant === 'string' ? tenant : undefined
      })
    },
    attach(transport) {
      const current = new EnterpriseMobileRpc(transport)
      rpc = current
      const client = startMobileAccessClient({
        account: () => account.readMobileAccessAccount(),
        subscribeAccount: listener => account.subscribeMobileAccessAccount(listener),
        bridge: transport,
        store: createFileMobileAccessStore(mobileAccessStorePath(userDataPath)),
        displayName: hostname,
        note: line => console.info(line)
      })
      return async () => { current.dispose(); if (rpc === current) rpc = undefined; await client.stop() }
    },
    rpc: async input => rpc?.dispatch(input),
    renderPage: locale => renderMobilePage({ locale, product: 'bisheng' }),
    sessionProjection(_sessionId, view) {
      const liveTurn: { turn?: number; step?: number } = {}
      return { assistantStream: true, project: value => transcriptFollowValue(value, view === 'transcript', liveTurn) }
    }
  }
}
