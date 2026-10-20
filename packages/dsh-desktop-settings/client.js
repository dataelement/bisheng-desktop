window.__ModuleLoader__.load({
  id: 'dsh-desktop-settings',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useEffect, useRef, useState } = React
    const NS = 'desktop.settings'
    const COPY = {
      zh: {
        extensionsEmpty: '企业尚未提供可用扩展。', extensionsAdvanced: '高级插件配置', openContent: '进入设置内容', general: '通用', account: '账号与安全', usage: '用量与存储', plugins: '扩展功能', about: '关于与帮助', advanced: '高级设置', preferences: '工作偏好与高级设置', messages: '消息与审批', tasks: '我的审批', requests: '我的申请', notifications: '通知', ai: 'AI 助手接入', loading: '正在加载企业设置…', error: '暂时无法加载企业设置，请检查连接后重试。', restart: '请完全退出并重新启动客户端，以启用统一设置。', unsupported: '平台暂不支持统一设置，请联系管理员更新平台。', retry: '重新连接', signIn: '登录企业账号后可查看', openAccount: '前往账号设置', desktopVersion: 'BISHENG 版本', harnessVersion: 'Harness 版本', infoError: '无法读取版本信息', update: '检查更新', logs: '查看日志', recovery: '安全模式与插件恢复', localHint: '本机设置仍可正常使用。', advancedHint: '以下设置影响本机工作任务。企业提供的模型和权限由管理员管理。', details: '配置文件', actionError: '操作未完成，请重试。', enterpriseManaged: '企业提供的模型', deviceScope: '高级选项仅影响本机工作，不会修改企业统一配置。'
      },
      en: {
        extensionsEmpty: 'No enterprise extensions are available yet.', extensionsAdvanced: 'Advanced plugin configuration', openContent: 'Enter settings content', general: 'General', account: 'Account and security', usage: 'Usage and storage', plugins: 'Extensions', about: 'About and help', advanced: 'Advanced settings', preferences: 'Work preferences and advanced settings', messages: 'Messages and approvals', tasks: 'My approvals', requests: 'My requests', notifications: 'Notifications', ai: 'AI assistant access', loading: 'Loading enterprise settings…', error: 'Enterprise settings could not load. Check the connection and try again.', restart: 'Quit and restart the desktop app to enable unified settings.', unsupported: 'This platform does not support unified settings yet. Ask your administrator to update it.', retry: 'Reconnect', signIn: 'Sign in to view enterprise settings', openAccount: 'Open account settings', desktopVersion: 'BISHENG version', harnessVersion: 'Harness version', infoError: 'Could not read version information', update: 'Check for updates', logs: 'Show logs', recovery: 'Safe Mode and plugin recovery', localHint: 'Device settings remain available.', advancedHint: 'These settings affect local Work tasks. Enterprise models and permissions are managed by your administrator.', details: 'Configuration file', actionError: 'The action did not complete. Try again.', enterpriseManaged: 'Models provided by your enterprise', deviceScope: 'Advanced options affect local Work only and do not change enterprise configuration.'
      }
    }
    const BASIC_ITEMS = new Set(['language', 'appearance', 'font-size', 'shortcuts'])
    const COMMON = [['general', 'general'], ['enterprise-account', 'account'], ['desktop-usage', 'usage'], ['plugins', 'plugins'], ['desktop-about', 'about']]
    const openAccount = () => window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))

    function Navigation({ rows, activeId, renderEntry, t }) {
      const commonIds = new Set(COMMON.map(([id]) => id))
      const advanced = rows.filter(row => !commonIds.has(row.id) && row.id !== 'desktop-messages')
      const [expanded, setExpanded] = useState(() => advanced.some(row => row.id === activeId))
      useEffect(() => { if (advanced.some(row => row.id === activeId)) setExpanded(true) }, [activeId])
      return h('div', { className: 'dshSettingsNav' },
        ...COMMON.flatMap(([id, key]) => {
          const row = rows.find(item => item.id === id)
          return row ? [renderEntry({ ...row, label: t(key) })] : []
        }),
        rows.some(row => row.id === 'desktop-messages') && h('div', { className: 'dshSettingsNavGroup' }, renderEntry({ ...rows.find(row => row.id === 'desktop-messages'), label: t('messages') })),
        advanced.length > 0 && h('details', { className: 'dshSettingsAdvancedNav', open: expanded, onToggle: event => setExpanded(event.currentTarget.open) },
          h('summary', null, t('advanced')),
          h('div', { className: 'dshSettingsNav' }, ...advanced.map(renderEntry))))
    }

    function GeneralLayout({ items, t }) {
      const basic = items.filter(item => BASIC_ITEMS.has(item.id))
      const advanced = items.filter(item => !BASIC_ITEMS.has(item.id))
      return h('div', { className: 'dshSettingsGeneral' },
        ...basic.map(item => h(React.Fragment, { key: item.id }, item.render())),
        advanced.length > 0 && h('details', { className: 'dshSettingsDetails' },
          h('summary', null, t('preferences')),
          h('p', { className: 'dshSettingsHint' }, t('advancedHint')),
          ...advanced.map(item => h(React.Fragment, { key: item.id }, item.render()))))
    }

    function navigateTabs(event, ids, active, select, refs) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !ids.length) return
      event.preventDefault()
      const index = Math.max(0, ids.indexOf(active))
      const next = ids[event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length]
      select(next); refs.current[next]?.focus()
    }

    function ExtensionsLayout({ items, t }) {
      const tabsId = React.useId()
      const refs = useRef({})
      const commonIds = new Set(['enterprise-market', 'desktop-host-plugins', 'desktop-market-management', 'desktop-market-installer', 'desktop-workbenches'])
      const common = items.filter(item => commonIds.has(item.id))
      const advanced = items.filter(item => !commonIds.has(item.id))
      const [selected, setSelected] = useState()
      const [visited, setVisited] = useState(() => new Set())
      const active = common.find(item => item.id === selected)?.id || common[0]?.id
      useEffect(() => { if (active) setVisited(previous => previous.has(active) ? previous : new Set([...previous, active])) }, [active])
      return h('section', { className: 'dshSettingsSection' }, h('h2', null, t('plugins')),
        common.length > 1 && h('div', { className: 'dshSettingsTabs', role: 'tablist', 'aria-label': t('plugins'), onKeyDown: event => navigateTabs(event, common.map(item => item.id), active, setSelected, refs) }, ...common.map(item => h('button', { key: item.id, id: `${tabsId}-${item.id}`, ref: node => { refs.current[item.id] = node }, type: 'button', role: 'tab', 'aria-selected': item.id === active, tabIndex: item.id === active ? 0 : -1, 'aria-controls': `${tabsId}-panel-${item.id}`, onClick: () => setSelected(item.id) }, item.label))),
        ...common.filter(item => item.id === active || visited.has(item.id)).map(item => h('div', { key: item.id, id: `${tabsId}-panel-${item.id}`, hidden: item.id !== active, role: 'tabpanel', 'aria-label': item.label }, item.render())),
        !common.length && h('p', { className: 'dshSettingsHint' }, t('extensionsEmpty')),
        advanced.length > 0 && h('details', { className: 'dshSettingsDetails' }, h('summary', null, t('extensionsAdvanced')),
          h('p', { className: 'dshSettingsHint' }, t('advancedHint')),
          ...advanced.map(item => h('details', { key: item.id, className: 'dshSettingsDetails', onToggle: event => { if (event.currentTarget.open) setVisited(previous => previous.has(item.id) ? previous : new Set([...previous, item.id])) } },
            h('summary', null, item.label), visited.has(item.id) && item.render()))))
    }

    function ActionLayout({ items, t }) {
      useEffect(() => () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-overlay', { detail: { open: false } })), [])
      return h(React.Fragment, null,
        ...items.filter(item => item.id !== 'open-document').map(item => h(React.Fragment, { key: item.id }, item.render())),
        items.some(item => item.id === 'open-document') && h('details', { className: 'dshSettingsActions', onToggle: event => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-overlay', { detail: { open: event.currentTarget.open } })) },
          h('summary', null, t('details')),
          h('div', { className: 'dshSettingsActionMenu' }, items.find(item => item.id === 'open-document').render())))
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
          const clip = node.closest('[data-dsh-settings-content]')?.getBoundingClientRect() || rect
          const x = Math.max(rect.x, clip.x), y = Math.max(rect.y, clip.y)
          window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { token, section, bounds: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(0, Math.min(rect.right, clip.right) - x), height: Math.max(0, Math.min(rect.bottom, clip.bottom) - y) } } }))
        }
        const resize = new ResizeObserver(publish)
        resize.observe(node)
        const clip = node.closest('[data-dsh-settings-content]')
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
          const selector = event.detail.direction === 'previous' ? '[data-dsh-settings-section] [aria-current="true"]' : '[data-dsh-settings-close]'
          document.querySelector(selector)?.focus()
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
    function Messages({ t }) {
      const tabsId = React.useId()
      const refs = useRef({})
      const [section, setSection] = useState('my-tasks')
      return h('section', { className: 'dshSettingsSection' }, h('h2', null, t('messages')),
        h('div', { className: 'dshSettingsTabs', role: 'tablist', 'aria-label': t('messages'), onKeyDown: event => navigateTabs(event, ['my-tasks', 'my-requests', 'notifications'], section, setSection, refs) },
          ...[['my-tasks', 'tasks'], ['my-requests', 'requests'], ['notifications', 'notifications']].map(([id, key]) => h('button', { key: id, id: `${tabsId}-${id}`, ref: node => { refs.current[id] = node }, type: 'button', role: 'tab', 'aria-selected': section === id, tabIndex: section === id ? 0 : -1, 'aria-controls': `${tabsId}-panel`, onClick: () => setSection(id) }, t(key)))),
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
          ...[['check-for-updates', 'update'], ['show-harness-log', 'logs']].map(([action, label]) => h('button', { key: action, type: 'button', disabled: busy, onClick: () => run(action) }, t(label)))),
        h('details', { className: 'dshSettingsDetails' }, h('summary', null, t('advanced')), h('button', { type: 'button', disabled: busy, onClick: () => run('safe-mode') }, t('recovery'))),
        error && h('p', { role: 'alert' }, t(error)))
    }
    function MessageEntry({ wide, t }) {
      return h('button', { type: 'button', className: 'dshSettingsMessageEntry', 'aria-label': t('messages'), title: wide ? undefined : t('messages'), onClick: () => window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'desktop-messages' } })) },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true' }, h('path', { d: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2ZM6 9h12M6 13h8' })), wide && h('span', null, t('messages')))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, COPY), 'desktop-settings: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'dsh-desktop-settings'
        style.textContent = `
          .dshSettingsNav{display:flex;flex-direction:column;gap:4px;min-width:0}.dshSettingsNav button{width:100%;min-width:0;box-sizing:border-box}.dshSettingsNavGroup{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}
          .dshSettingsAdvancedNav{margin-top:12px}.dshSettingsAdvancedNav>summary,.dshSettingsDetails>summary{cursor:pointer;padding:12px 4px;color:var(--dsw-alias-label-secondary);font-size:13px}
          .dshSettingsHint{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}.dshSettingsDetails{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l2)}
          .dshSettingsSection{color:var(--dsw-alias-label-primary)}.dshSettingsSection h2{font-size:18px;font-weight:600;margin:0 0 20px}.dshSettingsRemote{height:max(360px,calc(min(800px,100vh - 80px) - 220px));position:relative;min-width:0}
          .dshSettingsStatus{padding:24px 0;font-size:14px}.dshSettingsTabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:12px;margin-bottom:8px}
          .dshSettingsSection button,.dshSettingsStatus button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);padding:7px 12px;cursor:pointer}
          .dshSettingsSection button:hover,.dshSettingsStatus button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshSettingsSection button[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.dshSettingsSection button:disabled{opacity:.5;cursor:default}
          .dshSettingsVersions{display:grid;grid-template-columns:1fr auto;gap:20px;padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:14px}.dshSettingsVersions dd{margin:0;color:var(--dsw-alias-label-secondary)}.dshSettingsButtons{display:flex;gap:12px;padding:20px 0;flex-wrap:wrap}
          .dshSettingsActions{position:relative;font-size:12px;color:var(--dsw-alias-label-secondary)}.dshSettingsActions>summary{cursor:pointer;padding:4px}.dshSettingsActionMenu{position:absolute;right:0;top:100%;background:var(--dsw-alias-bg-layer-2);padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);z-index:1}
          .dshSettingsMessageEntry{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;padding:8px 12px;background:transparent;border:0;cursor:pointer;border-radius:var(--dsw-radius-md)}.dshSettingsMessageEntry:hover{background:var(--dsw-alias-interactive-bg-hover)}
          [data-dsh-settings-section]:has(.dshSettingsNav){width:960px}[data-dsh-settings-section]:has(.dshSettingsNav)>nav{width:220px;overflow-x:hidden}[data-dsh-settings-section=desktop-messages]:has(.dshSettingsNav){width:1120px}
          @media(max-width:640px){[data-dsh-settings-section]:has(.dshSettingsNav){max-width:calc(100vw - 24px)}.dshSettingsRemote{height:max(300px,calc(100vh - 280px))}}
        `
        document.head.appendChild(style)
        return () => style.remove()
      }, 'desktop-settings: owned styles')
      const register = (name, id, Component, extra = {}) => ctx.slots.inject(name, () => ctx.slots.register({ name, id, locale: NS, ...extra, inject: () => ({ t }) }, Component))
      register('settings.navigation', 'desktop-navigation', Navigation)
      register('settings.general.layout', 'desktop-general', GeneralLayout)
      register('settings.actions.layout', 'desktop-actions', ActionLayout)
      register('settings.plugins.layout', 'desktop-extensions', ExtensionsLayout)
      register('settings.section', 'desktop-usage', Usage, { order: 16, label: () => t('usage') })
      register('settings.section', 'desktop-about', About, { order: 90, label: () => t('about') })
      register('settings.section', 'desktop-messages', Messages, { order: 95, label: () => t('messages') })
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
      register('sidebar.footer.action', 'desktop-messages', MessageEntry, { order: 5 })
    }
    return { apply, inject: ['slots', 'locale'] }
  }
})
