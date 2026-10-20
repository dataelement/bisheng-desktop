window.__ModuleLoader__.load({
  id: 'dsh-desktop-settings',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useEffect, useRef, useState } = React
    const { Menu, MenuItemButton, Modal, IconSettingsOutlineRegular, IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'desktop.settings'
    const COPY = {
      zh: {
        accountMenu: '账号菜单', enterpriseAccount: '企业账号', signedOut: '未登录', identityLoading: '正在读取账号…', identityError: '暂时无法读取账号', settings: '设置', approvals: '审批', phone: '连接手机', logout: '退出登录', close: '关闭', loggingOut: '正在退出登录…',
        openContent: '进入设置内容', usage: '用量与存储', about: '关于与帮助', messages: '消息与审批', tasks: '我的审批', requests: '我的申请', notifications: '通知', ai: 'AI 助手接入', loading: '正在加载企业设置…', error: '暂时无法加载企业设置，请检查连接后重试。', restart: '请完全退出并重新启动客户端，以启用统一设置。', unsupported: '平台暂不支持统一设置，请联系管理员更新平台。', retry: '重新连接', signIn: '登录企业账号后可查看', openAccount: '前往账号设置', desktopVersion: 'BISHENG 版本', harnessVersion: 'Harness 版本', infoError: '无法读取版本信息', update: '检查更新', logs: '查看日志', recovery: '安全模式与插件恢复', localHint: '本机设置仍可正常使用。', actionError: '操作未完成，请重试。',
      },
      en: {
        accountMenu: 'Account menu', enterpriseAccount: 'Enterprise account', signedOut: 'Not signed in', identityLoading: 'Loading account…', identityError: 'Account unavailable', settings: 'Settings', approvals: 'Approvals', phone: 'Connect phone', logout: 'Log out', close: 'Close', loggingOut: 'Logging out…',
        openContent: 'Enter settings content', usage: 'Usage and storage', about: 'About and help', messages: 'Messages and approvals', tasks: 'My approvals', requests: 'My requests', notifications: 'Notifications', ai: 'AI assistant access', loading: 'Loading enterprise settings…', error: 'Enterprise settings could not load. Check the connection and try again.', restart: 'Quit and restart the desktop app to enable unified settings.', unsupported: 'This platform does not support unified settings yet. Ask your administrator to update it.', retry: 'Reconnect', signIn: 'Sign in to view enterprise settings', openAccount: 'Open account settings', desktopVersion: 'BISHENG version', harnessVersion: 'Harness version', infoError: 'Could not read version information', update: 'Check for updates', logs: 'Show logs', recovery: 'Safe Mode and plugin recovery', localHint: 'Device settings remain available.', actionError: 'The action did not complete. Try again.',
      }
    }
    const openAccount = () => window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))

    function navigateTabs(event, ids, active, select, refs) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !ids.length) return
      event.preventDefault()
      const index = Math.max(0, ids.indexOf(active))
      const next = ids[event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length]
      select(next); refs.current[next]?.focus()
    }

    /** A single surface owner feeds geometry to the existing Chat/Work presenter. */
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
            approvals.querySelector(event.detail.direction === 'previous' ? '[role=tab][aria-selected=true]' : '[data-dsh-approvals-close]')?.focus()
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

    function Usage({ t }) { return h('section', { className: 'dshSettingsSection' }, h('h2', null, t('usage')), h(RemoteSettings, { section: 'desktop-usage', t })) }
    function AiAccess({ t }) { return h('section', { className: 'dshSettingsSection' }, h('h2', null, t('ai')), h(RemoteSettings, { section: 'ai-access', t })) }
    function ApprovalsContent({ t }) {
      const tabsId = React.useId()
      const refs = useRef({})
      const [section, setSection] = useState('my-tasks')
      return h('section', { className: 'dshSettingsSection dshApprovalsBody' },
        h('div', { className: 'dshSettingsTabs', role: 'tablist', 'aria-label': t('messages'), onKeyDown: event => navigateTabs(event, ['my-tasks', 'my-requests', 'notifications'], section, setSection, refs) },
          ...[['my-tasks', 'tasks'], ['my-requests', 'requests'], ['notifications', 'notifications']].map(([id, key]) => h('button', { key: id, id: `${tabsId}-${id}`, ref: node => { refs.current[id] = node }, type: 'button', role: 'tab', 'aria-selected': section === id, tabIndex: section === id ? 0 : -1, 'aria-controls': `${tabsId}-panel`, 'data-modal-autofocus': id === 'my-tasks' ? '' : undefined, onClick: () => setSection(id) }, t(key)))),
        h('div', { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': `${tabsId}-${section}` }, h(RemoteSettings, { key: section, section, t })))
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
        h('div', { className: 'dshSettingsButtons' },
          ...[['check-for-updates', 'update'], ['show-harness-log', 'logs'], ['safe-mode', 'recovery']].map(([action, label]) => h('button', { key: action, type: 'button', disabled: busy, onClick: () => run(action) }, t(label)))),
        error && h('p', { role: 'alert' }, t(error)))
    }
    /** Reuse the host enterprise endpoints; neither credentials nor account storage live here. */
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
      const refresh = React.useCallback(async () => {
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
        h('div', { 'data-dsh-approvals': '', className: 'dshApprovalsPanel' },
          h('header', { className: 'dshApprovalsHeader' }, h('h2', null, t('approvals')),
            h('button', { type: 'button', 'data-dsh-approvals-close': '', 'aria-label': t('close'), onClick: onClose }, h(IconCloseOutlineRegular))),
          h('div', { 'data-dsh-approvals-content': '', className: 'dshApprovalsContent' }, open && h(ApprovalsContent, { t }))))
    }

    function AccountAvatar({ name }) {
      return h('span', { className: 'dshAccountAvatar', 'aria-hidden': 'true' }, name ? Array.from(name).slice(0, 2).join('').toLocaleUpperCase() : h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('circle', { cx: 12, cy: 8, r: 4 }), h('path', { d: 'M4 22v-2a8 8 0 0 1 16 0v2' })))
    }

    function AccountMenuIcon({ phone }) {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true' },
        phone ? h('rect', { x: 6, y: 2, width: 12, height: 20, rx: 2 }) : h('path', { d: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M13 7l5 5-5 5M8 12h13' }),
        phone && h('path', { d: 'M10 5h4M11 19h2' }))
    }

    function AccountLauncher({ wide, settingsOpen, openSettings, settingsShortcut, t }) {
      const identity = useAccountIdentity()
      const [menuOpen, setMenuOpen] = useState(false)
      const [approvalsOpen, setApprovalsOpen] = useState(false)
      const [actionBusy, setActionBusy] = useState(false)
      const [actionError, setActionError] = useState(false)
      const alive = useRef(true)
      const trigger = useRef(null)
      const closeApprovals = React.useCallback(() => { setApprovalsOpen(false); trigger.current?.focus() }, [])
      useEffect(() => {
        alive.current = true
        const close = () => closeApprovals()
        window.addEventListener('dsh-desktop:close-settings', close)
        return () => { alive.current = false; window.removeEventListener('dsh-desktop:close-settings', close) }
      }, [closeApprovals])
      useEffect(() => { if (settingsOpen) { setMenuOpen(false); setApprovalsOpen(false) } }, [settingsOpen])
      useEffect(() => {
        if (identity.account?.connected === false) setApprovalsOpen(false)
      }, [identity.account?.connected])
      const name = [identity.account?.user?.display_name, identity.account?.user?.username, identity.account?.user?.id].find(value => typeof value === 'string' && value.trim())
      const label = name || t(identity.account ? 'signedOut' : identity.error ? 'identityError' : 'identityLoading')
      const connected = identity.account?.connected === true
      const busy = actionBusy || identity.busy
      const run = async operation => {
        if (busy) return
        setActionBusy(true); setActionError(false)
        try {
          if (operation === 'logout') await identity.logout()
          else await window.dshDesktop.openPhonePairing()
          if (alive.current) { setMenuOpen(false); setApprovalsOpen(false) }
        } catch { if (alive.current) { setActionError(true); setMenuOpen(true) } }
        finally { if (alive.current) setActionBusy(false) }
      }
      // The sidebar menu does not cover the native Chat view or own its presentation.
      return h('div', { className: 'dshAccountLauncher', 'data-dsh-account-launcher': '' },
        h(Menu, { open: menuOpen, onClose: () => { if (!busy) setMenuOpen(false) }, side: 'top', align: 'start', portal: true, autoFocus: true, className: 'dshAccountMenuAnchor', listClassName: 'dshAccountMenu',
          anchor: h('button', { ref: trigger, type: 'button', className: `dshAccountTrigger${wide ? '' : ' dshAccountTriggerRail'}`, 'aria-label': `${t('accountMenu')}: ${label}`, title: wide ? undefined : label, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen, disabled: settingsOpen || busy, onClick: () => { setMenuOpen(previous => !previous); setActionError(false); void identity.refresh() } },
            h(AccountAvatar, { name }), wide && h('span', { className: 'dshAccountTriggerCopy' }, h('span', null, label), h('small', null, t(connected ? 'enterpriseAccount' : 'signedOut'))), wide && h(IconChevronDownOutlineRegular)) },
          h('div', { className: 'dshAccountMenuIdentity' }, h(AccountAvatar, { name }), h('div', null, h('strong', null, label), connected && h('small', null, t('enterpriseAccount')))),
          h(MenuItemButton, { icon: h(IconSettingsOutlineRegular), shortcut: settingsShortcut, disabled: busy, onSelect: () => { setMenuOpen(false); openSettings() } }, t('settings')),
          h(MenuItemButton, { icon: h(IconChecklistOutlineRegular), disabled: busy || !connected, onSelect: () => { setMenuOpen(false); setApprovalsOpen(true) } }, t('approvals')),
          h(MenuItemButton, { icon: h(AccountMenuIcon, { phone: true }), disabled: busy, onSelect: () => { void run('phone') } }, t('phone')),
          h(MenuItemButton, { icon: h(AccountMenuIcon, { phone: false }), separatorBefore: true, danger: true, disabled: busy || !connected, onSelect: () => { void run('logout') } }, t(identity.busy ? 'loggingOut' : 'logout')),
          (actionError || identity.error) && h('p', { className: 'dshAccountMenuError', role: 'alert' }, t(actionError ? 'actionError' : 'identityError'))),
        h(ApprovalsDialog, { open: approvalsOpen, onClose: closeApprovals, t }))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, COPY), 'desktop-settings: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'dsh-desktop-settings'
        style.textContent = `
          .dshSettingsSection{color:var(--dsw-alias-label-primary)}.dshSettingsSection h2{font-size:18px;font-weight:600;margin:0 0 20px}.dshSettingsRemote{height:max(360px,calc(min(800px,100vh - 80px) - 220px));position:relative;min-width:0}
          .dshSettingsStatus{padding:24px 0;font-size:14px}.dshSettingsTabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:12px;margin-bottom:8px}
          .dshSettingsSection button,.dshSettingsStatus button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);padding:7px 12px;cursor:pointer}
          .dshSettingsSection button:hover,.dshSettingsStatus button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshSettingsSection button[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.dshSettingsSection button:disabled{opacity:.5;cursor:default}
          .dshSettingsVersions{display:grid;grid-template-columns:1fr auto;gap:20px;padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:14px}.dshSettingsVersions dd{margin:0;color:var(--dsw-alias-label-secondary)}.dshSettingsButtons{display:flex;gap:12px;padding:20px 0;flex-wrap:wrap}
          .dshAccountLauncher,.dshAccountMenuAnchor{display:block;width:100%;min-width:0}.dshAccountTrigger{display:flex;align-items:center;gap:10px;width:100%;min-width:0;height:48px;box-sizing:border-box;padding:6px 10px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}.dshAccountTrigger:hover,.dshAccountTrigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.dshAccountTrigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dshAccountTrigger:disabled{cursor:default}.dshAccountTriggerRail{width:36px;height:36px;padding:4px;margin:auto;justify-content:center}.dshAccountTrigger>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
          .dshAccountAvatar{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}.dshAccountTriggerCopy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:13px}.dshAccountTriggerCopy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshAccountTriggerCopy small,.dshAccountMenuIdentity small{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
          .dshAccountMenu{min-width:248px;max-width:min(320px,calc(100vw - 24px))}.dshAccountMenuIdentity{display:flex;align-items:center;gap:12px;padding:10px 10px 14px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.dshAccountMenuIdentity>div{display:flex;flex-direction:column;gap:4px;min-width:0}.dshAccountMenuIdentity strong{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshAccountMenuError{font-size:12px;line-height:1.5;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
          .dshApprovalsDialog{width:min(1120px,100%);max-height:100%;padding:0;gap:0}.dshApprovalsPanel{display:flex;flex-direction:column;min-height:0}.dshApprovalsHeader{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 24px 12px}.dshApprovalsHeader h2{font-size:18px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}.dshApprovalsHeader button{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.dshApprovalsHeader button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshApprovalsContent{padding:0 24px 24px;overflow:auto;min-height:0}.dshApprovalsBody .dshSettingsRemote{height:clamp(240px,calc(100vh - 240px),600px)}

          @media(max-width:640px){.dshSettingsRemote{height:max(300px,calc(100vh - 280px))}}
        `
        document.head.appendChild(style)
        return () => style.remove()
      }, 'desktop-settings: owned styles')
      const register = (name, id, Component, extra = {}) => ctx.slots.inject(name, () => ctx.slots.register({ name, id, locale: NS, ...extra, inject: () => ({ t }) }, Component))
      register('settings.section', 'desktop-usage', Usage, { order: 16, label: () => t('usage') })
      register('settings.section', 'desktop-about', About, { order: 90, label: () => t('about') })
      ctx.effect(() => {
        let disposed = false, disposeEntry, revision = 0
        const sync = state => {
          revision++
          const allowed = state.connected && state.navigation?.settings?.aiAccess === true
          if (allowed && !disposeEntry) disposeEntry = register('settings.section', 'desktop-ai-access', AiAccess, { order: 80, label: () => t('ai') })
          if (!allowed) { disposeEntry?.(); disposeEntry = undefined }
        }
        const unsubscribe = window.dshEnterpriseChat?.subscribe(sync)
        const request = revision
        void window.dshEnterpriseChat?.state().then(state => { if (!disposed && request === revision) sync(state) }).catch(() => { /* Unavailable capability stays hidden until the next host state. */ })
        return () => { disposed = true; unsubscribe?.(); disposeEntry?.() }
      }, 'desktop-settings: account capabilities')
      register('desktop.settings.account', 'desktop-account-details', props => h(RemoteSettings, { section: 'account', t: props.t }))
      register('settings.launcher', 'desktop-account-menu', AccountLauncher)
    }
    return { apply, inject: ['slots', 'locale'] }
  }
})
