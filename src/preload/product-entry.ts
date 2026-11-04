import { initializeDesktopPreload } from './index'
import { initializeEnterpriseLoginBridge } from './enterprise-bridge'

initializeDesktopPreload(initializeEnterpriseLoginBridge)
