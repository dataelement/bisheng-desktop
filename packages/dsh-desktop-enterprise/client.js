window.__ModuleLoader__.load({
  id: 'dsh-desktop-enterprise',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    let primitives = {}
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') || {}
    } catch {}
    const Fallback = ({ children, ...props }) => h('div', props, children)
    const FallbackButton = ({ children, ...props }) => h('button', props, children)
    const FallbackIcon = (props) => h('span', { 'aria-hidden': 'true', ...props })

    const Button = primitives.Button || FallbackButton
    const SegmentedControl = primitives.SegmentedControl || Fallback
    const Tooltip = primitives.Tooltip || (({ children }) => children)
    const Menu = primitives.Menu || Fallback
    const MenuItemButton = primitives.MenuItemButton || FallbackButton
    const Modal = primitives.Modal || Fallback

    const IconSettingsOutlineRegular = primitives.IconSettingsOutlineRegular || FallbackIcon
    const IconChecklistOutlineRegular = primitives.IconChecklistOutlineRegular || FallbackIcon
    const IconChecklistOutlineMedium = primitives.IconChecklistOutlineMedium || FallbackIcon
    const IconPaperPlaneOutlineMedium = primitives.IconPaperPlaneOutlineMedium || FallbackIcon
    const IconAlarmClockOutlineMedium = primitives.IconAlarmClockOutlineMedium || FallbackIcon
    const IconGaugeOutlineMedium = primitives.IconGaugeOutlineMedium || FallbackIcon
    const IconApiOutlineMedium = primitives.IconApiOutlineMedium || FallbackIcon
    const IconInfoOutlineMedium = primitives.IconInfoOutlineMedium || FallbackIcon
    const IconUserOutlineMedium = primitives.IconUserOutlineMedium || FallbackIcon
    const IconChevronDownOutlineRegular = primitives.IconChevronDownOutlineRegular || FallbackIcon
    const IconCloseOutlineRegular = primitives.IconCloseOutlineRegular || FallbackIcon
    const LAST_BASE_KEY = 'dshDesktopEnterprise.lastBase'
    const MANUAL_FALLBACK_DELAY_MS = 8_000
    const ENTERPRISE_SECTION_ID = 'enterprise-account'
    const LEARN_MORE_URL = 'https://dshdesktop.com/zh/enterprise/deployment/'
    const OPEN_SETTINGS_SECTION_EVENT = 'dsh-desktop:open-settings-section'
    const NS = 'settings.desktopEnterprise'
    const SAFETY_NS = 'enterprise.contentSafety'
    const safetyCopy = {
      zh: {
        CONTENT_FILTERED: '内容包含敏感词，本次请求已停止。',
        CONTENT_CHECK_UNAVAILABLE: '暂时无法检查内容，请稍后重试。'
      },
      en: {
        CONTENT_FILTERED: 'This request was stopped because sensitive words were detected.',
        CONTENT_CHECK_UNAVAILABLE: 'Content checking is temporarily unavailable. Try again later.'
      },
      ja: {
        CONTENT_FILTERED: '制限された語句が検出されたため、このリクエストを停止しました。',
        CONTENT_CHECK_UNAVAILABLE: '現在、コンテンツを確認できません。しばらくしてから再試行してください。'
      }
    }

    function bindContentSafetyLocale(locale) {
      // Cookies are not port scoped; include the full authority in this display-only bridge.
      const name = 'dshEnterpriseSafetyLocale_' + encodeURIComponent(window.location.host.toLowerCase())
      const t = locale.bind(SAFETY_NS)
      const attributes = '; Path=/; SameSite=Strict' + (window.location.protocol === 'https:' ? '; Secure' : '')
      const owner = window.crypto.randomUUID()
      let owned
      let publishedCopy
      const publish = () => {
        const messages = {
          CONTENT_FILTERED: t('CONTENT_FILTERED'),
          CONTENT_CHECK_UNAVAILABLE: t('CONTENT_CHECK_UNAVAILABLE')
        }
        const copy = JSON.stringify(messages)
        if (copy === publishedCopy) return
        const value = encodeURIComponent(JSON.stringify({ owner, messages }))
        document.cookie = name + '=' + value + attributes
        owned = value
        publishedCopy = copy
      }
      publish()
      const unsubscribe = locale.subscribe(publish)
      return () => {
        unsubscribe()
        const current = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))
        if (current === name + '=' + owned) document.cookie = name + '=; Max-Age=0' + attributes
      }
    }

    const zh = {
      seat_not_assigned: '当前服务版本不支持直接登录，请联系管理员升级平台。',
      seat_revoked: '当前登录已失效，请重新登录。',
      seat_limit_reached: '当前平台仍启用了旧版接入限制，请联系管理员升级。',

      nav: '账号与用量',
      title: '账号与用量',
      managedModels: '企业提供的模型',
      accountLabel: '当前账号',
      platform: '企业平台地址',
      signInTitle: '登录企业账号',
      signInIntro: '登录后可使用聊天，以及企业为你授权的模型、工具和技能。',
      platformHelp: '填写你平时访问企业平台的地址，也可以向管理员获取。',
      browserHelp: '下一步将在浏览器中打开企业平台登录页。',
      authorizationHelp: '请在浏览器中完成登录并授权，再回到客户端继续。',
      manualHelp: '已经在浏览器中完成授权？也可以粘贴页面提供的一次性登录码。',
      login: '在浏览器中登录',
      loginAgain: '重新登录',
      loggingIn: '等待浏览器授权…',
      learnMore: '了解企业版',
      openWorkspace: '进入企业工作台',
      unlimitedUsage: '不限额度',
      usedCredits: '已消耗积分',
      totalCredits: '总分配额度',
      vision: '视觉',
      visionHint: '企业已开启图片输入',
      usageLabel: '剩余积分',
      creditsHelp: 'Chat 和 Work 共用积分，每月重置。',
      ticket: '一次性登录码',
      submitTicket: '完成登录',
      refresh: '刷新',
      logout: '退出登录',
      models: '可用模型',
      modelAvailable: '可用',
      noModels: '暂无可用模型，请联系管理员授权。',
      usageUnavailable: '用量暂不可用',
      limitZero: '剩余 0 分',
      secureUnavailable: '系统安全存储不可用，企业登录已停用。',
      confirmTitle: '确认企业平台',
      confirmLead: '确认后将切换到以下企业平台，并在浏览器中登录。',
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
      network_error: '无法连接企业平台，请检查地址和网络。',
      invalid_response: '平台响应异常，请检查服务地址或联系管理员。',
      contract_incompatible: '客户端与平台版本不兼容，请联系管理员更新。',
      model_not_allowed: '当前模型未获授权或已不可用，请刷新模型列表或联系管理员。',
      vault_decrypt_failed: '企业登录凭证无法解密。'
    }

    const en = {
      seat_not_assigned: 'This server uses a legacy sign-in policy. Ask your administrator to upgrade the platform.',
      seat_revoked: 'Your sign-in is no longer valid. Sign in again.',
      seat_limit_reached: 'This server still enforces a legacy access limit. Ask your administrator to upgrade.',

      nav: 'Account and usage',
      title: 'Account and usage',
      managedModels: 'Models provided by your enterprise',
      accountLabel: 'Current account',
      platform: 'Enterprise platform URL',
      signInTitle: 'Sign in to your enterprise account',
      signInIntro: 'Sign in to use Chat and the models, tools, and skills authorized by your organization.',
      platformHelp: 'Enter the URL you normally use for your enterprise platform, or ask your administrator for it.',
      browserHelp: 'The next step opens the enterprise platform sign-in page in your browser.',
      authorizationHelp: 'Complete sign-in and authorization in your browser, then return to the app to continue.',
      manualHelp: 'Already authorized in your browser? You can also paste the one-time code provided on that page.',
      login: 'Sign in in browser',
      loginAgain: 'Sign in again',
      loggingIn: 'Waiting for browser authorization…',
      learnMore: 'Learn about Enterprise',
      openWorkspace: 'Open Enterprise Workspace',
      unlimitedUsage: 'Unlimited',
      usedCredits: 'Used Credits',
      totalCredits: 'Total Allocation',
      vision: 'Vision',
      visionHint: 'Image input enabled by your enterprise',
      usageLabel: 'Credits remaining',
      creditsHelp: 'Chat and Work share credits, reset monthly.',
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
      confirmTitle: 'Confirm enterprise platform',
      confirmLead: 'Continue to switch to this enterprise platform and sign in through your browser.',
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
      network_error: 'Could not reach the enterprise platform. Check the service address and your network.',
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
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin: 0 0 12px;
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
        .dshEnterpriseLoginIntro { margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
        .dshEnterpriseLoginHelp { margin: 8px 0 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
        .dshEnterprisePendingCopy { flex: 1; }
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
        .dshEnterpriseWorkspaceBtn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 0 6px;
          border: 0;
          border-radius: var(--dsw-radius-sm, 6px);
          color: var(--dsw-alias-label-secondary);
          background: transparent;
          font-size: 12px;
          font-weight: 400;
          line-height: 24px;
          text-decoration: none;
          cursor: pointer;
          white-space: nowrap;
          transition: background .15s ease, color .15s ease;
        }
        .dshEnterpriseWorkspaceBtn:hover {
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-interactive-bg-hover);
        }
        .dshEnterpriseWorkspaceBtn:active {
          background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .08));
        }
        .dshEnterpriseWorkspaceBtn:focus-visible {
          outline: 2px solid var(--dsw-alias-label-primary);
          outline-offset: 2px;
        }
        .dshEnterpriseWorkspaceIcon {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          opacity: .75;
        }
        .dshEnterpriseLearnMoreShell {
          display: inline-flex;
        }
        .dshEnterpriseLearnMore {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 0 6px;
          border: 0;
          border-radius: var(--dsw-radius-sm, 6px);
          color: var(--dsw-alias-label-secondary);
          background: transparent;
          font: inherit;
          font-size: 12px;
          font-weight: 400;
          line-height: 24px;
          cursor: pointer;
          white-space: nowrap;
          transition: background .15s ease, color .15s ease;
        }
        .dshEnterpriseLearnMore:hover {
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-interactive-bg-hover);
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
          flex-direction: column;
          gap: 12px;
          padding: 20px 0 28px;
          text-align: center;
        }
        .dshEnterpriseAvatar {
          display: grid;
          place-items: center;
          flex: none;
          width: 64px;
          height: 64px;
          border-radius: 50%;
          font-size: 22px;
          font-weight: 500;
          color: var(--dsw-alias-label-secondary);
          background: var(--dsw-alias-interactive-bg-hover);
        }
        /* Keep sign-out as the final, explicitly destructive account action. */
        .dshEnterprise .dshEnterpriseLogout {
          margin: 16px 0 8px;
          color: var(--dsw-alias-state-error-primary);
        }
        .dshEnterprise .dshEnterpriseLogout:hover:not(:disabled),
        .dshEnterprise .dshEnterpriseLogout:focus-visible:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover-danger);
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
          gap: 8px;
          margin: 12px 0 0;
          padding: 0;
          list-style: none;
        }
        .dshEnterpriseModels li {
          box-sizing: border-box;
          min-width: 0;
          border: .5px solid var(--dsw-alias-settings-card-stroke);
          border-radius: var(--dsw-radius-xl);
          background: var(--dsw-alias-settings-card-fill);
          padding: 12px 14px;
          font-size: 14px;
          line-height: 22px;
        }
        .dshEnterpriseModelIdentity {
          display: grid;
          gap: 2px;
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
        body[data-ds-dark-theme] .dshEnterpriseWorkspaceBtn {
          color: var(--dsw-alias-label-secondary);
          background: transparent;
        }
        body[data-ds-dark-theme] .dshEnterpriseWorkspaceBtn:hover {
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-interactive-bg-hover);
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
      failed: '暂时无法读取企业插件，请重试或联系管理员。',
      protocolMismatch: '当前客户端需要更新后的企业市场，请联系管理员升级服务端。',
      install: '安装', update: '更新',
      installed: '已安装', uninstall: '卸载', enable: '启用', disable: '停用', disabled: '已停用',
      version: '版本', incompatible: '当前系统或版本暂不支持',
      installing: '安装中…', updating: '更新中…', enabling: '启用中…', disabling: '停用中…', uninstalling: '卸载中…', unsupported: '暂不支持', setup: '企业市场暂未就绪，可联系管理员完成配置。'
    }
    const marketEn = {
      tab: 'From enterprise', intro: 'Install plugins provided for your current enterprise account.', refresh: 'Refresh',
      loading: 'Loading enterprise plugins…', empty: 'Your enterprise has no plugins yet. Contact your administrator.',
      failed: 'Enterprise plugins are unavailable. Try again or contact your administrator.',
      protocolMismatch: 'This Desktop requires a newer enterprise market. Ask an administrator to upgrade the server.',
      install: 'Install', update: 'Update',
      installed: 'Installed', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable', disabled: 'Disabled',
      version: 'Version', incompatible: 'Unsupported system or Desktop version',
      installing: 'Installing…', updating: 'Updating…', enabling: 'Enabling…', disabling: 'Disabling…', uninstalling: 'Uninstalling…', unsupported: 'Unavailable', setup: 'The enterprise market is not ready. Contact your administrator.'
    }

    let marketTranslate
    let accountTranslate
    let settingsTranslate = (key) => key
    function marketLabels() { return Object.fromEntries(Object.keys(marketEn).map(key => [key, marketTranslate(key)])) }
    function marketStatusCopy(cause) {
      const code = typeof cause?.errorCode === 'string' ? cause.errorCode : ''
      if (code === 'protocol_mismatch') return marketLabels().protocolMismatch
      if ((code === 'seat_revoked' || code === 'session_expired') && accountTranslate) {
        const known = accountErrorCopy(code, accountTranslate)
        if (known) return known
      }
      return ''
    }

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
      const stateRequest = React.useRef(null)
      const identity = `${account.base}|${account.tenant.id}|${account.user.id}`
      const refresh = useCallback(async () => {
        request.current?.abort(); stateRequest.current?.abort()
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
          if (mounted.current && !controller.signal.aborted) { setCatalog(null); setError(marketStatusCopy(cause) || marketCopy.failed) }
        } finally { if (mounted.current && !controller.signal.aborted) setLoading(false) }
      }, [identity])
      useEffect(() => {
        mounted.current = true; void refresh()
        return () => { mounted.current = false; request.current?.abort(); stateRequest.current?.abort() }
      }, [refresh])
      useEffect(() => {
        const updateRuntimeState = async () => {
          if (pendingPlugins.current.size || stateRequest.current) return
          const controller = new AbortController(); stateRequest.current = controller
          try {
            const next = await api('/api/enterprise.market.state', undefined, controller.signal)
            if (mounted.current && !controller.signal.aborted && !pendingPlugins.current.size && next.connected && Array.isArray(next.installed) &&
                `${next.base}|${next.tenant?.id}|${next.user?.id}` === identity) {
              setCatalog(current => current && ({ ...current, installed: next.installed }))
            }
          } catch {
            // Keep the last plugin state until a later focus or explicit refresh succeeds.
          } finally { if (stateRequest.current === controller) stateRequest.current = null }
        }
        const onFocus = () => { void updateRuntimeState() }
        window.addEventListener('focus', onFocus)
        return () => {
          window.removeEventListener('focus', onFocus)
          stateRequest.current?.abort(); stateRequest.current = null
        }
      }, [identity])
      async function operate(action, plugin, version) {
        if (pendingPlugins.current.has(plugin.id)) return
        pendingPlugins.current.add(plugin.id)
        setOperations(current => ({ ...current, [plugin.id]: { action } }))
        try {
          const result = await api('/api/enterprise.market.action', { action, plugin_id: plugin.id, ...(version ? { version_id: version.id } : {}) })
          if (!result.connected || `${result.base}|${result.tenant?.id}|${result.user?.id}` !== identity) throw new Error(marketCopy.failed)
          if (mounted.current) {
            // A completed operation supersedes catalog requests started earlier.
            request.current?.abort(); stateRequest.current?.abort(); setLoading(false)
            const local = result.installed.find(item => item.plugin_id === plugin.id)
            setCatalog(current => current && ({ ...current, tenant: result.tenant, user: result.user,
              installed: [...current.installed.filter(item => item.plugin_id !== plugin.id), ...(local ? [local] : [])] }))
          }
        } catch (cause) {
          if (mounted.current) setOperations(current => ({ ...current, [plugin.id]: { error: marketStatusCopy(cause) || cause.message || marketCopy.failed } }))
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
      let disposeTab, identity, currentAccount, expiryTimer, disposed = false, revision = 0
      const sync = async () => {
        const currentRevision = ++revision
        try {
          const response = await fetch('/api/enterprise.state', { credentials: 'same-origin', cache: 'no-store' })
          if (!response.ok) throw new Error('Enterprise state unavailable')
          const account = await response.json()
          if (disposed || currentRevision !== revision) return
          const sessionExpires = account.sessionExpiresAt ? Date.parse(account.sessionExpiresAt) : undefined
          const notExpired = sessionExpires === undefined || sessionExpires > Date.now()
          const next = account.connected && notExpired ? `${account.base}|${account.tenant.id}|${account.user.id}` : null
          currentAccount = account
          window.clearTimeout(expiryTimer)
          if (next && sessionExpires !== undefined) expiryTimer = window.setTimeout(() => { void sync() }, Math.min(sessionExpires - Date.now() + 1, 2_147_483_647))
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
      const unsubscribe = window.dshEnterpriseChat?.subscribe?.(() => { void sync() })
      window.addEventListener(ACCOUNT_CHANGED_EVENT, sync)
      window.addEventListener('focus', focus)
      document.addEventListener('visibilitychange', focus)
      void sync()
      return () => {
        disposed = true; revision += 1; disposeTab?.(); unsubscribe?.(); window.clearTimeout(expiryTimer)
        window.removeEventListener(ACCOUNT_CHANGED_EVENT, sync)
        window.removeEventListener('focus', focus)
        document.removeEventListener('visibilitychange', focus)
      }
    }

    function bindEnterpriseModelSync() {
      let pending, disposed = false, resync = false
      const sync = () => {
        if (disposed || document.visibilityState !== 'visible' || pending) return
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 30_000)
        pending = { controller, timeout }
        void api('/api/enterprise.models.refresh', {}, controller.signal).catch(error => {
          if (!disposed && !controller.signal.aborted) console.warn('[enterprise-models] Catalog refresh failed', error)
        }).finally(() => {
          window.clearTimeout(timeout)
          if (pending?.controller === controller) pending = undefined
          if (resync && !disposed) { resync = false; sync() }
        })
      }
      const accountChanged = () => { if (pending) resync = true; else sync() }
      window.addEventListener('focus', sync)
      document.addEventListener('visibilitychange', sync)
      window.addEventListener(ACCOUNT_CHANGED_EVENT, accountChanged)
      sync()
      return () => {
        disposed = true
        pending?.controller.abort()
        window.clearTimeout(pending?.timeout)
        window.removeEventListener('focus', sync)
        document.removeEventListener('visibilitychange', sync)
        window.removeEventListener(ACCOUNT_CHANGED_EVENT, accountChanged)
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
      if (!path.startsWith('/api/enterprise.market.') && path !== '/api/enterprise.models.refresh') window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
      return payload
    }

    function usageText(usage, language, t) {
      if (!usage || usage.source === 'unavailable' || usage.quota_state === 'unavailable') {
        return t('usageUnavailable')
      }
      const formatter = new Intl.NumberFormat(language || 'en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      if (usage.limit === 0) return formatter.format(0)
      if (usage.limit === -1 || (usage.limit === null && usage.used !== null)) return t('unlimitedUsage')
      if (usage.used === null || usage.limit === null) return t('usageUnavailable')
      return formatter.format(Math.max(0, usage.limit - usage.used) / 1_000_000)
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
      'seat not assigned': 'seat_not_assigned',
      'seat revoked': 'seat_revoked',
      'dsh seat revoked': 'seat_revoked',
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
      const usage = state.usage
      const vision = model.capabilities?.vision === true
        ? h('span', { className: 'dshEnterpriseModelVision', title: t('visionHint') },
          createVisionIcon(),
          t('vision'))
        : null

      return h('li', { key: model.id },
        h('span', { className: 'dshEnterpriseModelIdentity' },
          h('span', { className: 'dshEnterpriseModelTitle' },
            h('span', { className: 'dshEnterpriseModelName', title: model.display_name }, display.name),
            isModelAvailable(state, usage) ? h('span', {
              className: 'dshEnterpriseModelStatus', role: 'img',
              title: t('modelAvailable'), 'aria-label': t('modelAvailable')
            }) : null),
          display.provider || vision ? h('span', { className: 'dshEnterpriseModelDetails' },
            display.provider ? h('span', { className: 'dshEnterpriseModelProvider' }, display.provider) : null,
            vision) : null))
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

      const logoutButton = connected && h(Button, {
        variant: 'ghost', size: 'md',
        className: 'dshEnterpriseLogout', disabled: busy,
        onClick: () => run(async () => {
          const next = await api('/api/enterprise.logout', {})
          setConfirmation(null)
          applyAccountState(next)
        })
      }, t('logout'))
      const status = connected
        ? h('div', { className: 'dshEnterpriseIdentity' },
          h('span', { className: 'dshEnterpriseAvatar', 'aria-hidden': 'true' }, String(userLabel).slice(0, 2).toLocaleUpperCase()),
          h('div', { className: 'dshEnterpriseAccount' },
            h('strong', null, userLabel),
            h('span', { className: 'dshEnterpriseAccountLabel' }, state?.user?.username || t('accountLabel'))))
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
              'aria-describedby': 'dsh-enterprise-platform-help',
              placeholder: 'https://bisheng.example.com',
              value: base,
              onChange: (event) => {
                setBase(event.target.value)
                rememberBase(event.target.value)
              }
            })),
          h('p', { id: 'dsh-enterprise-platform-help', className: 'dshEnterpriseLoginHelp' }, t('platformHelp')),
          state?.secureStorageAvailable === false && state?.storageMode !== 'session'
            ? h('p', { className: 'dshEnterpriseError' }, t('secureUnavailable'))
            : h(React.Fragment, null,
              state?.phase === 'authorizing'
                ? h('div', { className: 'dshEnterprisePending', role: 'status', 'aria-live': 'polite' },
                  h('div', { className: 'dshEnterprisePendingCopy' },
                    h('span', null, t('loggingIn')),
                    h('p', { className: 'dshEnterpriseLoginHelp' }, t('authorizationHelp'))),
                  h('span', { className: 'dshEnterprisePendingSpinner', 'aria-hidden': 'true' }, '↻'))
                : h('p', { className: 'dshEnterpriseLoginHelp' }, t('browserHelp')),
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
          h('p', { className: 'dshEnterpriseLoginHelp' }, t('manualHelp')),
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

      const openWorkspaceLink = connected && state?.base
        ? h('a', {
            className: 'dshEnterpriseWorkspaceBtn',
            href: `${state.base.replace(/\/+$/u, '')}/workspace/`,
            target: '_blank',
            rel: 'noopener noreferrer'
          },
            t('openWorkspace'),
            h('span', { className: 'dshEnterpriseWorkspaceIcon', 'aria-hidden': 'true' }, '↗')
          )
        : null

      return h('section', { className: 'dshEnterprise' },
        h('div', { className: 'dshEnterpriseTitleRow' },
          h('h2', null, t(connected ? 'title' : 'signInTitle')),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            openWorkspaceLink,
            renderLearnMoreButton(t))),
        connected ? null : h('p', { className: 'dshEnterpriseLoginIntro' }, t('signInIntro')),
        status,
        connected && (
          typeof renderSlot === 'function'
            ? renderSlot('desktop.account.usage', {
                credits: usageText(state.usage, document.documentElement.lang, t),
                creditsLabel: t('usageLabel'),
                creditsHelp: t('creditsHelp'),
                usage: state.usage,
                models: h('section', { className: 'dshEnterpriseManagedModels' }, accountContent)
              }, {
                fallback: h(Usage, {
                  t: settingsTranslate,
                  credits: usageText(state.usage, document.documentElement.lang, t),
                  creditsLabel: t('usageLabel'),
                  creditsHelp: t('creditsHelp'),
                  usage: state.usage,
                  models: h('section', { className: 'dshEnterpriseManagedModels' }, accountContent)
                })
              })
            : h(Usage, {
                t: settingsTranslate,
                credits: usageText(state.usage, document.documentElement.lang, t),
                creditsLabel: t('usageLabel'),
                creditsHelp: t('creditsHelp'),
                usage: state.usage,
                models: h('section', { className: 'dshEnterpriseManagedModels' }, accountContent)
              })
        ),
        connected ? logoutButton : accountContent,
        manualFallback,
        errorPanel,
        confirmationPanel)
    }

    const inject = ['slots', 'locale']

    function bindWorkToolChanges() {
      const bridge = window.dshEnterpriseChat
      if (!bridge?.onToolsChanged) return undefined
      const controller = new AbortController()
      const unsubscribe = bridge.onToolsChanged(() => {
        void fetch('/api/enterprise.work-tools', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'refresh' }), signal: controller.signal
        }).then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await response.body?.cancel()
        }).catch(error => {
          if (controller.signal.aborted) return
          console.warn('Enterprise tool refresh failed; the next model request will retry.', error)
        })
      })
      return () => { unsubscribe(); controller.abort() }
    }

    const DESKTOP_SETTINGS_NS = 'desktop.settings'
    const DESKTOP_SETTINGS_COPY = {
      zh: {
        accountMenu: '账号菜单', enterpriseAccount: '企业账号', signedOut: '未登录', deviceOnly: '本机模式', signInHint: '登录后可使用企业功能', identityLoading: '正在读取账号…', identityError: '暂时无法读取账号', settings: '设置', accountSettings: '账号设置', approvals: '消息', approvalsPending: '待处理审批', phone: '连接手机', login: '登录企业账号', logout: '退出登录', logoutBody: '退出后需要重新登录企业账号。本机设置、已安装插件和本地数据保留。', logoutFailed: '退出登录未完成，请重试。', cancel: '取消', again: '重试', close: '关闭', loggingOut: '正在退出登录…',
        creditsRemaining: '剩余积分', creditsUnavailable: '积分暂不可用',
        activity: '用量活动', period: '统计范围：{start} — {end}', less: '少', more: '多', totalTokens: '累计 Token', totalMessages: '累计消息',
        tokenWan: '{value}万', tokenYi: '{value}亿', numberLocale: 'zh-CN', modelUsage: '模型用量', tokens: 'Token 用量', messages: '消息数', storage: '个人存储空间', unlimited: '不限', storageValue: '已使用 {used} / {limit}', breakdown: '输入 {input} Token · 输出 {output} Token', missingUsage: '{count} 条记录缺少 Token 用量', usageError: '用量统计加载失败，请重试。', storageError: '存储空间加载失败，请重试。', noUsage: '暂无用量记录', unavailable: '—',
        openContent: '进入设置内容', usage: '用量与存储', about: '关于与帮助', tasks: '我的审批', requests: '我的申请', notifications: '通知', ai: 'AI 助手接入', loading: '正在加载企业设置…', error: '暂时无法加载企业设置，请检查连接后重试。', restart: '请完全退出并重新启动客户端，以启用统一设置。', unsupported: '平台暂不支持统一设置，请联系管理员更新平台。', retry: '重新连接', signIn: '登录企业账号后可查看', openAccount: '前往账号设置', desktopVersion: 'BISHENG 版本', harnessVersion: 'Harness 版本', infoError: '无法读取版本信息', update: '检查更新', logs: '查看日志', recovery: '安全模式与插件恢复', localHint: '本机设置仍可正常使用。', actionError: '操作未完成，请重试。',
      },
      en: {
        accountMenu: 'Account menu', enterpriseAccount: 'Enterprise account', signedOut: 'Not signed in', deviceOnly: 'Device only', signInHint: 'Sign in to use enterprise features', identityLoading: 'Loading account…', identityError: 'Account unavailable', settings: 'Settings', accountSettings: 'Account settings', approvals: 'Messages', approvalsPending: 'Pending approvals', phone: 'Connect phone', login: 'Sign in', logout: 'Log out', logoutBody: 'You will need to sign in again. Device settings, installed plugins and local data are kept.', logoutFailed: 'Logout did not complete. Try again.', cancel: 'Cancel', again: 'Retry', close: 'Close', loggingOut: 'Logging out…',
        creditsRemaining: 'Credits remaining', creditsUnavailable: 'Credits unavailable',
        activity: 'Usage activity', period: 'Reporting period: {start} — {end}', less: 'Less', more: 'More', totalTokens: 'Total tokens', totalMessages: 'Total messages',
        tokenWan: '{value} ten thousand', tokenYi: '{value} hundred million', numberLocale: 'en-US', modelUsage: 'Model usage', tokens: 'Token usage', messages: 'Messages', storage: 'Personal storage', unlimited: 'Unlimited', storageValue: 'Used {used} / {limit}', breakdown: 'Input {input} tokens · Output {output} tokens', missingUsage: '{count} records are missing token usage', usageError: 'Usage statistics failed to load. Please retry.', storageError: 'Storage failed to load. Please retry.', noUsage: 'No usage recorded', unavailable: '—',
        openContent: 'Enter settings content', usage: 'Usage and storage', about: 'About and help', tasks: 'My approvals', requests: 'My requests', notifications: 'Notifications', ai: 'AI assistant access', loading: 'Loading enterprise settings…', error: 'Enterprise settings could not load. Check the connection and try again.', restart: 'Quit and restart the desktop app to enable unified settings.', unsupported: 'This platform does not support unified settings yet. Ask your administrator to update it.', retry: 'Reconnect', signIn: 'Sign in to view enterprise settings', openAccount: 'Open account settings', desktopVersion: 'BISHENG version', harnessVersion: 'Harness version', infoError: 'Could not read version information', update: 'Check for updates', logs: 'Show logs', recovery: 'Safe Mode and plugin recovery', localHint: 'Device settings remain available.', actionError: 'The action did not complete. Try again.',
      }
    }

    const openAccount = () => window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: ENTERPRISE_SECTION_ID } }))

    function navigateSections(event, ids, active, select, refs) {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !ids.length) return
      event.preventDefault()
      const index = Math.max(0, ids.indexOf(active))
      const next = ids[event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + ids.length) % ids.length]
      select(next); refs.current[next]?.focus()
    }

    function RemoteSettings({ section, t }) {
      const target = useRef(null)
      const [state, setState] = useState({ phase: 'idle', connected: false })
      const [failed, setFailed] = useState(false)
      const alive = useRef(true)
      useEffect(() => {
        const bridge = window.dshEnterpriseChat
        if (!bridge) return
        alive.current = true
        let disposed = false, revision = 0
        const receive = next => { revision++; if (!disposed) setState(next) }
        const unsubscribe = bridge.subscribe(receive)
        const request = revision
        void bridge.state().then(next => { if (!disposed && request === revision) receive(next) }).catch(() => { if (!disposed && request === revision) setFailed(true) })
        return () => { disposed = true; alive.current = false; unsubscribe() }
      }, [])
      useEffect(() => {
        if (!state.connected || state.settingsProtocolVersion !== 1 || !target.current) return
        const token = `${section}:${Math.random()}`
        const node = target.current
        const publish = () => {
          const rect = node.getBoundingClientRect()
          const clip = node.closest('[data-dsh-settings-content], [data-dsh-approvals-content]')?.getBoundingClientRect() || rect
          const x = Math.max(rect.x, clip.x), y = Math.max(rect.y, clip.y)
          window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { token, section, bounds: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(0, Math.min(rect.right, clip.right) - x), height: Math.max(0, Math.min(rect.bottom, clip.bottom) - y) } } }))
        }
        const resize = new ResizeObserver(publish)
        resize.observe(node)
        const clip = node.closest('[data-dsh-settings-content], [data-dsh-approvals-content]')
        if (clip) resize.observe(clip)
        window.addEventListener('resize', publish)
        window.addEventListener('scroll', publish, true)
        publish()
        return () => {
          resize.disconnect(); window.removeEventListener('resize', publish); window.removeEventListener('scroll', publish, true)
          window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { token, close: true } }))
        }
      }, [section, state.connected, state.settingsProtocolVersion])
      useEffect(() => {
        const focus = event => {
          if (event.detail?.section !== section) return
          const approvals = target.current?.closest('[data-dsh-approvals]')
          if (approvals) {
            approvals.querySelector(event.detail.direction === 'previous' ? '[data-dsh-approvals-nav] [aria-current=true]' : '[data-dsh-approvals-close]')?.focus()
          } else {
            document.querySelector(event.detail.direction === 'previous' ? '[data-dsh-settings-section] [aria-current="true"]' : '[data-dsh-settings-close]')?.focus()
          }
        }
        window.addEventListener('dsh-desktop:settings-focus', focus)
        return () => window.removeEventListener('dsh-desktop:settings-focus', focus)
      }, [section])
      const failure = failed || state.settingsFailure || state.phase === 'error'
      const supported = state.settingsProtocolVersion === 1
      const ready = supported && state.settingsSection === section && state.settingsReady
      return h('div', { ref: target, className: 'dshSettingsRemote', tabIndex: ready ? 0 : -1, role: 'group', 'aria-label': t('openContent'), onFocus: () => { if (ready) void window.dshEnterpriseChat.focusSettings().catch(() => { if (alive.current) setFailed(true) }) }, 'aria-busy': state.connected && supported && !ready && !failure },
        !state.connected ? h('div', { className: 'dshSettingsStatus' },
          h('p', null, t('signIn')), h('p', { className: 'dshSettingsHint' }, t('localHint')),
          h('button', { type: 'button', onClick: openAccount }, t('openAccount')))
          : !supported ? h('div', { className: 'dshSettingsStatus', role: 'status' }, h('p', null, t('restart')))
          : !ready && h('div', { className: 'dshSettingsStatus', role: failure ? 'alert' : 'status' },
            h('p', null, t(state.settingsFailure === 'unsupported' ? 'unsupported' : failure ? 'error' : 'loading')),
            failure && h('button', { type: 'button', onClick: () => { setFailed(false); setState(previous => ({ ...previous, phase: 'loading', settingsFailure: undefined, settingsReady: false })); void window.dshEnterpriseChat.retry().catch(() => { if (alive.current) setFailed(true) }) } }, t('retry'))))
    }

    function Usage({ t, credits, creditsLabel, creditsHelp, models, usage }) {
      const [state, setState] = useState(() => (typeof window !== 'undefined' && window.dshEnterpriseChat ? { phase: 'loading' } : { phase: 'web' }))
      const [metric, setMetric] = useState('tokens')
      const [attempt, setAttempt] = useState(0)
      const id = React.useId()
      useEffect(() => {
        let disposed = false, revision = 0, identity, phase, pending = false
        const bridge = window.dshEnterpriseChat
        const receive = (next, requested = false) => {
          if (!bridge?.usage) { setState({ phase: 'unsupported' }); return }
          const key = `${next.epoch}:${next.connected}`
          const changed = key !== identity
          const ready = next.phase === 'ready' && phase !== 'ready'
          identity = key
          phase = next.phase
          if (changed) { revision++; pending = false }
          if (!next.connected) { setState({ phase: 'signedOut' }); return }
          if (next.phase === 'error' && !requested) { setState({ phase: 'error' }); return }
          if (pending || (!changed && !ready && !requested)) return
          const request = ++revision
          pending = true
          setState({ phase: 'loading' })
          void bridge.usage().then(data => {
            if (!disposed && request === revision) { pending = false; setState({ phase: 'ready', data }) }
          }).catch(() => {
            if (!disposed && request === revision) { pending = false; setState({ phase: 'error' }) }
          })
        }
        const unsubscribe = bridge?.subscribe(next => { if (!disposed) receive(next) })
        const initial = revision
        if (!bridge) setState({ phase: 'web' })
        else if (bridge.usage) void bridge.state().then(next => { if (!disposed && initial === revision) receive(next, true) }).catch(() => { if (!disposed && initial === revision) setState({ phase: 'error' }) })
        else setState({ phase: 'unsupported' })
        return () => { disposed = true; revision++; unsubscribe?.() }
      }, [attempt])
      const locale = t('numberLocale')
      const amount = value => value == null ? t('unavailable') : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(value)
      const tokenAmount = value => {
        if (value == null) return t('unavailable')
        if (locale.startsWith('zh')) {
          const hundredMillion = value >= 100_000_000
          return t(hundredMillion ? 'tokenYi' : 'tokenWan', { value: (value / (hundredMillion ? 100_000_000 : 10_000)).toFixed(1) })
        }
        return new Intl.NumberFormat(locale, { notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
      }
      const size = (value, unit) => `${Number((unit === 'MB' ? value * 1024 : value).toFixed(2))} ${unit}`
      const data = state.data?.summary.status === 'ready' ? state.data.summary.data : null
      const storage = state.data?.storage
      const quota = storage?.status === 'ready' ? storage.data : null
      const unit = (quota?.limit === -1 ? quota.used : quota?.limit) < 1 ? 'MB' : 'GB'
      const failure = key => h('div', { className: 'dshSettingsStatus', role: 'alert' }, h('p', null, t(key)), h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, t('again')))
      let content
      if (state.phase === 'web') {
        const items = [
          [creditsLabel, credits ?? t('unavailable'), creditsHelp]
        ]
        if (usage && typeof usage.used === 'number') {
          items.push([accountTranslate?.('usedCredits') || '已消耗积分', amount(usage.used), ''])
        }
        if (usage && typeof usage.limit === 'number' && usage.limit > 0) {
          items.push([accountTranslate?.('totalCredits') || '总分配额度', amount(usage.limit), ''])
        } else if (usage && (usage.limit === -1 || (usage.limit === null && typeof usage.used === 'number'))) {
          items.push([accountTranslate?.('totalCredits') || '总分配额度', accountTranslate?.('unlimitedUsage') || '不限额度', ''])
        }
        content = h('dl', { className: 'dshUsageOverview' },
          ...items.map(([label, count, help], index) =>
            h('div', { key: index, title: help },
              h('dt', null, label),
              h('dd', null, count)
            )
          )
        )
      }
      else if (state.phase === 'signedOut') content = h('div', { className: 'dshSettingsStatus' }, h('p', null, t('signIn')), h('button', { type: 'button', onClick: openAccount }, t('openAccount')))
      else if (state.phase !== 'ready') content = h('div', { className: 'dshSettingsStatus', role: state.phase === 'error' ? 'alert' : 'status' }, h('p', null, t(state.phase === 'unsupported' ? 'restart' : state.phase === 'error' ? 'usageError' : 'loading')), state.phase === 'error' && h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, t('again')))
      else if (!data) content = failure('usageError')
      else {
        const value = point => metric === 'tokens' ? point.total_tokens : point.message_count
        const max = Math.max(1, ...data.points.map(point => value(point) || 0))
        const first = data.points[0]
        const offset = first ? new Date(`${first.start_at.slice(0, 10)}T00:00:00Z`).getUTCDay() : 0
        const months = []
        let previousMonth
        data.points.forEach((point, index) => {
          const date = point.start_at.slice(0, 10), month = date.slice(0, 7)
          if (month !== previousMonth) {
            months.push({ date: new Date(`${date}T00:00:00Z`), column: Math.floor((index + offset) / 7) + 1 })
            previousMonth = month
          }
        })
        const visibleMonths = months.filter((month, index) => !months[index + 1] || months[index + 1].column - month.column >= 3)
        const columns = Math.max(1, Math.ceil((data.points.length + offset) / 7))
        content = h(React.Fragment, null,
          h('dl', { className: 'dshUsageOverview' },
            ...[[creditsLabel, credits, creditsHelp], [t('totalTokens'), tokenAmount(data.totals.total_tokens)], [t('totalMessages'), amount(data.totals.message_count)]].map(([label, count, help], index) => h('div', { key: index, title: help }, h('dt', null, label), h('dd', null, count ?? t('unavailable'))))),
          first && h('p', { className: 'dshSettingsHint dshUsagePeriod' }, t('period', { start: first.start_at.slice(0, 10), end: data.points[data.points.length - 1].start_at.slice(0, 10) })),
          h('section', { className: 'dshUsageModel' },
            h('header', { className: 'dshUsageHeader' }, h('h3', null, t('activity')), h(SegmentedControl, { id, value: metric, label: t('modelUsage'), options: [{ value: 'tokens', label: t('tokens') }, { value: 'messages', label: t('messages') }], onChange: setMetric })),
            h('div', { id: `${id}-${metric}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-${metric}`, tabIndex: 0 },
              h('div', { className: 'dshUsageCalendarScroll' },
                h('div', { className: 'dshUsageMonths', style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }, 'aria-hidden': true }, ...visibleMonths.map(({ date, column }) => h('span', { key: date.toISOString(), style: { gridColumn: `${column} / span ${Math.min(3, columns - column + 1)}`, gridRow: 1 } }, new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date)))),
                h('div', { className: 'dshUsageGrid', role: 'list', 'aria-label': t(metric), style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } }, ...data.points.map((point, index) => {
                  const count = value(point)
                  const label = `${point.start_at.slice(0, 10)} · ${t(metric)}: ${metric === 'tokens' ? tokenAmount(count) : count == null ? t('unavailable') : count.toLocaleString(locale)}`
                  return h(Tooltip, { key: point.start_at, label, side: 'top', portal: true },
                    h('div', { role: 'listitem', tabIndex: 0, 'aria-label': label, className: 'dshUsageDay', 'data-level': count == null ? 'unknown' : count === 0 ? 0 : Math.max(1, Math.ceil(count / max * 4)), style: { gridColumn: Math.floor((index + offset) / 7) + 1, gridRow: (index + offset) % 7 + 1 } }))
                }))),
              !data.points.some(point => (value(point) || 0) > 0) && h('p', { className: 'dshSettingsHint' }, t('noUsage')),
              h('div', { className: 'dshUsageFooter' },
                h('p', { className: 'dshSettingsHint', style: { visibility: metric === 'tokens' ? 'visible' : 'hidden' }, 'aria-hidden': metric !== 'tokens' }, t('breakdown', { input: tokenAmount(data.totals.input_tokens), output: tokenAmount(data.totals.output_tokens) })),
                h('div', { className: 'dshUsageLegend', 'aria-hidden': true }, t('less'), ...[0, 1, 2, 3, 4].map(level => h('span', { key: level, className: 'dshUsageDay', 'data-level': level })), t('more'))),
              data.totals.missing_usage_count > 0 && h('p', { role: 'status', className: 'dshSettingsHint' }, t('missingUsage', { count: data.totals.missing_usage_count })))),
        )
      }
      return h('section', { className: 'dshSettingsSection dshUsage', 'aria-busy': state.phase === 'loading' },
        content,
        models,
        storage?.status === 'error' ? failure('storageError') : storage?.status === 'ready' && h(React.Fragment, null,
          h('div', { className: 'dshUsageStorage' }, h('span', null, t('storage')), h('span', null, quota ? t('storageValue', { used: size(quota.used, unit), limit: quota.limit === -1 ? t('unlimited') : size(quota.limit, unit) }) : t('unavailable'))),
          quota && quota.limit !== -1 && h('progress', { className: 'dshUsageProgress', value: quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 1, max: 1, 'aria-label': t('storage') })))
    }

    function AiAccess({ t }) { return h('section', { className: 'dshSettingsSection' }, h('h2', null, t('ai')), h(RemoteSettings, { section: 'ai-access', t })) }
    const APPROVAL_SECTIONS = [['my-tasks', 'tasks'], ['my-requests', 'requests'], ['notifications', 'notifications']]

    function approvalsIcon(id) {
      if (id === 'my-requests') return h(IconPaperPlaneOutlineMedium, { className: 'dshApprovalsNavIcon', size: 16 })
      if (id === 'notifications') return h(IconAlarmClockOutlineMedium, { className: 'dshApprovalsNavIcon', size: 16 })
      return h(IconChecklistOutlineMedium, { className: 'dshApprovalsNavIcon', size: 16 })
    }

    function ApprovalsPanel({ onClose, t }) {
      const titleId = React.useId()
      const refs = useRef({})
      const [section, setSection] = useState('my-tasks')
      return h('div', { 'data-dsh-approvals': '', className: 'dshApprovalsPanel' },
        h('nav', { 'data-dsh-approvals-nav': '', className: 'dshApprovalsNav', 'aria-labelledby': titleId },
          h('div', { className: 'dshApprovalsNavTitle', id: titleId }, t('approvals')),
          h('div', { className: 'dshApprovalsNavList', onKeyDown: event => navigateSections(event, APPROVAL_SECTIONS.map(([id]) => id), section, setSection, refs) },
            ...APPROVAL_SECTIONS.map(([id, key]) => h('button', { key: id, ref: node => { refs.current[id] = node }, type: 'button', className: 'dshApprovalsNavCell', 'aria-current': section === id ? 'true' : undefined, 'data-modal-autofocus': section === id ? '' : undefined, onClick: () => setSection(id) },
              approvalsIcon(id), h('span', { className: 'dshApprovalsNavLabel' }, t(key)))))),
        h('div', { className: 'dshApprovalsContent' },
          h('div', { className: 'dshApprovalsHeader' },
            h('button', { type: 'button', className: 'dshApprovalsClose', 'data-dsh-approvals-close': '', 'aria-label': t('close'), onClick: onClose }, h(IconCloseOutlineRegular, { size: 14 }))),
          h('div', { 'data-dsh-approvals-content': '', className: 'dshApprovalsOptions' }, h(RemoteSettings, { key: section, section, t }))))
    }

    function About({ t }) {
      const [info, setInfo] = useState()
      const alive = useRef(true)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        let disposed = false
        alive.current = true
        void window.dshDesktop?.settingsInfo?.().then(value => { if (!disposed) setInfo(value) }).catch(() => { if (!disposed) setError('infoError') })
        return () => { disposed = true; alive.current = false }
      }, [])
      const run = async action => {
        setBusy(true); setError('')
        try { await window.dshDesktop.settingsAction(action) }
        catch { if (alive.current) setError('actionError') }
        finally { if (alive.current) setBusy(false) }
      }
      return h('section', { className: 'dshSettingsSection' },
        h('h2', null, t('about')),
        h('dl', { className: 'dshSettingsVersions' }, ...[['desktopVersion', info?.desktopVersion], ['harnessVersion', info?.harnessVersion]].flatMap(([key, value]) => [h('dt', { key: `${key}:label` }, t(key)), h('dd', { key }, value || '—')])),
        typeof window.dshDesktop?.settingsAction === 'function' && h('div', { className: 'dshSettingsButtons' },
          ...[['check-for-updates', 'update'], ['show-harness-log', 'logs'], ['safe-mode', 'recovery']].map(([action, label]) => h('button', { key: action, type: 'button', disabled: busy, onClick: () => run(action) }, t(label)))),
        error && h('p', { role: 'alert' }, t(error)))
    }

    async function accountRequest(operation, signal) {
      const path = operation === 'logout' ? '/api/enterprise.logout' : '/api/enterprise.state'
      const response = await fetch(path, { credentials: 'same-origin', signal, ...(operation === 'logout' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : {}) })
      const result = await response.json()
      if (!response.ok || !result || typeof result !== 'object' || typeof result.connected !== 'boolean' || result.ok === false || (operation === 'logout' && result.connected)) throw new Error('Enterprise account request failed')
      return result
    }

    function useAccountIdentity() {
      const [account, setAccount] = useState()
      const [error, setError] = useState(false)
      const [busy, setBusy] = useState(false)
      const lifetime = useRef({ alive: true, revision: 0, request: undefined })
      const refresh = useCallback(async () => {
        const current = lifetime.current
        current.request?.abort()
        const request = new AbortController(), revision = ++current.revision
        current.request = request
        try {
          const next = await accountRequest('state', request.signal)
          if (current.alive && revision === current.revision) { setAccount(next); setError(false) }
        } catch {
          if (current.alive && revision === current.revision && !request.signal.aborted) setError(true)
        }
      }, [])
      useEffect(() => {
        lifetime.current.alive = true
        const changed = () => { void refresh() }
        let identity
        const unsubscribe = window.dshEnterpriseChat?.subscribe(next => {
          const key = `${next.epoch}:${next.connected}`
          if (key === identity) return
          identity = key
          if (!next.connected) setAccount({ connected: false })
          void refresh()
        })
        window.addEventListener('dsh-desktop:enterprise-account-changed', changed)
        void refresh()
        return () => {
          lifetime.current.alive = false; lifetime.current.revision++; lifetime.current.request?.abort(); lifetime.current.action?.abort()
          unsubscribe?.(); window.removeEventListener('dsh-desktop:enterprise-account-changed', changed)
        }
      }, [refresh])
      const logout = async () => {
        const current = lifetime.current
        current.request?.abort(); current.revision++
        const request = new AbortController()
        current.action = request
        setBusy(true)
        try {
          const next = await accountRequest('logout', request.signal)
          if (current.alive) { setAccount(next); setError(false); window.dispatchEvent(new CustomEvent('dsh-desktop:enterprise-account-changed')) }
        } finally { if (current.alive) setBusy(false) }
      }
      return { account, error, busy, refresh, logout }
    }

    function ApprovalsDialog({ open, onClose, t }) {
      useEffect(() => {
        window.dispatchEvent(new CustomEvent('dsh-desktop:approvals-visibility', { detail: { open } }))
        return () => window.dispatchEvent(new CustomEvent('dsh-desktop:approvals-visibility', { detail: { open: false } }))
      }, [open])
      return h(Modal, { open, onClose, title: t('approvals'), headless: true, className: 'dshApprovalsDialog' },
        open && h(ApprovalsPanel, { onClose, t }))
    }

    function AccountAvatar({ name }) {
      return h('span', { className: 'dshAccountAvatar', 'aria-hidden': 'true' }, name ? Array.from(name).slice(0, 2).join('').toLocaleUpperCase() : h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('circle', { cx: 12, cy: 8, r: 4 }), h('path', { d: 'M4 22v-2a8 8 0 0 1 16 0v2' })))
    }

    function AccountMenuIcon({ kind }) {
      const frame = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true' }
      if (kind === 'phone') return h('svg', frame, h('rect', { x: 6, y: 2, width: 12, height: 20, rx: 2 }), h('path', { d: 'M10 5h4M11 19h2' }))
      if (kind === 'account') return h('svg', frame, h('circle', { cx: 12, cy: 8, r: 3.5 }), h('path', { d: 'M5 21a7 7 0 0 1 14 0' }))
      return h('svg', frame, h('path', { d: kind === 'login' ? 'M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l4 4-4 4M3 12h11' : 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M13 7l5 5-5 5M8 12h13' }))
    }

    function AccountBadge({ count }) {
      return h('span', { className: 'dshAccountBadge' }, count > 99 ? '99+' : String(count))
    }

    function useApprovalsPending() {
      const [pending, setPending] = useState(0)
      useEffect(() => {
        const bridge = window.dshEnterpriseChat
        if (!bridge) return undefined
        let disposed = false
        const read = next => {
          if (disposed) return
          const value = next?.connected ? next.navigation?.approvals?.pending : 0
          setPending(Number.isInteger(value) && value > 0 ? value : 0)
        }
        const unsubscribe = bridge.subscribe(read)
        void bridge.state().then(read).catch(() => {})
        return () => { disposed = true; unsubscribe() }
      }, [])
      return pending
    }

    function LogoutDialog({ open, busy, failed, onCancel, onConfirm, t }) {
      useEffect(() => {
        if (!open) return undefined
        const publish = value => window.dispatchEvent(new CustomEvent('dsh-desktop:account-dialog-visibility', { detail: { open: value } }))
        publish(true)
        return () => publish(false)
      }, [open])
      return h(Modal, {
        open, title: t('logout'), closeLabel: t('close'), description: t('logoutBody'), className: 'dshAccountDialog',
        onClose: () => { if (!busy) onCancel() },
        footer: h('div', { className: 'dshAccountDialogActions' },
          h('button', { type: 'button', 'data-modal-autofocus': '', disabled: busy, onClick: onCancel }, t('cancel')),
          h('button', { type: 'button', className: 'dshAccountDialogDanger', 'data-dsh-logout-confirm': '', disabled: busy, onClick: onConfirm }, t(busy ? 'loggingOut' : 'logout')))
      }, failed && h('p', { className: 'dshAccountDialogError', role: 'alert' }, t('logoutFailed')))
    }

    function AccountLauncher({ wide, settingsOpen, openSettings, settingsShortcut, t }) {
      const identity = useAccountIdentity()
      const pending = useApprovalsPending()
      const [menuOpen, setMenuOpen] = useState(false)
      const [approvalsOpen, setApprovalsOpen] = useState(false)
      const [logoutOpen, setLogoutOpen] = useState(false)
      const [logoutFailed, setLogoutFailed] = useState(false)
      const [actionBusy, setActionBusy] = useState(false)
      const [actionError, setActionError] = useState(false)
      const alive = useRef(true)
      const trigger = useRef(null)
      const closeApprovals = useCallback(() => { setApprovalsOpen(false); trigger.current?.focus() }, [])
      const closeLogout = useCallback(() => { setLogoutOpen(false); setLogoutFailed(false); trigger.current?.focus() }, [])
      useEffect(() => {
        alive.current = true
        const close = () => {
          if (approvalsOpen) closeApprovals()
          if (logoutOpen) closeLogout()
        }
        window.addEventListener('dsh-desktop:close-settings', close)
        return () => { alive.current = false; window.removeEventListener('dsh-desktop:close-settings', close) }
      }, [approvalsOpen, logoutOpen, closeApprovals, closeLogout])
      useEffect(() => { if (settingsOpen) { setMenuOpen(false); setApprovalsOpen(false); setLogoutOpen(false); setLogoutFailed(false) } }, [settingsOpen])
      useEffect(() => {
        if (identity.account?.connected === false) { setApprovalsOpen(false); setLogoutOpen(false) }
      }, [identity.account?.connected])
      const name = [identity.account?.user?.display_name, identity.account?.user?.username, identity.account?.user?.id].find(value => typeof value === 'string' && value.trim())
      const label = name || t(identity.account ? 'signedOut' : identity.error ? 'identityError' : 'identityLoading')
      const connected = identity.account?.connected === true
      const quota = identity.account?.usage
      const credits = !identity.error && quota && quota.source !== 'unavailable' && quota.quota_state !== 'unavailable'
        && Number.isFinite(quota.limit) && Number.isFinite(quota.used)
        ? new Intl.NumberFormat(t('numberLocale'), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.max(0, quota.limit - quota.used) / 1_000_000)
        : null
      const busy = actionBusy || identity.busy
      useEffect(() => {
        if (!menuOpen || busy) return undefined
        const close = () => setMenuOpen(false)
        window.addEventListener('blur', close)
        return () => window.removeEventListener('blur', close)
      }, [menuOpen, busy])
      const failure = actionError ? 'actionError' : identity.error ? 'identityError' : undefined
      const pairPhone = async () => {
        if (busy) return
        setActionBusy(true); setActionError(false)
        try {
          await window.dshDesktop.openPhonePairing()
          if (alive.current) { setMenuOpen(false); setApprovalsOpen(false) }
        } catch { if (alive.current) { setActionError(true); setMenuOpen(true) } }
        finally { if (alive.current) setActionBusy(false) }
      }
      const openAccountSettings = () => { setMenuOpen(false); openSettings(); openAccount() }
      const confirmLogout = async () => {
        if (busy) return
        setActionBusy(true); setLogoutFailed(false)
        try {
          await identity.logout()
          if (alive.current) { setLogoutOpen(false); setApprovalsOpen(false); trigger.current?.focus() }
        } catch { if (alive.current) setLogoutFailed(true) }
        finally { if (alive.current) setActionBusy(false) }
      }
      const badge = pending > 0 ? h(AccountBadge, { count: pending }) : null
      const triggerLabel = `${t('accountMenu')}: ${label}${pending > 0 ? ` · ${t('approvalsPending')} ${pending}` : ''}`
      return h('div', { className: 'dshAccountLauncher', 'data-dsh-account-launcher': '' },
        h(Menu, { open: menuOpen, onClose: () => { if (!busy) setMenuOpen(false) }, side: 'top', align: 'start', portal: true, autoFocus: true, className: 'dshAccountMenuAnchor', listClassName: `dshAccountMenu${wide ? ' dshAccountMenuWide' : ''}`,
          anchor: h('button', { ref: trigger, type: 'button', className: `dshAccountTrigger${wide ? '' : ' dshAccountTriggerRail'}`, 'aria-label': triggerLabel, title: wide ? undefined : label, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen, disabled: settingsOpen || busy, onClick: () => { setMenuOpen(previous => !previous); setActionError(false); void identity.refresh() } },
            h('span', { className: 'dshAccountAvatarWrap' }, h(AccountAvatar, { name }), badge),
            wide && h('span', { className: 'dshAccountTriggerCopy' }, h('span', null, label)), wide && h(IconChevronDownOutlineRegular)) },
          h('div', { className: 'dshAccountMenuIdentity' }, h(AccountAvatar, { name }), h('div', null, h('strong', null, label), h('small', null, t(connected ? 'enterpriseAccount' : 'signInHint'))),
            connected && h('div', { className: 'dshAccountMenuCredits', role: 'status' }, h('strong', null, credits ?? '—'), h('small', null, t(credits === null ? 'creditsUnavailable' : 'creditsRemaining')))),
          h(MenuItemButton, { icon: h(IconSettingsOutlineRegular), shortcut: settingsShortcut, disabled: busy, onSelect: () => { setMenuOpen(false); openSettings() } }, t('settings')),
          connected && h(MenuItemButton, { icon: h(AccountMenuIcon, { kind: 'account' }), disabled: busy, onSelect: openAccountSettings }, t('accountSettings')),
          Boolean(window.dshEnterpriseChat) && h(MenuItemButton, { icon: h(IconChecklistOutlineRegular), disabled: busy || !connected, onSelect: () => { setMenuOpen(false); setApprovalsOpen(true) } },
            h('span', { className: 'dshAccountMenuRow' }, t('approvals'), badge)),
          typeof window.dshDesktop?.openPhonePairing === 'function' && h(MenuItemButton, { icon: h(AccountMenuIcon, { kind: 'phone' }), disabled: busy, onSelect: () => { void pairPhone() } }, t('phone')),
          connected
            ? h(MenuItemButton, { icon: h(AccountMenuIcon, { kind: 'logout' }), separatorBefore: true, danger: true, disabled: busy, onSelect: () => { setMenuOpen(false); setLogoutFailed(false); setLogoutOpen(true) } }, t('logout'))
            : h(MenuItemButton, { icon: h(AccountMenuIcon, { kind: 'login' }), separatorBefore: true, disabled: busy, onSelect: openAccountSettings }, t('login')),
          failure && h('p', { className: 'dshAccountMenuError', role: 'alert' }, t(failure)),
          failure && h(MenuItemButton, { disabled: busy, onSelect: () => { if (actionError) { void pairPhone(); return } setActionError(false); void identity.refresh() } }, t('again'))),
        Boolean(window.dshEnterpriseChat) && h(ApprovalsDialog, { open: approvalsOpen, onClose: closeApprovals, t }),
        h(LogoutDialog, { open: logoutOpen, busy, failed: logoutFailed, onCancel: closeLogout, onConfirm: () => { void confirmLogout() }, t }))
    }

    const NAV_GLYPHS = { 'enterprise-account': IconUserOutlineMedium, 'desktop-usage': IconGaugeOutlineMedium, 'desktop-ai-access': IconApiOutlineMedium, 'desktop-about': IconInfoOutlineMedium }
    function SettingsNavigation({ rows, renderEntry }) {
      return rows.map(row => renderEntry(row, NAV_GLYPHS[row.id] ? { icon: NAV_GLYPHS[row.id] } : undefined))
    }

    const DESKTOP_SETTINGS_CSS = `
      .dshUsage{min-width:0}.dshUsageStorage{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:14px}.dshUsageStorage>span:last-child,.dshUsage .dshSettingsHint{color:var(--dsw-alias-label-secondary)}.dshUsageProgress{width:100%;height:6px;margin-top:10px;accent-color:var(--dsw-alias-state-business-primary)}
      .dshUsageModel{margin-top:28px}.dshUsageHeader{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}.dshUsageHeader h3{margin:0;font-size:16px;font-weight:600}.dshUsageCalendarScroll{overflow-x:auto;padding-bottom:4px}.dshUsageMonths{display:grid;min-width:440px;gap:3px;margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.dshUsageMonths span{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:clip}.dshUsageMonths span:last-child{text-align:right}.dshUsageGrid{display:grid;grid-template-rows:repeat(7,1fr);min-width:440px;gap:3px}.dshUsageDay{aspect-ratio:1;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover)}.dshUsageDay[data-level='1']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 25%,var(--dsw-alias-interactive-bg-hover))}.dshUsageDay[data-level='2']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-interactive-bg-hover))}.dshUsageDay[data-level='3']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 70%,var(--dsw-alias-interactive-bg-hover))}.dshUsageDay[data-level='4']{background:var(--dsw-alias-state-business-primary)}.dshUsageDay[data-level='unknown']{outline:1px dashed var(--dsw-alias-border-l2);outline-offset:-1px;background:transparent}.dshUsageTotals{margin:26px 0 12px}.dshUsageTotals dt{font-size:14px;color:var(--dsw-alias-label-secondary)}.dshUsageTotals dd{margin:8px 0 0;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}.dshUsage .dshSettingsHint{font-size:12px;line-height:1.6}
      .dshUsageOverview{display:flex;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 0;gap:0}.dshUsageOverview>div{flex:1;min-width:0;text-align:center;padding:0 10px;display:flex;flex-direction:column-reverse;gap:6px}.dshUsageOverview>div+div{border-left:1px solid var(--dsw-alias-border-l2)}.dshUsageOverview dt{font-size:12px;color:var(--dsw-alias-label-secondary)}.dshUsageOverview dd{margin:0;font-size:18px;font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.dshUsagePeriod{margin:10px 0 0}.dshUsageCalendarScroll{display:flex;flex-direction:column}.dshUsageMonths{order:1;margin:8px 0 0}.dshUsageFooter{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin-top:10px}.dshUsageFooter>.dshSettingsHint{margin:0}.dshUsageLegend{display:flex;align-items:center;justify-content:flex-end;flex:none;margin-left:auto;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}.dshUsageLegend .dshUsageDay{width:9px;height:9px}.dshUsageStorage{margin-top:24px;padding-top:20px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dshSettingsSection{color:var(--dsw-alias-label-primary)}.dshSettingsSection h2{font-size:18px;font-weight:600;margin:0 0 20px}.dshSettingsRemote{height:max(360px,calc(min(800px,100vh - 80px) - 220px));position:relative;min-width:0}
      .dshSettingsStatus{padding:24px 0;font-size:14px}.dshSettingsTabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:12px;margin-bottom:8px}
      .dshSettingsSection button:not([role=tab]),.dshSettingsStatus button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);padding:7px 12px;cursor:pointer}
      .dshSettingsSection button:not([role=tab]):hover,.dshSettingsStatus button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshSettingsSection button:not([role=tab])[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.dshSettingsSection button:not([role=tab]):disabled{opacity:.5;cursor:default}
      .dshSettingsVersions{display:grid;grid-template-columns:1fr auto;gap:20px;padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:14px}.dshSettingsVersions dd{margin:0;color:var(--dsw-alias-label-secondary)}.dshSettingsButtons{display:flex;gap:12px;padding:20px 0;flex-wrap:wrap}
      .dshAccountLauncher,.dshAccountMenuAnchor{display:block;width:100%;min-width:0}.dshAccountTrigger{anchor-name:--dsh-desktop-account-trigger;display:flex;align-items:center;gap:10px;width:100%;min-width:0;height:48px;box-sizing:border-box;padding:6px 10px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}.dshAccountTrigger:hover,.dshAccountTrigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.dshAccountTrigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dshAccountTrigger:disabled{cursor:default}.dshAccountTriggerRail{width:36px;height:36px;padding:4px;margin:auto;justify-content:center}.dshAccountTrigger>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
      .dshAccountAvatar{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}.dshAccountAvatarWrap{position:relative;display:flex;flex:none}.dshAccountBadge{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-state-error-primary);color:#fff;font-size:10px;font-weight:600;line-height:1}.dshAccountAvatarWrap>.dshAccountBadge{position:absolute;top:-4px;right:-6px}.dshAccountMenuRow{display:flex;align-items:center;gap:8px;min-width:0}.dshAccountTriggerCopy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:13px}.dshAccountTriggerCopy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshAccountTriggerCopy small,.dshAccountMenuIdentity small{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
      .dshAccountMenu{min-width:248px;max-width:min(320px,calc(100vw - 24px))}.dshAccountMenuWide{position-anchor:--dsh-desktop-account-trigger;box-sizing:border-box;width:anchor-size(width);min-width:0;max-width:none;left:anchor(left)!important}.dshAccountMenuIdentity{display:flex;align-items:center;gap:12px;padding:10px 10px 14px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.dshAccountMenuIdentity>div{display:flex;flex-direction:column;gap:4px;min-width:0}.dshAccountMenuIdentity strong{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshAccountMenuError{font-size:12px;line-height:1.5;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
      .dshAccountMenuIdentity>.dshAccountMenuCredits{flex:none;margin-left:auto;text-align:right;max-width:48%}.dshAccountMenuCredits strong{font-variant-numeric:tabular-nums}.dshAccountMenuIdentity>div:not(.dshAccountMenuCredits){flex:1;min-width:0}
      .dshAccountDialog{width:min(420px,100%)}.dshAccountDialogActions{display:flex;justify-content:flex-end;gap:8px}.dshAccountDialogActions button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);padding:7px 14px;cursor:pointer}.dshAccountDialogActions button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshAccountDialogActions button:disabled{opacity:.5;cursor:default}.dshAccountDialogActions .dshAccountDialogDanger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}.dshAccountDialogActions .dshAccountDialogDanger:hover{background:var(--dsw-alias-state-error-primary);opacity:.9}.dshAccountDialogError{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
      .dshApprovalsDialog{width:min(1080px,100%);height:min(800px,100%);max-height:100%;padding:0;gap:0}.dshApprovalsPanel{display:flex;flex:1;min-height:0;min-width:0}
      .dshApprovalsNav{box-sizing:border-box;display:flex;flex-direction:column;flex:none;gap:18px;width:188px;min-height:0;padding:22px 12px;overflow-y:auto}.dshApprovalsNavTitle{padding:0 12px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}.dshApprovalsNavList{display:flex;flex-direction:column;gap:4px;overflow-y:auto}
      .dshApprovalsNavCell{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:40px;padding:9px 16px 9px 12px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:400;line-height:22px;text-align:left;cursor:pointer}.dshApprovalsNavCell:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}.dshApprovalsNavCell[aria-current=true]{background:var(--dsw-specific-sidebar-nav-item-active)}.dshApprovalsNavIcon{flex:none}.dshApprovalsNavLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshApprovalsContent{display:flex;flex-direction:column;flex:1;min-width:0}.dshApprovalsHeader{box-sizing:border-box;display:flex;flex:none;align-items:flex-start;justify-content:flex-end;gap:8px;height:54px;padding:20px 14px 8px 10px}.dshApprovalsClose{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}.dshApprovalsClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dshApprovalsOptions{display:flex;flex-direction:column;flex:1;min-height:0;padding:0 24px 24px}.dshApprovalsOptions .dshSettingsRemote{flex:1;min-height:0;height:auto}
      @media(max-width:640px){.dshSettingsRemote{height:max(300px,calc(100vh - 280px))}.dshApprovalsNav{width:152px;gap:14px;padding:18px 8px}.dshApprovalsOptions{padding:0 16px 16px}}
    `

    function apply(ctx) {
      if (typeof ctx.provide === 'function') {
        ctx.provide('enterpriseLauncher', { accountSectionId: ENTERPRISE_SECTION_ID })
        ctx.provide('enterpriseWorkResources', { enabled: true })
      }
      ctx.effect(bindWorkToolChanges, 'enterprise: refresh saved tool availability')
      installStyles()
      installMarketStyles()
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-desktop-enterprise: copy dictionaries'
      )
      ctx.effect(() => ctx.locale.register(SAFETY_NS, safetyCopy), 'enterprise: content safety translations')
      ctx.effect(() => bindContentSafetyLocale(ctx.locale), 'enterprise: current content safety locale')
      const t = ctx.locale.bind(NS)
      accountTranslate = t
      ctx.effect(() => ctx.locale.register('settings.enterpriseMarket', { zh: marketZh, en: marketEn }), 'enterprise-market: translations')
      marketTranslate = ctx.locale.bind('settings.enterpriseMarket')
      ctx.effect(() => bindEnterpriseModelSync(), 'enterprise: foreground model catalog sync')
      ctx.effect(() => bindEnterpriseMarketTab(ctx), 'enterprise-market: account-bound plugins tab')
      ctx.effect(() => {
        const bridge = window.dshDesktopEnterprise
        if (!bridge?.onLoginLink) return undefined
        return bridge.onLoginLink(() => openEnterpriseSettingsSection())
      }, 'dsh-desktop-enterprise: open settings on login link')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: ENTERPRISE_SECTION_ID,
        order: -10,
        label: () => t('nav'),
        children: { 'desktop.account.usage': { kind: 'single', scope: 'root' } },
        inject: () => ({ t })
      }, EnterpriseSection))

      ctx.effect(
        () => ctx.locale.register(DESKTOP_SETTINGS_NS, DESKTOP_SETTINGS_COPY),
        'enterprise: settings copy'
      )
      const settingsT = ctx.locale.bind(DESKTOP_SETTINGS_NS)
      settingsTranslate = settingsT

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-enterprise'
        style.dataset.pluginCss = 'dsh-desktop-enterprise-settings'
        style.textContent = DESKTOP_SETTINGS_CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'enterprise: settings styles')

      const registerSlot = (scope, name, id, Component, extra = {}) => {
        return scope.slots.inject(name, () => {
          try {
            if (scope.slots.entries?.(name)?.some(entry => entry.options?.id === id)) {
              return undefined
            }
            return scope.slots.register({
              name,
              id,
              locale: DESKTOP_SETTINGS_NS,
              ...extra,
              inject: () => ({ t: settingsT })
            }, Component)
          } catch {
            return undefined
          }
        })
      }

      registerSlot(ctx, 'desktop.account.usage', 'desktop-usage', Usage, { priority: 10 })
      registerSlot(ctx, 'settings.launcher', 'desktop-account-menu', AccountLauncher)
      registerSlot(ctx, 'settings.section', 'desktop-about', About, {
        order: 90,
        label: () => settingsT('about')
      })

      if (typeof ctx.slots?.entries === 'function') {
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: ENTERPRISE_SECTION_ID,
          inject: () => ({})
        }, ({ size }) => h(IconUserOutlineMedium, { size: size || 18 })))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'desktop-about',
          inject: () => ({})
        }, ({ size }) => h(IconInfoOutlineMedium, { size: size || 18 })))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'desktop-ai-access',
          inject: () => ({})
        }, ({ size }) => h(IconApiOutlineMedium, { size: size || 18 })))
      }

      ctx.effect(() => {
        let disposed = false, disposeEntry, revision = 0
        const sync = (state) => {
          revision++
          const allowed = state?.connected && state?.navigation?.settings?.aiAccess === true
          if (allowed && !disposeEntry) {
            disposeEntry = registerSlot(ctx, 'settings.section', 'desktop-ai-access', AiAccess, {
              order: 80,
              label: () => settingsT('ai')
            })
          }
          if (!allowed) {
            disposeEntry?.()
            disposeEntry = undefined
          }
        }
        const unsubscribe = window.dshEnterpriseChat?.subscribe(sync)
        const request = revision
        void window.dshEnterpriseChat?.state().then((state) => {
          if (!disposed && request === revision) sync(state)
        }).catch(() => {})
        return () => {
          disposed = true
          unsubscribe?.()
          disposeEntry?.()
        }
      }, 'enterprise: account capabilities')

      registerSlot(ctx, 'settings.navigation', 'desktop-nav-glyphs', SettingsNavigation)
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
