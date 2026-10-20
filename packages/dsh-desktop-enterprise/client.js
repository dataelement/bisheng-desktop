window.__ModuleLoader__.load({
  id: 'dsh-desktop-enterprise',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const LAST_BASE_KEY = 'dshDesktopEnterprise.lastBase'
    const MANUAL_FALLBACK_DELAY_MS = 8_000
    const ENTERPRISE_SECTION_ID = 'enterprise-account'
    const LEARN_MORE_URL = 'https://dshdesktop.com/zh/enterprise/deployment/'
    const OPEN_SETTINGS_SECTION_EVENT = 'dsh-desktop:open-settings-section'
    const NS = 'settings.desktopEnterprise'

    const zh = {
      nav: '账号与安全',
      title: '账号与安全',
      managedModels: '企业提供的模型',
      accountLabel: '当前账号',
      platform: '企业服务地址',
      login: '在浏览器中登录',
      loginAgain: '重新登录',
      loggingIn: '等待浏览器授权…',
      learnMore: '了解企业版',
      vision: '视觉',
      visionHint: '企业已开启图片输入',
      usageLabel: '已用 / 额度（Token）',
      ticket: '一次性登录码',
      submitTicket: '完成登录',
      refresh: '刷新',
      logout: '退出登录',
      models: '可用模型',
      modelAvailable: '可用',
      noModels: '暂无可用模型，请联系管理员授权。',
      usageUnavailable: '用量暂不可用',
      limitZero: '额度为 0，模型调用已停用',
      secureUnavailable: '系统安全存储不可用，企业登录已停用。',
      confirmTitle: '确认毕昇平台',
      confirmLead: '确认后会停用当前企业模型连接，并在该平台新建一次 PKCE 登录。',
      insecureTitle: '确保服务地址可信',
      insecureLead: '登录信息会明文传输，确保以下服务地址由可信来源提供。',
      confirm: '确认并登录',
      insecureConfirm: '确认为可信来源',
      cancel: '取消',
      invalid_grant: '本次登录授权已失效，请重新发起登录。',
      pkce_verification_failed: '登录验证失败，请重新发起登录。',
      authorization_expired: '登录授权已过期，请重新登录。',
      authorization_conflict: '本次登录状态发生冲突，请重新发起登录。',
      invalid_access_token: '登录凭证已失效，请重新登录。',
      invalid_refresh_token: '登录已失效，请重新登录。',
      refresh_token_reused: '登录状态已失效，请重新登录。',
      session_expired: '登录会话已过期，请重新登录。',
      session_revoked: '本次登录会话已失效，请重新登录。',
      seat_not_assigned: '你尚未获得客户端使用席位，请联系管理员分配后重新登录。',
      seat_revoked: '你的客户端使用授权已失效，请联系管理员确认席位，重新授权后再登录。',
      seat_limit_reached: '可用席位已满，请联系管理员处理。',
      license_invalid: '平台客户端授权无效，请联系管理员。',
      license_expired: '平台客户端授权已过期，请联系管理员。',
      dsh_disabled: '管理员已关闭客户端功能，请联系管理员。',
      user_disabled: '当前账号不可用，请联系管理员。',
      tenant_unavailable: '账号所属组织暂不可用，请联系管理员。',
      authorization_unavailable: '平台授权服务暂不可用，请稍后重试。',
      too_many_requests: '操作过于频繁，请稍后重试。',
      internal_error: '平台服务异常，请稍后重试或联系管理员。',
      access_denied: '你已取消本次登录授权。',
      authorization_failed: '本次登录授权失败，请重新发起登录。',
      network_error: '无法连接毕昇平台，请检查地址和网络。',
      invalid_response: '平台响应异常，请检查服务地址或联系管理员。',
      contract_incompatible: '客户端与平台版本不兼容，请联系管理员更新。',
      model_not_allowed: '当前模型未获授权或已不可用，请刷新模型列表或联系管理员。',
      vault_decrypt_failed: '企业登录凭证无法解密。'
    }

    const en = {
      nav: 'Account and security',
      title: 'Account and security',
      managedModels: 'Models provided by your enterprise',
      accountLabel: 'Current account',
      platform: 'Enterprise service URL',
      login: 'Sign in in browser',
      loginAgain: 'Sign in again',
      loggingIn: 'Waiting for browser authorization…',
      learnMore: 'Learn about Enterprise',
      vision: 'Vision',
      visionHint: 'Image input enabled by your enterprise',
      usageLabel: 'Used / limit (tokens)',
      ticket: 'One-time code',
      submitTicket: 'Complete sign-in',
      refresh: 'Refresh',
      logout: 'Sign out',
      models: 'Available models',
      modelAvailable: 'Available',
      noModels: 'No models are available. Ask your administrator to authorize one.',
      usageUnavailable: 'Usage unavailable',
      limitZero: 'Limit is 0; model calls are disabled',
      secureUnavailable: 'Operating-system secure storage is unavailable. Enterprise sign-in is disabled.',
      confirmTitle: 'Confirm BiSheng platform',
      confirmLead: 'Continuing pauses the current enterprise connection and starts a new PKCE login at this platform.',
      insecureTitle: 'Make sure the service URL is trusted',
      insecureLead: 'Sign-in details will be sent in cleartext. Make sure the following service URL comes from a trusted source.',
      confirm: 'Confirm and sign in',
      insecureConfirm: 'Confirm as a trusted source',
      cancel: 'Cancel',
      invalid_grant: 'This sign-in authorization is no longer valid. Start sign-in again.',
      pkce_verification_failed: 'Sign-in verification failed. Start sign-in again.',
      authorization_expired: 'This sign-in authorization has expired. Sign in again.',
      authorization_conflict: 'This sign-in conflicted with another attempt. Start sign-in again.',
      invalid_access_token: 'Your sign-in credential is no longer valid. Sign in again.',
      invalid_refresh_token: 'Your sign-in is no longer valid. Sign in again.',
      refresh_token_reused: 'Your sign-in state is no longer valid. Sign in again.',
      session_expired: 'Your sign-in session has expired. Sign in again.',
      session_revoked: 'This sign-in session is no longer valid. Sign in again.',
      seat_not_assigned: 'You do not have a client seat yet. Ask your administrator to assign one, then sign in again.',
      seat_revoked: 'Your client access is no longer valid. Ask your administrator to confirm the seat, then sign in again after it is authorized.',
      seat_limit_reached: 'No client seats are available. Contact your administrator.',
      license_invalid: 'The platform client license is invalid. Contact your administrator.',
      license_expired: 'The platform client license has expired. Contact your administrator.',
      dsh_disabled: 'An administrator has turned off the client. Contact your administrator.',
      user_disabled: 'This account is unavailable. Contact your administrator.',
      tenant_unavailable: 'Your organization is temporarily unavailable. Contact your administrator.',
      authorization_unavailable: 'The authorization service is temporarily unavailable. Try again later.',
      too_many_requests: 'Too many attempts. Try again later.',
      internal_error: 'The platform service failed. Try again later or contact an administrator.',
      access_denied: 'You cancelled this sign-in.',
      authorization_failed: 'This sign-in authorization failed. Start sign-in again.',
      network_error: 'Could not reach the BiSheng platform. Check the service address and your network.',
      invalid_response: 'The platform returned an unexpected response. Check the service address or contact your administrator.',
      contract_incompatible: 'This client is incompatible with the platform. Ask your administrator to update it.',
      model_not_allowed: 'This model is not authorized or is unavailable. Refresh the model list or contact your administrator.',
      vault_decrypt_failed: 'Enterprise credential vault could not be decrypted.'
    }

    function installStyles() {
      let style = document.getElementById('dsh-desktop-enterprise-style')
      if (!style) {
        style = document.createElement('style')
        style.id = 'dsh-desktop-enterprise-style'
        document.head.appendChild(style)
      }
      style.textContent = `
        .dshEnterprise {
          max-width: 720px;
          color: var(--dsw-alias-label-primary);
        }
        .dshEnterpriseTitleRow {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin: 0 0 8px;
        }
        .dshEnterpriseTitleRow h2 {
          margin: 0;
          flex: 0 0 auto;
          width: auto;
          color: var(--dsw-alias-label-primary);
          font-size: 18px;
          font-weight: 600;
          line-height: normal;
        }
        .dshEnterpriseManagedModels { margin: 16px 0; }
        .dshEnterprise h3 {
          margin: 0 0 8px;
          font-size: 14px;
          font-weight: 500;
          line-height: 22px;
        }
        .dshEnterpriseHint {
          color: var(--ds-text-secondary, #6d7178);
          line-height: 1.55;
        }
        .dshEnterpriseLabel {
          display: grid;
          gap: 7px;
          font-size: 13px;
          font-weight: 650;
        }
        .dshEnterpriseInput {
          box-sizing: border-box;
          width: 100%;
          height: 38px;
          padding: 0 11px;
          border: 1px solid var(--ds-border, #ccd0d5);
          border-radius: 9px;
          color: inherit;
          background: transparent;
          font: inherit;
        }
        .dshEnterpriseActions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }
        .dshEnterpriseButton {
          min-height: 36px;
          padding: 7px 13px;
          border: 1px solid var(--ds-border, #ccd0d5);
          border-radius: 9px;
          color: inherit;
          background: var(--ds-bg-primary, #fff);
          cursor: pointer;
          font: inherit;
          font-weight: 650;
        }
        .dshEnterpriseButton.login {
          border-color: var(--ds-border, #ccd0d5);
          color: var(--ds-text-primary, #202124);
          background: transparent;
        }
        .dshEnterpriseButton.primary {
          border-color: #2468f2;
          color: #fff;
          background: #2468f2;
        }
        .dshEnterpriseButton.danger {
          color: #b42318;
        }
        .dshEnterpriseButton:disabled,
        .dshEnterpriseIconButton:disabled {
          opacity: .5;
          cursor: default;
        }
        .dshEnterpriseLearnMoreShell {
          display: inline-flex;
        }
        .dshEnterpriseLearnMore,
        .dshEnterpriseLogout {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 32px;
          padding: 4px 8px;
          border: 0;
          border-radius: 6px;
          color: var(--dsw-alias-label-secondary);
          background: transparent;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .dshEnterpriseLearnMore:hover,
        .dshEnterpriseLogout:hover {
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-interactive-bg-hover);
        }
        .dshEnterpriseLogout:disabled {
          opacity: .5;
          cursor: default;
        }
        .dshEnterpriseLearnMore:focus-visible,
        .dshEnterpriseLogout:focus-visible,
        .dshEnterpriseIconButton:focus-visible {
          outline: 2px solid var(--dsw-alias-label-primary);
          outline-offset: 2px;
        }
        .dshEnterpriseIdentity {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 0 20px;
          border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l4) 40%, transparent);
        }
        .dshEnterpriseAvatar {
          display: grid;
          place-items: center;
          flex: 0 0 38px;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          color: var(--dsw-alias-label-secondary);
          background: var(--dsw-alias-interactive-bg-hover);
        }
        .dshEnterpriseLogout {
          margin-left: auto;
        }
        .dshEnterpriseAccount {
          display: grid;
          gap: 4px;
          min-width: 0;
          font-size: 14px;
          overflow-wrap: anywhere;
        }
        .dshEnterpriseAccountLabel {
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
        }
        .dshEnterpriseSectionHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
        }
        .dshEnterpriseSectionHeader h3 {
          margin: 0;
        }
        .dshEnterpriseIconButton {
          display: inline-flex;
          width: 32px;
          height: 32px;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          border-radius: 6px;
          color: var(--dsw-alias-label-secondary);
          background: transparent;
          cursor: pointer;
          font: 18px/1 system-ui;
        }
        .dshEnterpriseIconButton:hover {
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-interactive-bg-hover);
        }
        .dshEnterprisePending {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 14px;
        }
        .dshEnterprisePendingSpinner {
          display: inline-block;
          font: 18px/1 system-ui;
          animation: dshEnterprisePendingSpin .8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .dshEnterprisePendingSpinner {
            animation: none;
          }
        }
        @keyframes dshEnterprisePendingSpin {
          to { transform: rotate(360deg); }
        }
        .dshEnterpriseModels {
          display: grid;
          margin: 8px 0 0;
          padding: 0;
          list-style: none;
        }
        .dshEnterpriseModels li {
          box-sizing: border-box;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px 20px;
          min-height: 64px;
          padding: 14px 0;
          font-size: 14px;
          line-height: 22px;
        }
        .dshEnterpriseModelIdentity {
          display: grid;
          gap: 4px;
          flex: 1 1 180px;
          min-width: 0;
        }
        .dshEnterpriseModelTitle {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .dshEnterpriseModelStatus {
          display: inline-block;
          flex: 0 0 8px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--dsw-alias-state-success-primary);
        }
        .dshEnterpriseModelDetails {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }
        .dshEnterpriseModelProvider {
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
          line-height: 18px;
        }
        .dshEnterpriseModelName {
          min-width: 0;
          overflow-wrap: anywhere;
          font-weight: 500;
        }
        .dshEnterpriseModelVision {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex: none;
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
          line-height: 18px;
          white-space: nowrap;
        }
        .dshEnterpriseModelVision svg {
          flex: none;
        }
        .dshEnterpriseModelUsage {
          margin-left: auto;
          text-align: right;
          color: var(--dsw-alias-label-secondary);
          font-size: 13px;
          line-height: 20px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .dshEnterpriseModelUsagePercent {
          display: none;
        }
        .dshEnterpriseModels li:hover .dshEnterpriseModelUsageValue {
          display: none;
        }
        .dshEnterpriseModels li:hover .dshEnterpriseModelUsagePercent {
          display: inline;
        }
        .dshEnterpriseModels.paused {
          opacity: .5;
        }
        .dshEnterpriseManual {
          margin-top: 18px;
        }
        .dshEnterpriseError {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 9px;
          color: #b42318;
          background: #fef3f2;
          font-size: 13px;
          line-height: 1.45;
        }
        .dshEnterpriseConfirm {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid #8fb2ff;
          border-radius: 14px;
          background: #edf4ff;
        }
        .dshEnterpriseConfirm strong {
          display: block;
          margin: 12px 0 4px;
          overflow-wrap: anywhere;
        }
        body[data-ds-dark-theme] .dshEnterpriseInput,
        body[data-ds-dark-theme] .dshEnterpriseButton {
          color: #f2f3f5;
          background: #1f2024;
          border-color: #50535c;
        }
        body[data-ds-dark-theme] .dshEnterpriseError {
          color: #ffb4ab;
          background: #421b1b;
        }
        body[data-ds-dark-theme] .dshEnterpriseConfirm {
          background: #17294a;
          border-color: #4779d8;
        }
      `
    }

    const ACCOUNT_CHANGED_EVENT = 'dsh-desktop:enterprise-account-changed'

    const marketZh = {
      tab: '来自企业', intro: '安装企业提供的插件，供当前企业账号使用。', refresh: '刷新',
      loading: '正在读取企业插件…', empty: '企业暂未提供插件，请联系管理员导入。',
      failed: '暂时无法读取企业插件，请重试或联系管理员。', install: '安装', update: '更新',
      installed: '已安装', uninstall: '卸载', enable: '启用', disable: '停用', disabled: '已停用',
      version: '版本', incompatible: '当前系统或版本暂不支持',
      installing: '安装中…', updating: '更新中…', enabling: '启用中…', disabling: '停用中…', uninstalling: '卸载中…', unsupported: '暂不支持', setup: '企业市场暂未就绪，可联系管理员完成配置。'
    }
    const marketEn = {
      tab: 'From enterprise', intro: 'Install plugins provided for your current enterprise account.', refresh: 'Refresh',
      loading: 'Loading enterprise plugins…', empty: 'Your enterprise has no plugins yet. Contact your administrator.',
      failed: 'Enterprise plugins are unavailable. Try again or contact your administrator.', install: 'Install', update: 'Update',
      installed: 'Installed', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable', disabled: 'Disabled',
      version: 'Version', incompatible: 'Unsupported system or Desktop version',
      installing: 'Installing…', updating: 'Updating…', enabling: 'Enabling…', disabling: 'Disabling…', uninstalling: 'Uninstalling…', unsupported: 'Unavailable', setup: 'The enterprise market is not ready. Contact your administrator.'
    }

    let marketTranslate
    function marketLabels() { return Object.fromEntries(Object.keys(marketEn).map(key => [key, marketTranslate(key)])) }

    function installMarketStyles() {
      if (document.getElementById('dsh-enterprise-market-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-enterprise-market-style'
      style.textContent = `
        .dshEnterpriseMarket{color:var(--dsw-alias-label-primary);display:grid;gap:18px;min-width:0;container-type:inline-size}
        .dshEnterpriseMarketHead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.dshEnterpriseMarketHead strong{font-size:15px;overflow-wrap:anywhere}.dshEnterpriseMarket p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}.dshEnterpriseMarketHead p{margin-top:5px}.dshEnterpriseMarketHead button{flex-shrink:0}
        .dshEnterpriseMarketList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:stretch}.dshEnterpriseMarketCard{box-sizing:border-box;min-width:0;min-height:180px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-3);display:flex;flex-direction:column;gap:12px}.dshEnterpriseMarketCardHead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.dshEnterpriseMarketCardTitle{min-width:0;flex:1}.dshEnterpriseMarketCard h3{margin:2px 0 4px;font-size:15px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshEnterpriseMarketPublisher{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshEnterpriseMarketCardControls{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;gap:6px}.dshEnterpriseMarketCardControls>.primary{min-width:62px;text-align:center}.dshEnterpriseMarketDescription{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;min-height:42px}.dshEnterpriseMarketCardFooter{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}.dshEnterpriseMarketVersion{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:2px 6px}.dshEnterpriseMarketInstalled{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
        .dshEnterpriseMarketActions{display:flex;align-items:center;gap:6px}.dshEnterpriseMarket button{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 12px;background:transparent;color:inherit}.dshEnterpriseMarket button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dshEnterpriseMarket button:disabled{opacity:.5;cursor:default}.dshEnterpriseMarket button:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}.dshEnterpriseMarket .dshEnterpriseMarketError{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}.dshEnterpriseMarketActions button{padding:4px 8px;white-space:nowrap}
        @container(max-width:480px){.dshEnterpriseMarketList{grid-template-columns:minmax(0,1fr)}}
      `
      document.head.appendChild(style)
    }

    function EnterpriseMarketTab({ account }) {
      const marketCopy = marketLabels()
      const [catalog, setCatalog] = useState(null)
      const [loading, setLoading] = useState(true)
      const [operations, setOperations] = useState({})
      const pendingPlugins = React.useRef(new Set())
      const [error, setError] = useState('')
      const request = React.useRef(null)
      const mounted = React.useRef(true)
      const identity = `${account.base}|${account.tenant.id}|${account.user.id}`
      const refresh = useCallback(async () => {
        request.current?.abort()
        const controller = new AbortController(); request.current = controller
        setLoading(true); setError('')
        try {
          let page = 1, all = [], next
          do {
            if (page > 100) throw new Error('Enterprise catalog page limit exceeded.')
            next = await api(`/api/enterprise.market.catalog?page=${page}`, undefined, controller.signal)
            if (!Array.isArray(next.data) || !Number.isSafeInteger(next.total) || next.total < 0 || next.total > 10000) throw new Error('Invalid enterprise catalog pagination.')
            if (!next.connected || `${next.base}|${next.tenant?.id}|${next.user?.id}` !== identity) throw new Error(marketCopy.failed)
            all.push(...next.data); page += 1
          } while (all.length < next.total && next.data.length)
          if (mounted.current && !controller.signal.aborted) setCatalog({ ...next, data: all })
        } catch (cause) {
          if (mounted.current && !controller.signal.aborted) { setCatalog(null); setError(marketCopy.failed) }
        } finally { if (mounted.current && !controller.signal.aborted) setLoading(false) }
      }, [identity])
      useEffect(() => {
        mounted.current = true; void refresh()
        return () => { mounted.current = false; request.current?.abort() }
      }, [refresh])
      async function operate(action, plugin, version) {
        if (pendingPlugins.current.has(plugin.id)) return
        pendingPlugins.current.add(plugin.id)
        setOperations(current => ({ ...current, [plugin.id]: { action } }))
        try {
          const result = await api('/api/enterprise.market.action', { action, plugin_id: plugin.id, ...(version ? { version_id: version.id } : {}) })
          if (!result.connected || `${result.base}|${result.tenant?.id}|${result.user?.id}` !== identity) throw new Error(marketCopy.failed)
          if (mounted.current) {
            // A completed operation supersedes catalog requests started earlier.
            request.current?.abort(); setLoading(false)
            const local = result.installed.find(item => item.plugin_id === plugin.id)
            setCatalog(current => current && ({ ...current, tenant: result.tenant, user: result.user,
              installed: [...current.installed.filter(item => item.plugin_id !== plugin.id), ...(local ? [local] : [])] }))
          }
        } catch (cause) {
          if (mounted.current) setOperations(current => ({ ...current, [plugin.id]: { error: cause.message || marketCopy.failed } }))
        } finally {
          pendingPlugins.current.delete(plugin.id)
          if (mounted.current) setOperations(current => {
            if (current[plugin.id]?.error) return current
            const next = { ...current }; delete next[plugin.id]; return next
          })
        }
      }
      const installed = new Map((catalog?.installed || []).map(item => [item.plugin_id, item]))
      const available = new Set((catalog?.data || []).map(item => item.id))
      const rows = [...(catalog?.data || []), ...(catalog?.installed || []).filter(item => !available.has(item.plugin_id)).map(item => ({ id: item.plugin_id, display_name: item.display_name, description: item.description, versions: [], installedOnly: true }))]
      const showEmpty = !loading && catalog && !rows.length
      return h('section', { className: 'dshEnterpriseMarket' },
        h('div', { className: 'dshEnterpriseMarketHead' },
          h('div', null, h('strong', null, catalog?.tenant?.name || account.tenant.name), showEmpty ? null : h('p', null, marketCopy.intro)),
          h('button', { type: 'button', disabled: loading, onClick: refresh }, marketCopy.refresh)),
        loading ? h('p', { role: 'status' }, marketCopy.loading) : null,
        error ? h('div', { role: 'alert', className: 'dshEnterpriseMarketError' }, error) : null,
        catalog && !catalog.installReady && !showEmpty ? h('p', null, marketCopy.setup) : null,
        showEmpty ? h('p', null, marketCopy.empty) : null,
        h('div', { className: 'dshEnterpriseMarketList' }, rows.map(plugin => {
          const current = plugin.versions.find(version => version.id === plugin.current_version_id)
          const local = installed.get(plugin.id)
          const metadata = current?.manifest?.plugin
          const supported = current?.compatible === true
          const update = local && current && local.version_id !== current.id
          const operation = operations[plugin.id]
          const activeAction = operation?.action
          const busy = Boolean(activeAction)
          return h('article', { key: plugin.id, className: 'dshEnterpriseMarketCard' },
            h('div', { className: 'dshEnterpriseMarketCardHead' },
              h('div', { className: 'dshEnterpriseMarketCardTitle' },
                h('h3', { title: plugin.display_name }, plugin.display_name),
                metadata?.publisher ? h('div', { className: 'dshEnterpriseMarketPublisher', title: metadata.publisher }, metadata.publisher) : null),
              h('div', { className: 'dshEnterpriseMarketCardControls' },
                (!local || update) && current ? h('button', { type: 'button', className: 'primary', title: supported ? undefined : marketCopy.incompatible, disabled: busy || !supported || !catalog.installReady, 'aria-busy': activeAction === 'install', onClick: () => operate('install', plugin, current) }, activeAction === 'install' ? (update ? marketCopy.updating : marketCopy.installing) : supported ? (update ? marketCopy.update : marketCopy.install) : marketCopy.unsupported) : null,
                local ? h('div', { className: 'dshEnterpriseMarketActions' },
                  h('button', { type: 'button', disabled: busy || (!local.enabled && !catalog.installReady), 'aria-busy': activeAction === 'enable' || activeAction === 'disable', onClick: () => operate(local.enabled ? 'disable' : 'enable', plugin) }, activeAction === 'enable' ? marketCopy.enabling : activeAction === 'disable' ? marketCopy.disabling : local.enabled ? marketCopy.disable : marketCopy.enable),
                  h('button', { type: 'button', disabled: busy, 'aria-busy': activeAction === 'uninstall', onClick: () => operate('uninstall', plugin) }, activeAction === 'uninstall' ? marketCopy.uninstalling : marketCopy.uninstall)) : null)),
            h('p', { className: 'dshEnterpriseMarketDescription', title: plugin.description }, plugin.description),
            (operation?.error || local?.error) ? h('p', { role: 'alert', className: 'dshEnterpriseMarketError' }, operation?.error || local.error) : null,
            h('div', { className: 'dshEnterpriseMarketCardFooter' },
              h('span', { className: 'dshEnterpriseMarketVersion' }, `${marketCopy.version} ${current?.version || local?.version || '—'}`),
              local ? h('span', { className: 'dshEnterpriseMarketInstalled' }, local.enabled ? marketCopy.installed : marketCopy.disabled) : null))

        })))
    }

    function bindEnterpriseMarketTab(ctx) {
      let disposeTab, identity, currentAccount, disposed = false, revision = 0
      const sync = async () => {
        const currentRevision = ++revision
        try {
          const response = await fetch('/api/enterprise.state', { credentials: 'same-origin', cache: 'no-store' })
          if (!response.ok) throw new Error('Enterprise state unavailable')
          const account = await response.json()
          if (disposed || currentRevision !== revision) return
          const next = account.connected && Date.parse(account.sessionExpiresAt) > Date.now() ? `${account.base}|${account.tenant.id}|${account.user.id}` : null
          currentAccount = account
          if (identity === next) return
          disposeTab?.(); disposeTab = undefined; identity = next
          if (next) disposeTab = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
            name: 'settings.plugins.tab', id: 'enterprise-market', order: 20, label: () => marketLabels().tab
          }, () => h(EnterpriseMarketTab, { key: next, account: currentAccount })))
        } catch {
          if (!disposed && currentRevision === revision) { disposeTab?.(); disposeTab = undefined; identity = null }
        }
      }
      const focus = () => { if (document.visibilityState === 'visible') void sync() }
      const timer = window.setInterval(focus, 5000)
      window.addEventListener(ACCOUNT_CHANGED_EVENT, sync)
      window.addEventListener('focus', focus)
      document.addEventListener('visibilitychange', focus)
      void sync()
      return () => {
        disposed = true; revision += 1; disposeTab?.(); window.clearInterval(timer)
        window.removeEventListener(ACCOUNT_CHANGED_EVENT, sync)
        window.removeEventListener('focus', focus)
        document.removeEventListener('visibilitychange', focus)
      }
    }

    async function api(path, body, signal) {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        signal,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        const failure = new Error(payload.error || `Request failed (${response.status})`)
        if (typeof payload.errorCode === 'string' && payload.errorCode) failure.errorCode = payload.errorCode
        throw failure
      }
      if (!path.startsWith('/api/enterprise.market.')) window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
      return payload
    }

    function tokenAmount(value, language) {
      const zhLocale = String(language || '').toLowerCase().startsWith('zh')
      if (!zhLocale) {
        return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
      }
      if (value === 0) return '0'
      if (value < 100) return '<0.01万'
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / 10_000)}万`
    }

    function usageText(usage, language, t) {
      if (!usage || usage.source === 'unavailable' || usage.quota_state === 'unavailable') {
        return t('usageUnavailable')
      }
      if (usage.limit === 0) return t('limitZero')
      if (usage.used === null || usage.limit === null) return t('usageUnavailable')
      return `${tokenAmount(usage.used, language)} / ${tokenAmount(usage.limit, language)}`
    }

    function readLastBase() {
      try {
        return localStorage.getItem(LAST_BASE_KEY) || ''
      } catch {
        return ''
      }
    }

    function rememberBase(value) {
      if (typeof value !== 'string' || !value.trim()) return
      try {
        localStorage.setItem(LAST_BASE_KEY, value.trim())
      } catch {}
    }

    function openEnterpriseSettingsSection() {
      if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
      const dispatch = () => window.dispatchEvent(
        new CustomEvent(OPEN_SETTINGS_SECTION_EVENT, { detail: { id: ENTERPRISE_SECTION_ID } })
      )
      dispatch()
      window.setTimeout(dispatch, 0)
    }

    const LEGACY_ACCOUNT_PHRASES = {
      'seat not assigned': 'seat_not_assigned',
      'seat revoked': 'seat_revoked',
      'dsh seat revoked': 'seat_revoked',
      'session revoked': 'session_revoked',
      'dsh session revoked': 'session_revoked',
      'session expired': 'session_expired',
      'dsh session expired': 'session_expired',
      'invalid access token': 'invalid_access_token',
      'invalid dsh access token': 'invalid_access_token',
      'invalid refresh token': 'invalid_refresh_token',
      'invalid refresh token; sign in again': 'invalid_refresh_token',
      'refresh token reused': 'refresh_token_reused',
      'refresh token reuse detected; sign in again': 'refresh_token_reused',
      'authorization unavailable': 'authorization_unavailable',
      'dsh authorization is temporarily unavailable': 'authorization_unavailable',
      'invalid grant': 'invalid_grant',
      'pkce verification failed': 'pkce_verification_failed',
      'authorization expired': 'authorization_expired',
      'authorization conflict': 'authorization_conflict',
      'user disabled': 'user_disabled',
      'tenant unavailable': 'tenant_unavailable',
      'dsh disabled': 'dsh_disabled',
      'model not allowed': 'model_not_allowed',
      'too many requests': 'too_many_requests',
      'internal error': 'internal_error',
      'could not reach the bisheng platform': 'network_error',
      'bisheng dsh contract version is incompatible with this desktop build': 'contract_incompatible',
      'enterprise credential vault could not be decrypted': 'vault_decrypt_failed'
    }

    function accountErrorCopy(code, t) {
      if (typeof code !== 'string' || !code) return ''
      const value = t(code)
      return typeof value === 'string' && value !== code ? value : ''
    }

    function formatEnterpriseSettingsError(failure, errorCode, t) {
      const text = typeof failure === 'string' ? failure.trim() : ''
      const code = typeof errorCode === 'string' ? errorCode.trim() : ''
      if (code && code !== 'request_failed') {
        const known = accountErrorCopy(code, t)
        if (known) return known
      }
      if (!code || code === 'request_failed') {
        const phrase = text.trim().replace(/\.$/u, '').trim().toLowerCase()
        const legacy = accountErrorCopy(LEGACY_ACCOUNT_PHRASES[phrase], t)
        if (legacy) return legacy
      }
      if (/<[a-z!/][^>]*>/iu.test(text)) return accountErrorCopy('invalid_response', t)
      return text
        .replace(/<[^>]*>/gu, ' ')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 300)
    }

    function failureParts(cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const code = typeof cause === 'object' && cause !== null && typeof cause.errorCode === 'string'
        ? cause.errorCode
        : ''
      return { message, code }
    }

    function modelUsagePercentage(usage, language, t) {
      if (!usage || typeof usage.used !== 'number' || typeof usage.limit !== 'number' || usage.limit <= 0) {
        return usageText(usage, language, t)
      }
      const zhLocale = String(language || '').toLowerCase().startsWith('zh')
      const percentage = Math.min(100, Math.max(0, usage.used / usage.limit * 100))
      const formatted = new Intl.NumberFormat(zhLocale ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(percentage)
      return `${formatted}%`
    }

    function readUiLanguage() {
      return typeof document === 'object' && document.documentElement?.lang
        ? document.documentElement.lang
        : 'en'
    }

    function createVisionIcon() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        h('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z' }),
        h('circle', { cx: 12, cy: 12, r: 3 }))
    }

    function renderLearnMoreButton(t) {
      return h('span', { className: 'dshEnterpriseLearnMoreShell' },
        h('button', {
          className: 'dshEnterpriseLearnMore',
          type: 'button',
          onClick: () => window.open(LEARN_MORE_URL, '_blank', 'noopener,noreferrer')
        }, t('learnMore'), h('span', { 'aria-hidden': 'true' }, '↗')))
    }

    function modelDisplayParts(displayName) {
      const separator = displayName.indexOf(' / ')
      if (separator > 0 && displayName.slice(separator + 3).trim()) {
        return { provider: displayName.slice(0, separator).trim(), name: displayName.slice(separator + 3).trim() }
      }
      return { provider: '', name: displayName }
    }

    function createAccountIcon() {
      return h('svg', {
        width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        'aria-hidden': 'true'
      }, h('circle', { cx: 12, cy: 8, r: 3.5 }),
      h('path', { d: 'M5 21v-2a7 7 0 0 1 14 0v2' }))
    }

    function isModelAvailable(state, usage) {
      return state.modelsAvailable === true
        && usage?.quota_state === 'available'
        && typeof usage.used === 'number'
        && typeof usage.limit === 'number'
        && usage.used >= 0
        && usage.used < usage.limit
    }

    function renderModelRow(model, state, language, t) {
      const display = modelDisplayParts(model.display_name)
      const usage = state.modelUsage?.[model.id]
      const value = usageText(usage, language, t)
      const percentage = modelUsagePercentage(usage, language, t)
      const usageTitle = `${t('usageLabel')}: ${value} · ${percentage}`
      const vision = model.capabilities?.vision === true
        ? h('span', { className: 'dshEnterpriseModelVision', title: t('visionHint') },
          createVisionIcon(),
          t('vision'))
        : null

      return h('li', { key: model.id, title: usageTitle },
        h('span', { className: 'dshEnterpriseModelIdentity' },
          h('span', { className: 'dshEnterpriseModelTitle' },
            h('span', { className: 'dshEnterpriseModelName', title: model.display_name }, display.name),
            isModelAvailable(state, usage) ? h('span', {
              className: 'dshEnterpriseModelStatus', role: 'img',
              title: t('modelAvailable'), 'aria-label': t('modelAvailable')
            }) : null),
          display.provider || vision ? h('span', { className: 'dshEnterpriseModelDetails' },
            display.provider ? h('span', { className: 'dshEnterpriseModelProvider' }, display.provider) : null,
            vision) : null),
        h('span', { className: 'dshEnterpriseModelUsage', 'aria-label': usageTitle },
          h('span', { className: 'dshEnterpriseModelUsageValue' }, value),
          h('span', { className: 'dshEnterpriseModelUsagePercent', 'aria-hidden': 'true' }, percentage)))
    }

    function EnterpriseSection({ t, renderSlot }) {
      const [state, setState] = useState(null)
      const [base, setBase] = useState(readLastBase)
      const [ticket, setTicket] = useState('')
      const [manualFallbackReady, setManualFallbackReady] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [errorCode, setErrorCode] = useState('')
      const [confirmation, setConfirmation] = useState(null)
      const stateRef = useRef(null)
      const clearFailure = () => {
        setError('')
        setErrorCode('')
      }
      const showFailure = (cause) => {
        const failure = failureParts(cause)
        setError(failure.message)
        setErrorCode(failure.code)
      }
      const applyAccountState = useCallback((next) => {
        stateRef.current = next
        setState(next)
        if (next?.connected === true) setConfirmation(null)
      }, [])

      const refreshState = useCallback(async () => {
        const next = await api('/api/enterprise.state')
        applyAccountState(next)
        if (next.base) {
          setBase(next.base)
          rememberBase(next.base)
        }
        return next
      }, [applyAccountState])

      const inspectDeepLink = useCallback(async (url) => {
        setBusy(true)
        clearFailure()
        try {
          const inspected = {
            ...(await api('/api/enterprise.deep-link.inspect', { url })),
            fromDeepLink: true
          }
          const current = stateRef.current
          if (
            current?.base === inspected.base
            && (current.phase === 'authorizing' || current.connected === true)
          ) return
          setConfirmation(inspected)
        } catch (cause) {
          showFailure(cause)
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        refreshState().catch((cause) => {
          showFailure(cause)
        })
        const bridge = window.dshDesktopEnterprise
        if (!bridge?.onLoginLink) return undefined
        return bridge.onLoginLink((url) => {
          openEnterpriseSettingsSection()
          bridge.consumeLoginLink?.()
          void inspectDeepLink(url)
        })
      }, [inspectDeepLink, refreshState])

      useEffect(() => {
        setManualFallbackReady(false)
        setTicket('')
        if (state?.phase !== 'authorizing' || !state?.loginExpiresAt) return undefined
        const timer = window.setTimeout(() => setManualFallbackReady(true), MANUAL_FALLBACK_DELAY_MS)
        return () => window.clearTimeout(timer)
      }, [state?.phase, state?.loginExpiresAt])

      useEffect(() => {
        const phase = state?.phase
        const intervalMs = ['authorizing', 'refreshing'].includes(phase)
          ? 1_000
          : phase === 'connected' || state?.connected
            ? 30_000
            : 60_000
        const timer = window.setInterval(() => {
          refreshState().catch(() => {})
        }, intervalMs)
        return () => window.clearInterval(timer)
      }, [state?.phase, state?.connected, refreshState])

      async function run(operation) {
        setBusy(true)
        clearFailure()
        try {
          await operation()
        } catch (cause) {
          showFailure(cause)
        } finally {
          setBusy(false)
        }
      }

      function openAuthorization(result) {
        window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer')
      }

      const connected = state?.connected === true
      const models = Array.isArray(state?.models) ? state.models : []
      const userLabel = state?.user?.display_name || state?.user?.username || state?.user?.id || '—'
      const language = readUiLanguage()

      const status = connected
        ? h('div', { className: 'dshEnterpriseIdentity' },
          h('span', { className: 'dshEnterpriseAvatar', 'aria-hidden': 'true' }, createAccountIcon()),
          h('div', { className: 'dshEnterpriseAccount' },
            h('span', { className: 'dshEnterpriseAccountLabel' }, t('accountLabel')),
            h('span', null, userLabel)),
          h('button', {
            className: 'dshEnterpriseLogout',
            type: 'button',
            disabled: busy,
            onClick: () => run(async () => {
              const next = await api('/api/enterprise.logout', {})
              setConfirmation(null)
              applyAccountState(next)
            })
          }, t('logout')))
        : null

      const accountContent = connected
        ? h(React.Fragment, null,
          h('div', { className: 'dshEnterpriseSectionHeader' },
            h('h3', null, t('managedModels')),
            h('button', {
              className: 'dshEnterpriseIconButton',
              type: 'button',
              title: t('refresh'),
              'aria-label': t('refresh'),
              disabled: busy,
              onClick: () => run(async () => applyAccountState(await api('/api/enterprise.refresh', {})))
            }, h('span', { 'aria-hidden': 'true' }, '↻'))),
          models.length
            ? h('ul', { className: `dshEnterpriseModels${state.modelsAvailable ? '' : ' paused'}` },
              ...models.map((model) => renderModelRow(model, state, language, t)))
            : h('p', { className: 'dshEnterpriseHint' }, t('noModels')))
        : h(React.Fragment, null,
          h('label', { className: 'dshEnterpriseLabel', style: { marginTop: 16 } },
            t('platform'),
            h('input', {
              className: 'dshEnterpriseInput',
              type: 'url',
              inputMode: 'url',
              autoComplete: 'url',
              placeholder: 'https://bisheng.example.com',
              value: base,
              onChange: (event) => {
                setBase(event.target.value)
                rememberBase(event.target.value)
              }
            })),
          state?.secureStorageAvailable === false
            ? h('p', { className: 'dshEnterpriseError' }, t('secureUnavailable'))
            : h(React.Fragment, null,
              state?.phase === 'authorizing'
                ? h('div', { className: 'dshEnterprisePending', role: 'status', 'aria-live': 'polite' },
                  h('span', null, t('loggingIn')),
                  h('span', { className: 'dshEnterprisePendingSpinner', 'aria-hidden': 'true' }, '↻'))
                : null,
              h('div', { className: 'dshEnterpriseActions' },
                h('button', {
                  className: 'dshEnterpriseButton login',
                  disabled: busy || !base.trim(),
                  onClick: () => run(async () => {
                    rememberBase(base)
                    const inspected = await api('/api/enterprise.base.inspect', { base })
                    if (inspected.insecurePrivateHttp) {
                      setConfirmation({ base: inspected.base, insecurePrivateHttp: true })
                      return
                    }
                    const result = await api('/api/enterprise.login.start', { base: inspected.base })
                    openAuthorization(result)
                    await refreshState()
                  })
                }, state?.phase === 'authorizing' ? t('loginAgain') : t('login')))))

      const manualFallback = !connected && manualFallbackReady
        ? h('div', { className: 'dshEnterpriseManual' },
          h('label', { className: 'dshEnterpriseLabel' },
            t('ticket'),
            h('input', {
              className: 'dshEnterpriseInput',
              type: 'text',
              autoComplete: 'one-time-code',
              value: ticket,
              onChange: (event) => setTicket(event.target.value)
            })),
          h('div', { className: 'dshEnterpriseActions' },
            h('button', {
              className: 'dshEnterpriseButton',
              type: 'button',
              disabled: busy || !ticket.trim(),
              onClick: () => run(async () => {
                applyAccountState(await api('/api/enterprise.login.manual', { identityTicket: ticket.trim() }))
                setTicket('')
              })
            }, t('submitTicket'))))
        : null

      const failure = error
        ? formatEnterpriseSettingsError(error, errorCode, t)
        : formatEnterpriseSettingsError(state?.error, state?.errorCode, t)
      const errorPanel = failure
        ? h('p', { className: 'dshEnterpriseError', role: 'alert' }, failure)
        : null

      const confirmationPanel = confirmation && !connected
        ? h('div', { className: 'dshEnterpriseConfirm', role: 'dialog', 'aria-modal': 'true' },
          h('h3', null, confirmation.insecurePrivateHttp ? t('insecureTitle') : t('confirmTitle')),
          h('p', { className: 'dshEnterpriseHint' }, confirmation.insecurePrivateHttp ? t('insecureLead') : t('confirmLead')),
          h('strong', null, confirmation.base),
          h('div', { className: 'dshEnterpriseActions' },
            h('button', {
              className: 'dshEnterpriseButton primary',
              disabled: busy,
              onClick: () => run(async () => {
                const path = confirmation.fromDeepLink
                  ? '/api/enterprise.deep-link.confirm'
                  : '/api/enterprise.login.start'
                const result = await api(path, {
                  base: confirmation.base,
                  ...(confirmation.insecurePrivateHttp ? { confirmInsecurePrivateHttp: true } : {})
                })
                setConfirmation(null)
                setBase(result.base)
                rememberBase(result.base)
                openAuthorization(result)
                await refreshState()
              })
            }, confirmation.insecurePrivateHttp ? t('insecureConfirm') : t('confirm')),
            h('button', {
              className: 'dshEnterpriseButton',
              disabled: busy,
              onClick: () => setConfirmation(null)
            }, t('cancel'))))
        : null

      return h('section', { className: 'dshEnterprise' },
        h('div', { className: 'dshEnterpriseTitleRow' },
          h('h2', null, t('title')),
          renderLearnMoreButton(t)),
        status,
        connected ? h('section', { className: 'dshEnterpriseManagedModels' }, accountContent) : accountContent,
        manualFallback,
        errorPanel,
        confirmationPanel)
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      installStyles()
      installMarketStyles()
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-desktop-enterprise: copy dictionaries'
      )
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register('settings.enterpriseMarket', { zh: marketZh, en: marketEn }), 'enterprise-market: translations')
      marketTranslate = ctx.locale.bind('settings.enterpriseMarket')
      ctx.effect(() => bindEnterpriseMarketTab(ctx), 'enterprise-market: account-bound plugins tab')
      ctx.effect(() => {
        const bridge = window.dshDesktopEnterprise
        if (!bridge?.onLoginLink) return undefined
        return bridge.onLoginLink(() => openEnterpriseSettingsSection())
      }, 'dsh-desktop-enterprise: open settings on login link')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: ENTERPRISE_SECTION_ID,
        order: 15,
        label: () => t('nav'),
        inject: () => ({ t })
      }, EnterpriseSection))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
