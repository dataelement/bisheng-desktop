window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { MenuItemButton } = require('@deepseek-ai/dsh-client-ui-primitives')

    // Paths are copied from build/bisheng-logo-mark.svg. Keeping the browser
    // occupant self-contained makes it replayable when Harness loads plugins
    // from an installed Profile rather than the repository.
    const BISHENG_MARK_PATHS = [
      'M697.188 502.5H764.315C801.418 502.5 831.503 532.585 831.503 569.688V578.317C831.503 615.42 794.4 645.505 764.315 645.505H697.188C660.085 645.505 630 608.402 630 578.317V569.688C630 532.585 667.102 502.5 697.188 502.5Z',
      'M965.863 502.5H1503.17C1540.27 502.5 1570.36 532.585 1570.36 569.688V578.317C1570.36 615.42 1533.25 645.505 1503.17 645.505H965.863C928.761 645.505 898.676 608.402 898.676 578.317V569.688C898.676 532.585 935.778 502.5 965.863 502.5Z',
      'M764.363 752.749H1704.69C1741.79 752.749 1771.88 782.834 1771.88 819.936V828.566C1771.88 865.668 1734.78 895.754 1704.69 895.754H764.363C727.261 895.754 697.176 858.651 697.176 828.566V819.936C697.176 782.834 734.278 752.749 764.363 752.749Z',
      'M764.363 1003H1436.01C1473.12 1003 1503.2 1033.09 1503.2 1070.19V1078.82C1503.2 1115.92 1466.1 1146.01 1436.01 1146.01H764.363C727.261 1146.01 697.176 1108.91 697.176 1078.82V1070.19C697.176 1033.09 734.278 1003 764.363 1003Z',
      'M764.363 1253.26H1570.35C1607.45 1253.26 1637.53 1283.34 1637.53 1320.44V1329.07C1637.53 1366.18 1600.43 1396.26 1570.35 1396.26H764.363C727.261 1396.26 697.176 1359.16 697.176 1329.07V1320.44C697.176 1283.34 734.278 1253.26 764.363 1253.26Z',
      'M764.363 1503.5H1704.69C1741.79 1503.5 1771.88 1533.59 1771.88 1570.69V1579.32C1771.88 1616.42 1734.78 1646.51 1704.69 1646.51H764.363C727.261 1646.51 697.176 1609.41 697.176 1579.32V1570.69C697.176 1533.59 734.278 1503.5 764.363 1503.5Z',
      'M697.188 1753.76H1234.49C1271.6 1753.76 1301.68 1783.84 1301.68 1820.94V1829.57C1301.68 1866.68 1264.58 1896.76 1234.49 1896.76H697.188C660.085 1896.76 630 1859.66 630 1829.57V1820.94C630 1783.84 667.102 1753.76 697.188 1753.76Z',
      'M1436.04 1753.76H1503.17C1540.27 1753.76 1570.36 1783.84 1570.36 1820.94V1829.57C1570.36 1866.68 1533.26 1896.76 1503.17 1896.76H1436.04C1398.94 1896.76 1368.86 1859.66 1368.86 1829.57V1820.94C1368.86 1783.84 1405.96 1753.76 1436.04 1753.76Z'
    ]

    function BishengMark(props = {}) {
      const { size = 17, ...svgProps } = props
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 2400 2400',
          fill: 'none',
          'aria-hidden': 'true',
          ...svgProps
        },
        React.createElement('rect', { width: 2400, height: 2400, rx: 360, fill: '#000000' }),
        ...BISHENG_MARK_PATHS.map((d, index) =>
          React.createElement('path', { key: index, d, fill: 'white' })
        )
      )
    }

    function DesktopBrandMark() {
      return BishengMark({ size: 17 })
    }

    function DesktopBrandName() {
      return null
    }

    function ConversationBrandMark(props) {
      return BishengMark(props)
    }

    const LOCAL_OPEN_NS = 'desktop.localOpen'
    const LOCAL_OPEN_COPY = {
      zh: {
        label: '用本地应用打开',
        pending: '正在打开…',
        revealedDarwin: '已在访达中显示',
        revealedWindows: '已在文件资源管理器中显示',
        revealedOther: '已在文件管理器中显示',
        failed: '无法用本地应用打开'
      },
      en: {
        label: 'Open with local app',
        pending: 'Opening…',
        revealedDarwin: 'Shown in Finder',
        revealedWindows: 'Shown in File Explorer',
        revealedOther: 'Shown in the file manager',
        failed: 'Could not open with a local app'
      }
    }
    // macOS Archive Utility extracts a zip and then closes, so a successful
    // default open looks like a no-op. Revealing the archive keeps a visible result.
    const ARCHIVE_EXTENSIONS = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2'])

    function isArchivePath(absolutePath) {
      if (typeof absolutePath !== 'string' || absolutePath.length === 0) return false
      const name = absolutePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
      const dot = name.lastIndexOf('.')
      if (dot < 0 || dot === name.length - 1) return false
      return ARCHIVE_EXTENSIONS.has(name.slice(dot + 1))
    }

    function revealedCopyKey() {
      const platform = document.documentElement?.dataset?.platform
      if (platform === 'darwin') return 'revealedDarwin'
      if (platform === 'windows') return 'revealedWindows'
      return 'revealedOther'
    }

    function feedbackMessage(reason) {
      if (typeof reason === 'string') return reason.trim()
      if (reason instanceof Error) return reason.message.trim()
      if (reason && typeof reason === 'object' && typeof reason.message === 'string') {
        return reason.message.trim()
      }
      return ''
    }

    function OpenUnpreviewableFile({ absolutePath, openWorkspacePath, t }) {
      const [phase, setPhase] = React.useState('idle')
      const [feedback, setFeedback] = React.useState(null)
      const alive = React.useRef(true)
      const generation = React.useRef(0)
      const timer = React.useRef(0)
      const copy = (key) => t(key)
      React.useEffect(() => {
        setPhase('idle')
        setFeedback(null)
        return () => {
          generation.current += 1
          window.clearTimeout(timer.current)
        }
      }, [absolutePath])
      React.useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])
      const label = phase === 'pending' ? copy('pending') : copy('label')
      return React.createElement(
        'div',
        { 'data-textpreview-open-local-wrap': true },
        React.createElement('button', {
          type: 'button',
          'data-textpreview-open-local': true,
          'aria-busy': phase === 'pending' || undefined,
          disabled: phase === 'pending',
          onClick: () => {
            if (phase === 'pending') return
            const ticket = generation.current + 1
            generation.current = ticket
            window.clearTimeout(timer.current)
            setFeedback(null)
            setPhase('pending')
            const request = isArchivePath(absolutePath)
              ? { path: absolutePath, action: 'reveal' }
              : { path: absolutePath }
            let opened
            try {
              opened = openWorkspacePath(request)
            } catch (reason) {
              if (!alive.current || generation.current !== ticket) return
              setPhase('idle')
              setFeedback({
                kind: 'error',
                message: feedbackMessage(reason) || copy('failed')
              })
              return
            }
            void Promise.resolve(opened).then((result) => {
                if (!alive.current || generation.current !== ticket) return
                if (result && result.ok === false) {
                  setPhase('idle')
                  setFeedback({
                    kind: 'error',
                    message: feedbackMessage(result.error) || copy('failed')
                  })
                  return
                }
                setPhase('idle')
                if (!isArchivePath(absolutePath)) return
                setFeedback({ kind: 'success', message: copy(revealedCopyKey()) })
                timer.current = window.setTimeout(() => {
                  if (!alive.current || generation.current !== ticket) return
                  setFeedback((current) => current && current.kind === 'success' ? null : current)
                }, 2000)
              }, (reason) => {
                if (!alive.current || generation.current !== ticket) return
                setPhase('idle')
                setFeedback({
                  kind: 'error',
                  message: feedbackMessage(reason) || copy('failed')
                })
              })
          }
        },
          React.createElement('span', { 'data-textpreview-open-local-label': true }, label),
          React.createElement('span', {
            'data-textpreview-open-local-sizer': true,
            'aria-hidden': 'true'
          }, copy('label'))
        ),
        feedback && React.createElement('span', {
          role: feedback.kind === 'error' ? 'alert' : 'status',
          'data-textpreview-open-local-feedback': true,
          'data-kind': feedback.kind
        }, feedback.message)
      )
    }

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, deleteSession }) {
      const [, setMenuOpen] = useMenuOpenState()
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      const label = chinese ? '永久删除会话' : 'Delete session permanently'
      const warning = chinese
        ? `确定删除“${displayTitle || sessionId}”？工作区文件会保留。此操作无法撤销。`
        : `Delete “${displayTitle || sessionId}”? Workspace files are kept. This can’t be undone.`
      return React.createElement(MenuItemButton, {
        danger: true,
        onSelect: () => {
          setMenuOpen(false)
          if (!window.confirm(warning)) return
          void Promise.resolve().then(() => deleteSession(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function OpenSessionFolderMenuItem({ sessionId, useMenuOpenState, openInFinder }) {
      const [, setMenuOpen] = useMenuOpenState()
      if (typeof window.dshDesktop?.openInFinder !== 'function') return null
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      const label = chinese ? '在文件管理器中打开' : 'Open in file manager'
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          void Promise.resolve().then(() => openInFinder(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function UnreadSessionMenuItem({ sessionId, unread, onUnreadChange, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const chinese = document.documentElement.lang?.toLowerCase().startsWith('zh')
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          onUnreadChange(sessionId, !unread)
        }
      }, unread ? (chinese ? '标为已读' : 'Mark as read') : (chinese ? '标为未读' : 'Mark as unread'))
    }

    const inject = ['slots', 'locale', 'remote', 'remote.session', 'sessions', 'uiWorkspace']
    function apply(ctx) {
      // `remote` and `remote.session` are separate inject names. Reading
      // `ctx.remote` without declaring `remote` throws and unmounts this slot.
      const remote = ctx.remote
      const locale = ctx.locale
      ctx.effect(() => locale.register(LOCAL_OPEN_NS, LOCAL_OPEN_COPY), 'desktop local open locale')
      ctx.effect(() => {
        const id = 'dsh-desktop-preset-toolbar-style'
        let style = document.getElementById(id)
        if (!style || style.tagName !== 'STYLE') {
          style = document.createElement('style')
          style.id = id
        }
        style.textContent = `
          [data-dsh-sidebar-brand-identity] { display:none !important; }
          :root { --dsh-page-title-top-spacing:56px; }
          /* Top-level page titles align with the sidebar brand row. Keep
             conversation chrome and detail/dialog headers in their own layout. */
          [data-plugin-panel] > header[data-window-drag] {
            padding-top:var(--dsh-page-title-top-spacing);
          }
          [data-dsh-preset-heading] { display:flex; align-items:center; flex-wrap:wrap; gap:12px 16px; }
          [data-dsh-preset-heading] h2 { margin:0; }
          [data-dsh-preset-actions] { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-left:auto; }
          [data-dsh-preset-actions] button { white-space:nowrap; }
          [data-dsh-preset-search] { margin-bottom:16px; }
          [data-dsh-preset-search] input[type=search] {
            box-sizing:border-box; width:100%; min-width:0; height:36px;
            border:1px solid var(--dsw-alias-border-l2); border-radius:10px;
            background:var(--dsw-alias-bg-module-platform); color:var(--dsw-alias-label-primary);
            padding:0 12px; font:inherit; font-size:13px;
          }
          [data-dsh-preset-search] input[type=search]::placeholder { color:var(--dsw-alias-label-caption); }
          [data-dsh-preset-search] input[type=search]:focus-visible {
            outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px;
            background:var(--dsw-alias-bg-base);
          }
          [data-textpreview-open-local-wrap] {
            display:flex; flex-direction:column; align-items:center; gap:8px;
            min-width:0; max-width:100%;
          }
          [data-textpreview-open-local] {
            box-sizing:border-box; appearance:none; -webkit-appearance:none;
            display:inline-grid; place-items:center;
            height:36px; margin:0; padding:6px 14px;
            border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md);
            background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
            font-family:var(--dsw-font-family); font-size:14px; line-height:20px;
            white-space:nowrap; cursor:pointer;
          }
          [data-textpreview-open-local] > span { grid-area:1 / 1; }
          [data-textpreview-open-local-sizer] { visibility:hidden; }
          [data-textpreview-open-local]:hover:not(:disabled),
          [data-textpreview-open-local]:focus:not(:disabled) {
            background:var(--dsw-alias-interactive-bg-hover);
          }
          [data-textpreview-open-local]:focus-visible {
            outline:2px solid var(--dsw-alias-label-primary); outline-offset:2px;
          }
          [data-textpreview-open-local]:disabled { cursor:default; }
          [data-textpreview-open-local-feedback] {
            margin:0; max-width:100%; color:var(--dsw-alias-label-secondary);
            font-size:12px; line-height:1.5; text-align:center; overflow-wrap:anywhere;
          }
          [data-textpreview-open-local-feedback][data-kind='error'] {
            color:var(--dsw-alias-state-error-primary);
          }
        `
        document.head.appendChild(style)
        return () => style.remove()
      })
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register(
              { name: 'conversation.hero.brand.mark' },
              ConversationBrandMark
            )
          })
        )
      )
      ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () =>
        ctx.slots.register({
          name: 'sidebar.right.tab.document.unpreviewable',
          id: 'desktop-open-local',
          locale: LOCAL_OPEN_NS,
          inject: () => ({
            t: locale.bind(LOCAL_OPEN_NS),
            openWorkspacePath: (request) => remote.session.openWorkspacePath(request)
          })
        }, OpenUnpreviewableFile)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-delete-session',
          order: 900,
          inject: () => ({
            deleteSession: (sessionId) => {
              const workspace = ctx.get('uiWorkspace')
              if (!workspace) throw new Error('Workspace navigation is unavailable')
              return workspace.deleteSession(sessionId)
            }
          })
        }, DeleteSessionMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-open-session-folder',
          order: 800,
          inject: () => ({
            openInFinder: (sessionId) => {
              const cwd = ctx.get('sessions').list.getSnapshot().byId[sessionId]?.cwd
              if (!cwd) throw new Error('Session workspace directory is unavailable')
              return window.dshDesktop.openInFinder(cwd)
            }
          })
        }, OpenSessionFolderMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-unread-session',
          order: 350
        }, UnreadSessionMenuItem)
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
