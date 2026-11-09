window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const {
      Menu, MenuItemButton, Modal, Button, HoverCard, relativeTime, ReferenceIconRegular,
      IconChevronRightOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
      IconNewChatOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular, IconTriangleRightFillRegular
    } = require('@deepseek-ai/dsh-client-ui-primitives')

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

    function ConversationBrandMark({ navigation, ...props }) {
      const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      const icon = state.navigation?.branding?.assistantIcon
      const [failedImage, setFailedImage] = React.useState(null)
      if (icon?.enabled === false) return null
      if (icon?.image && failedImage !== icon.image) {
        return React.createElement('img', { width: props.size, height: props.size, className: props.className,
          src: icon.image, alt: '', style: { objectFit: 'contain', flex: 'none' }, referrerPolicy: 'no-referrer',
          onError: () => setFailedImage(icon.image) })
      }
      return BishengMark(props)
    }

    function ConversationBrandTitle({ navigation, t }) {
      const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      return React.createElement('span', { 'data-dsh-welcome-title': true }, state.navigation?.branding?.welcomeMessage || t('welcomeMessage'))
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

    const DELETE_SESSION_NS = 'dsh-desktop-delete-session'

    // The shell owns the request: closing a row menu unmounts its occupants.
    function createSessionDeletion(deleteSession) {
      let state = null
      let active = true
      const listeners = new Set()
      const publish = (next) => {
        state = next
        listeners.forEach(listener => listener())
      }
      return {
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot: () => state,
        request: (sessionId, displayTitle, context) => {
          if (active && state === null) publish({ sessionId, displayTitle, context, busy: false, error: null })
        },
        close: () => { if (state && state.busy === false) publish(null) },
        confirm: async () => {
          if (state === null || state.busy || active === false) return
          const pending = { ...state, busy: true, error: null }
          publish(pending)
          try {
            await deleteSession(pending.sessionId, pending.context)
            if (active && state === pending) publish(null)
          } catch (reason) {
            if (active && state === pending) {
              publish({ ...pending, busy: false, error: reason instanceof Error ? reason.message : String(reason) })
            }
          }
        },
        reset: () => publish(null),
        dispose: () => { active = false; publish(null); listeners.clear() }
      }
    }

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, deletion, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      return React.createElement(MenuItemButton, {
        danger: true,
        onSelect: () => {
          setMenuOpen(false)
          // Let Menu restore its trigger focus before Modal captures return focus.
          setTimeout(() => deletion.request(sessionId, displayTitle), 0)
        }
      }, t('menu'))
    }

    function DeleteSessionDialog({ deletion, t }) {
      const request = React.useSyncExternalStore(deletion.subscribe, deletion.getSnapshot)
      return React.createElement(Modal, {
        open: request !== null,
        onClose: deletion.close,
        title: t('title'),
        closeLabel: t('close'),
        description: request ? t('description', { name: request.displayTitle || request.sessionId }) : '',
        footer: request && React.createElement(React.Fragment, null,
          React.createElement(Button, {
            variant: 'outline', disabled: request.busy, onClick: deletion.close,
            'data-modal-autofocus': true
          }, t('cancel')),
          React.createElement(Button, {
            variant: 'primary', disabled: request.busy, onClick: deletion.confirm
          }, t(request.busy ? 'pending' : 'confirm')))
      }, request?.busy && React.createElement('p', { role: 'status' }, t('pending')),
      request && request.error !== null && React.createElement('div', { role: 'alert' },
        React.createElement('p', null, t('failed')),
        React.createElement('p', null, request.error)))
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

    const CLOUD_DELETE_NS = 'desktop.cloudChatDelete'
    const CLOUD_DELETE_COPY = {
      zh: { menu: '删除', actions: '会话操作', title: '删除会话', close: '关闭', cancel: '取消', confirm: '删除会话', description: '确定删除“{name}”？会话及其聊天记录将被永久删除。', pending: '正在删除会话…', failed: '删除失败，请重试。' },
      en: { menu: 'Delete', actions: 'Conversation actions', title: 'Delete conversation', close: 'Close', cancel: 'Cancel', confirm: 'Delete conversation', description: 'Permanently delete “{name}” and its chat history?', pending: 'Deleting conversation…', failed: 'Deletion failed. Please try again.' }
    }
    const PROJECTS_NS = 'desktop.chatProjects'
    const PROJECTS_COPY = {
      zh: { title: '对话项目', create: '新建项目', rename: '重命名项目', remove: '删除项目', actions: '项目操作', startChat: '在此项目新建对话', empty: '暂无对话', name: '项目名称', nameHelp: '请输入 1–30 个字符', cancel: '取消', save: '保存', close: '关闭', move: '移入项目', moveOut: '移出项目', deleteHelp: '删除“{name}”后，其中的对话将移回对话列表，聊天记录会保留。', failed: '项目保存失败，请重试。', unavailable: '项目数据无法读取，点击重试。', retry: '重试' },
      en: { title: 'Chat Project', create: 'New project', rename: 'Rename project', remove: 'Delete project', actions: 'Project actions', startChat: 'New chat in this project', empty: 'No conversations yet', name: 'Project name', nameHelp: 'Enter 1–30 characters', cancel: 'Cancel', save: 'Save', close: 'Close', move: 'Move to project', moveOut: 'Move out of project', deleteHelp: 'Delete “{name}”? Its conversations will return to the conversation list. Chat history will be kept.', failed: 'Could not save projects. Please try again.', unavailable: 'Could not read projects. Retry.', retry: 'Retry' }
    }
    Object.assign(PROJECTS_COPY.zh, { pending: '正在保存或加载…', connecting: '正在连接项目同步…', degraded: '已保存，同步暂有延迟', offline: '项目尚未同步，正在重连…', auth_required: '请重新登录以同步项目', unsupported: '当前服务不支持项目同步，请升级服务端。', import: '旧版项目迁移结果', migrationRunning: '正在自动迁移旧版项目…', migrationRetry: '旧版项目暂未迁移，正在自动重试。原记录已保留。', importDone: '迁移完成，{count} 项未迁移或保留了云端归属。' })
    Object.assign(PROJECTS_COPY.en, { pending: 'Saving or loading…', connecting: 'Connecting project sync…', degraded: 'Saved. Sync is delayed.', offline: 'Projects are not synced. Reconnecting…', auth_required: 'Sign in again to sync projects.', unsupported: 'This server does not support project sync. Update the server.', import: 'Legacy migration results', migrationRunning: 'Migrating legacy projects automatically…', migrationRetry: 'Retrying legacy project migration automatically. Original records are kept.', importDone: 'Migration finished. {count} items were skipped or kept their cloud assignment.' })
    Object.assign(PROJECTS_COPY.zh, { importReason_cloud_membership_kept: '已保留云端归属', importReason_project_unavailable: '项目已不可用', importReason_conversation_unavailable: '对话已删除或不属于当前账号', importReason_invalid_date: '创建日期无效', importReason_invalid_local_data: '本机记录损坏或格式无效', importReason_unknown: '此项未导入', moreResults: '查看更多' })
    Object.assign(PROJECTS_COPY.en, { importReason_cloud_membership_kept: 'Cloud assignment kept', importReason_project_unavailable: 'Project unavailable', importReason_conversation_unavailable: 'Conversation deleted or owned by another account', importReason_invalid_date: 'Invalid creation date', importReason_invalid_local_data: 'Invalid local record', importReason_unknown: 'Item not imported', moreResults: 'Show more' })
    /** Server projections own project data; local keys remain import-only. */
    function createChatProjects() {
      const empty = () => ({ projects: [], assignments: {} })
      let state = { scope: undefined, epoch: undefined, ...empty(), expanded: {}, rows: {}, assigning: new Set(), editor: null, phase: 'idle', error: null, busy: false, revision: '0', connection: 'connecting', migrationAvailable: false, migrationPhase: 'idle', migrationResult: null, migrationDetails: [], search: { query: '', items: [], phase: 'idle', nextCursor: null } }
      const listeners = new Set()
      let readPending, reading = false, disposed = false
      let generation = 0, searchRequest = 0
      let migrationRun, migrationTimer, migrationAttempt = 0
      const rowRequests = new Map()
      const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,255}$/u.test(value)
      const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
      const legacyKey = () => 'desktop.chatProjects.v1:' + state.scope
      const same = (scope, epoch) => !disposed && state.scope === scope && state.epoch === epoch
      const apply = snapshot => {
        if (!snapshot || snapshot.epoch !== state.epoch || !state.scope || disposed) return
        if (!Array.isArray(snapshot.projects) || !snapshot.assignments || !/^(0|[1-9]\d*)$/u.test(snapshot.revision || '')) { publish({ phase: 'error', error: 'unsupported' }); return }
        if (BigInt(snapshot.revision) < BigInt(state.revision)) return
        const changed = snapshot.revision !== state.revision
        const recovered = (snapshot.connection === 'live' && state.connection !== 'live') || (snapshot.phase === 'ready' && state.phase === 'error')
        publish({ projects: snapshot.projects, assignments: snapshot.assignments, phase: snapshot.phase, connection: snapshot.connection, revision: snapshot.revision, identity: snapshot.identity, identityLabel: snapshot.identityLabel, error: snapshot.error || null })
        if (snapshot.phase === 'ready') void migrate()
        if (changed || recovered) {
          for (const id of Object.keys(state.expanded)) if (state.expanded[id]) void load(id)
          if (state.search.query) void search(state.search.query)
        }
      }
      const read = async () => {
        if (!state.scope || !Number.isSafeInteger(state.epoch) || disposed) return
        if (reading) return readPending
        if (typeof window.dshEnterpriseChat?.projectsState !== 'function') { publish({ phase: 'error', error: 'unsupported' }); return }
        const scope = state.scope, epoch = state.epoch, request = generation
        reading = true
        readPending = (async () => {
          try {
            const snapshot = await window.dshEnterpriseChat.projectsState()
            if (same(scope, epoch) && request === generation) apply(snapshot)
          } catch { if (same(scope, epoch) && request === generation) publish({ phase: 'error', error: 'unavailable' }) }
          finally { if (request === generation) { reading = false; readPending = undefined } }
        })()
        return readPending
      }
      const load = async (id, more = false) => {
        if (!state.scope || !state.projects.some(project => project.id === id)) return
        const scope = state.scope, epoch = state.epoch
        const previous = state.rows[id] || { items: [], nextCursor: null, phase: 'idle' }
        if (more && !previous.nextCursor) return
        const request = (rowRequests.get(id) || 0) + 1
        rowRequests.set(id, request)
        publish({ rows: { ...state.rows, [id]: { ...previous, phase: 'loading' } } })
        try {
          const page = await window.dshEnterpriseChat.projectConversations({ project_id: id, ...(more ? { cursor: previous.nextCursor } : {}) }, epoch)
          if (!same(scope, epoch) || rowRequests.get(id) !== request) return
          if (page.epoch !== epoch || BigInt(page.revision) < BigInt(state.revision)) { void load(id); return }
          const items = [...new Map([...(more ? previous.items : []), ...page.items].map(item => [item.id, item])).values()]
          publish({ rows: { ...state.rows, [id]: { items, nextCursor: page.nextCursor, phase: 'ready', revision: page.revision } } })
        } catch {
          if (same(scope, epoch) && rowRequests.get(id) === request) publish({ rows: { ...state.rows, [id]: { ...previous, phase: 'error' } } })
        }
      }
      const search = async (query, more = false) => {
        query = String(query || '').trim()
        const request = ++searchRequest, scope = state.scope, epoch = state.epoch
        const previous = state.search
        if (!query || !scope) { publish({ search: { query, items: [], phase: 'idle', nextCursor: null } }); return }
        if (more && !previous.nextCursor) return
        publish({ search: { ...previous, query, phase: 'loading' } })
        try {
          const page = await window.dshEnterpriseChat.projectConversations({ query, ...(more ? { cursor: previous.nextCursor } : {}) }, epoch)
          if (!same(scope, epoch) || request !== searchRequest || page.epoch !== epoch) return
          const items = [...new Map([...(more ? previous.items : []), ...page.items].map(item => [item.id, item])).values()]
          publish({ search: { query, items, phase: 'ready', nextCursor: page.nextCursor } })
        } catch { if (same(scope, epoch) && request === searchRequest) publish({ search: { ...previous, query, phase: 'error' } }) }
      }
      const action = async (operation, requestId) => {
        const scope = state.scope, epoch = state.epoch
        if (!scope || !Number.isSafeInteger(epoch)) throw new Error('Project identity unavailable.')
        const result = await window.dshEnterpriseChat.projectAction({ ...operation, request_id: requestId || crypto.randomUUID() }, epoch)
        if (!same(scope, epoch) || result.epoch !== epoch) throw new Error('Project identity changed.')
        await read()
        return result
      }
      const importLegacy = async () => {
        const scope = state.scope, epoch = state.epoch
        const raw = window.localStorage.getItem(legacyKey())
        if (!raw || raw.length > 4 * 1024 * 1024) throw new Error('Invalid legacy project data.')
        const data = JSON.parse(raw)
        if (!data || !Array.isArray(data.projects) || !data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) throw new Error('Invalid legacy project data.')
        const sourceKey = 'desktop.chatProjects.importSource.v1:' + scope
        let source = window.localStorage.getItem(sourceKey)
        if (!source) { source = crypto.randomUUID(); window.localStorage.setItem(sourceKey, source) }
        let skipped = 0
        const details = []
        const projects = data.projects.flatMap((project, index) => {
          if (!project || !validId(project.id) || typeof project.name !== 'string' || !project.name.trim() || project.name.trim().length > 30) { skipped++; details.push({ id: '#' + (index + 1), status: 'invalid_local_data' }); return [] }
          return [{ legacy_id: project.id, name: project.name.trim() }]
        })
        const memberships = Object.entries(data.assignments).flatMap(([chat_id, legacy_project_id]) => {
          if (!validId(chat_id) || chat_id === 'new' || typeof legacy_project_id !== 'string') { skipped++; details.push({ id: chat_id, status: 'invalid_local_data' }); return [] }
          return [{ chat_id, legacy_project_id }]
        })
        const submit = async (projects, memberships) => {
          if (!same(scope, epoch)) throw new Error('Project identity changed.')
          const result = await action({ operation: 'import', source_client_id: source, projects, memberships }, crypto.randomUUID())
          skipped += result.outcome.items?.filter(item => item.status !== 'imported').length || 0
          details.push(...(result.outcome.items || []).filter(item => item.status !== 'imported').map(item => ({ id: item.chat_id || item.legacy_id || '', status: item.status })))
          if (same(scope, epoch)) publish({ migrationDetails: [...details] })
        }
        for (let offset = 0; offset < projects.length; offset += 100) await submit(projects.slice(offset, offset + 100), [])
        for (let offset = 0; offset < memberships.length; offset += 500) await submit([], memberships.slice(offset, offset + 500))
        if (!same(scope, epoch)) return
        window.localStorage.setItem('desktop.chatProjects.importDone.v1:' + scope, source)
        publish({ migrationAvailable: false, migrationPhase: 'done', migrationResult: skipped, migrationDetails: details })
      }
      const migrate = async () => {
        if (!state.migrationAvailable || state.phase !== 'ready' || migrationRun || migrationTimer || disposed) return
        const scope = state.scope, epoch = state.epoch, token = {}
        migrationRun = token
        publish({ migrationPhase: 'busy' })
        try { await importLegacy(); if (same(scope, epoch)) migrationAttempt = 0 }
        catch {
          if (same(scope, epoch)) {
            publish({ migrationPhase: 'error' })
            migrationTimer = setTimeout(() => { migrationTimer = undefined; void migrate() }, [2000, 5000, 10000, 30000][Math.min(migrationAttempt++, 3)])
          }
        } finally { if (migrationRun === token) migrationRun = undefined }
      }
      return {
        snapshot: () => state,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        apply, reload: read, load, search,
        setScope(scope, epoch) {
          scope = validId(scope) ? scope : undefined
          if (scope === state.scope && epoch === state.epoch) { if (scope && state.phase === 'idle') void read(); return }
          generation++; searchRequest++; rowRequests.clear(); reading = false; readPending = undefined
          clearTimeout(migrationTimer); migrationTimer = undefined; migrationRun = undefined; migrationAttempt = 0
          let migrationAvailable = false
          try { migrationAvailable = !!scope && window.localStorage.getItem('desktop.chatProjects.v1:' + scope) !== null && !window.localStorage.getItem('desktop.chatProjects.importDone.v1:' + scope) }
          catch { /* Import availability cannot block server projects. Original keys remain intact. */ }
          publish({ scope, epoch, ...empty(), expanded: {}, rows: {}, assigning: new Set(), editor: null, busy: false, phase: scope ? 'loading' : 'idle', error: null, revision: '0', connection: 'connecting', migrationAvailable, migrationPhase: 'idle', migrationResult: null, migrationDetails: [], search: { query: '', items: [], phase: 'idle', nextCursor: null } })
          if (scope) void read()
        },
        async assign(id, projectId) {
          if (!validId(id) || id === 'new' || state.phase !== 'ready' || state.assigning.has(id) ||
            (projectId && (!state.projects.some(project => project.id === projectId) || state.assignments[id] === projectId))) return false
          const scope = state.scope, epoch = state.epoch
          publish({ assigning: new Set([...state.assigning, id]), error: null })
          try {
            await action({ operation: 'assign', chat_id: id, project_id: projectId || null })
            return same(scope, epoch)
          } catch {
            if (same(scope, epoch)) publish({ error: 'failed' })
            return false
          } finally {
            if (same(scope, epoch)) {
              const assigning = new Set(state.assigning)
              assigning.delete(id)
              publish({ assigning })
            }
          }
        },
        toggle(id) {
          const expanded = { ...state.expanded, [id]: !state.expanded[id] }
          publish({ expanded })
          if (expanded[id]) void load(id)
        },
        reveal(id) {
          if (!state.projects.some(project => project.id === id)) return
          publish({ expanded: { ...state.expanded, [id]: true } })
          void load(id)
        },
        edit(mode, id, title) {
          if (mode !== 'import' && state.phase === 'ready') publish({ editor: { mode, id, title, requestId: crypto.randomUUID() }, error: null })
        },
        close() { if (!state.busy) publish({ editor: null, error: null }) },
        showImportResults() { publish({ editor: { mode: 'import', done: true, limit: 50 }, error: null }) },
        moreImportResults() { if (state.editor) publish({ editor: { ...state.editor, limit: (state.editor.limit || 50) + 50 } }) },
        async confirm(name = '') {
          const editor = state.editor, scope = state.scope, epoch = state.epoch
          if (!editor || editor.done || state.busy) return
          const trimmed = name.trim()
          if (['create', 'rename'].includes(editor.mode) && (!trimmed || trimmed.length > 30)) return
          publish({ busy: true, error: null })
          try {
            let operation
            {
              if (editor.mode === 'create') operation = { operation: 'create', name: trimmed, ...(editor.id ? { chat_id: editor.id } : {}) }
              else if (editor.mode === 'rename') operation = { operation: 'rename', project_id: editor.id, name: trimmed }
              else if (editor.mode === 'remove') operation = { operation: 'delete', project_id: editor.id }
              if (!operation) return
              const result = await action(operation, editor.requestId)
              if (result.outcome.project_id && operation.operation === 'create') { publish({ expanded: { ...state.expanded, [result.outcome.project_id]: true } }); void load(result.outcome.project_id) }
            }
            if (same(scope, epoch)) publish({ editor: null, error: null })
          } catch { if (same(scope, epoch)) publish({ error: 'failed' }) }
          finally { if (same(scope, epoch)) publish({ busy: false }) }
        },
        dispose() { disposed = true; clearTimeout(migrationTimer); generation++; searchRequest++; rowRequests.clear(); listeners.clear() }
      }
    }
    function ChatProjectDialog({ store, state, t }) {
      const request = state.editor
      const [name, setName] = React.useState(request.mode === 'rename' ? request.title : '')
      const naming = request.mode === 'create' || request.mode === 'rename'
      const valid = !naming || (name.trim().length > 0 && name.trim().length <= 30)
      const formId = React.useId()
      return React.createElement(Modal, {
        open: true, onClose: store.close, title: t(request.mode), closeLabel: t('close'),
        description: request.mode === 'remove' ? t('deleteHelp', { name: request.title }) : undefined,
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { variant: 'outline', disabled: state.busy, onClick: store.close, 'data-modal-autofocus': request.mode === 'remove' || undefined }, t('cancel')),
          !request.done && React.createElement(Button, { variant: 'primary', type: 'submit', form: formId, disabled: !valid || state.busy }, t(state.busy ? 'pending' : request.mode === 'remove' ? 'remove' : request.mode === 'import' ? 'import' : 'save')))
      }, React.createElement('form', { id: formId, className: 'dshChatProjectForm', onSubmit: event => { event.preventDefault(); if (valid) store.confirm(name) } },
        naming && React.createElement('label', null, t('name'), React.createElement('input', { value: name, disabled: state.busy, maxLength: 30, required: true,
          placeholder: t('nameHelp'), 'aria-label': t('name'), 'data-modal-autofocus': true, onChange: event => setName(event.target.value) })),
        state.busy && React.createElement('p', { role: 'status' }, t('pending')),
        request.mode === 'import' && request.done && React.createElement('p', { role: 'status' }, t('importDone', { count: state.migrationResult })),
        request.mode === 'import' && state.migrationDetails.length > 0 && React.createElement('ul', null, ...state.migrationDetails.slice(0, request.limit || 50).map((item, index) => React.createElement('li', { key: index }, item.id + ': ' + t('importReason_' + (['cloud_membership_kept', 'project_unavailable', 'conversation_unavailable', 'invalid_date', 'invalid_local_data'].includes(item.status) ? item.status : 'unknown'))))),
        request.mode === 'import' && state.migrationDetails.length > (request.limit || 50) && React.createElement(Button, { type: 'button', variant: 'outline', onClick: store.moreImportResults }, t('moreResults')),
        state.error && React.createElement('p', { role: 'alert' }, t(state.error))))
    }
    // Use the same Menu for the ellipsis, a secondary click, and the keyboard's context-menu shortcut.
    function useSidebarRowMenu() {
      const [source, setSource] = React.useState(null)
      const open = (event, input) => {
        if (event.defaultPrevented || event.target.closest('[role="menu"]')) return
        event.preventDefault()
        event.stopPropagation()
        setSource(input)
      }
      return {
        open: source !== null,
        fromKeyboard: source === 'keyboard',
        close: () => setSource(null),
        closeOnPointerLeave: source === 'pointer',
        toggle: event => setSource(current => current ? null : event.detail ? 'pointer' : 'keyboard'),
        onContextMenu: event => open(event, 'pointer'),
        onKeyDown: event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event, 'keyboard')
        }
      }
    }
    function ChatProjectRow({ project, chats, state, currentChat, navigation, t, projectText, deleteText, now }) {
      const menu = useSidebarRowMenu()
      const store = navigation.projects
      const open = !!state.expanded[project.id]
      const panelId = React.useId()
      const current = state.assignments[currentChat] === project.id
      return React.createElement('div', { className: 'dshChatProject', 'data-chat-project': project.id },
        React.createElement('div', { className: 'dshSidebarItem dshChatProjectHeading', 'data-menu-open': menu.open || undefined, onContextMenu: menu.onContextMenu, onKeyDown: menu.onKeyDown },
          React.createElement('button', { type: 'button', className: 'dshChatProjectToggle', 'aria-expanded': open, 'aria-controls': open ? panelId : undefined, onClick: () => store.toggle(project.id), title: project.name },
            React.createElement(open ? IconFolderOpenRegular : IconFolderCloseRegular, { className: 'dshChatProjectFolder', 'data-current': current || undefined, 'aria-hidden': true }),
            React.createElement(IconTriangleRightFillRegular, { className: 'dshChatProjectChevron', 'aria-hidden': true }),
            React.createElement('span', { className: 'dshChatProjectName' }, project.name)),
          React.createElement('div', { className: 'dshSidebarItemTools' },
            React.createElement(Menu, { open: menu.open, onClose: menu.close, closeOnPointerLeave: menu.closeOnPointerLeave, portal: true, align: 'end', autoFocus: true, dense: true,
              anchor: React.createElement('button', { type: 'button', className: 'dshChatProjectAction', 'aria-label': `${projectText('actions')} · ${project.name}`, 'aria-haspopup': 'menu', 'aria-expanded': menu.open, onClick: menu.toggle },
                React.createElement(IconEllipsisOutlineRegular, { 'aria-hidden': true }))
            }, ...['rename', 'remove'].map(mode => React.createElement(MenuItemButton, { key: mode, icon: React.createElement(mode === 'rename' ? IconEditOutlineRegular : IconTrashOutlineRegular), danger: mode === 'remove', onSelect: () => {
              menu.close()
              setTimeout(() => {
                const latest = store.snapshot()
                if (latest.epoch === state.epoch && latest.scope === state.scope) store.edit(mode, project.id, project.name)
              }, 0)
            } }, projectText(mode)))),
            React.createElement('button', { type: 'button', className: 'dshChatProjectAction', 'aria-label': `${projectText('startChat')} · ${project.name}`, title: projectText('startChat'), onClick: () => navigation.startProjectChat(project.id) },
              React.createElement(IconNewChatOutlineRegular, { 'aria-hidden': true })))),
        open && React.createElement('div', { id: panelId },
          ...chats.map(item => React.createElement(CloudHistoryRow, { key: item.id, item, now, selected: currentChat === item.id, navigation, t, projectText, deleteText })),
          state.rows[project.id]?.phase === 'loading' && React.createElement('div', { role: 'status', className: 'dshChatProjectEmpty' }, projectText('pending')),
          state.rows[project.id]?.phase === 'error' && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', onClick: () => { void store.load(project.id) } }, projectText('unavailable')),
          state.rows[project.id]?.nextCursor && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', disabled: state.rows[project.id]?.phase === 'loading', onClick: () => { void store.load(project.id, true) } }, t('more')),
          chats.length === 0 && state.rows[project.id]?.phase === 'ready' && React.createElement('div', { className: 'dshChatProjectEmpty' }, projectText('empty'))))
    }
    function ChatProjects({ navigation, t, projectText, deleteText, now }) {
      const state = React.useSyncExternalStore(navigation.projects.subscribe, navigation.projects.snapshot)
      const host = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      const grouped = React.useMemo(() => {
        const groups = new Map()
        const items = new Map()
        // Project pages outlive ordinary-history refreshes. A cached or late
        // page must not restore an older title; equal timestamps prefer the page.
        for (const item of [...host.items, ...Object.values(state.rows).flatMap(page => page.items)]) {
          const previous = items.get(item.id)
          if (!previous || (Date.parse(item.updatedAt) || 0) >= (Date.parse(previous.updatedAt) || 0)) items.set(item.id, item)
        }
        for (const item of items.values()) {
          const id = state.assignments[item.id]
          if (typeof id !== 'string') continue
          if (!groups.has(id)) groups.set(id, [])
          groups.get(id).push(item)
        }
        return groups
      }, [host.items, state.assignments, state.rows])
      if (!host.connected || !state.scope) return null
      return React.createElement('section', { className: 'dshChatProjects', 'aria-label': projectText('title') },
        React.createElement('div', { className: 'dshHistoryHeading' }, React.createElement('span', null, projectText('title')),
          React.createElement('button', { type: 'button', className: 'dshChatProjectAction', disabled: state.phase !== 'ready', 'aria-label': projectText('create'), onClick: () => navigation.projects.edit('create') },
            React.createElement(IconPlusOutlineRegular, { 'aria-hidden': true }))),
        state.phase !== 'error' && state.connection !== 'live' && React.createElement('div', { role: 'status', className: 'dshHistoryNotice' }, projectText(state.connection)),
        ['busy', 'error'].includes(state.migrationPhase) && React.createElement('p', { role: 'status', className: 'dshHistoryNotice' }, projectText(state.migrationPhase === 'busy' ? 'migrationRunning' : 'migrationRetry')),
        state.migrationResult > 0 && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', onClick: navigation.projects.showImportResults }, projectText('importDone', { count: state.migrationResult })),
        state.projects.length === 0 && state.phase === 'ready' && React.createElement('button', { type: 'button', className: 'dshChatProjectCreate', onClick: () => navigation.projects.edit('create') }, `+ ${projectText('create')}`),
        ...state.projects.map(project => React.createElement(ChatProjectRow, { key: `${state.scope}:${state.epoch}:${project.id}`, project, chats: grouped.get(project.id) || [], state, currentChat: host.mode === 'chat' && !host.pageId ? host.conversationId : undefined, navigation, t, projectText, deleteText, now })),
        state.error && !state.editor && React.createElement('div', { role: 'alert', className: 'dshHistoryNotice' }, projectText(state.error),
          React.createElement('button', { type: 'button', className: 'dshHistoryNotice', onClick: navigation.projects.reload }, projectText('retry'))))
    }
    const MODES_NS = 'desktop.chatWork'
    const MODES_COPY = {
      zh: { welcomeMessage: '来一起创造', welcome: '欢迎来到', newConversation: '新建对话', navigation: '导航', moreNavigation: '更多', recent: '对话', projects: '工作区', all: '所有会话', results: '搜索结果', cloud: '云端聊天', local: '本地工作', recentEmpty: '暂无最近会话', recentSearchEmpty: '当前列表没有匹配的会话', chat: '对话', work: '工作', label: '对话与工作', loading: '正在连接企业聊天…', error: '企业聊天连接失败，请重试', retry: '重新连接', refresh: '刷新聊天记录', historyLoading: '正在加载聊天记录…', historyError: '加载失败，点击重试', empty: '暂无聊天记录', more: '加载更多', newChat: '新聊天', signIn: '登录企业账号', signInTitle: '登录后使用聊天', signInDescription: '聊天由企业平台提供。登录后，即可使用平台中的模型和对话记录。', continueWork: '继续使用工作', close: '关闭' },
      en: { welcomeMessage: "Let's Create Together", welcome: 'Welcome', newConversation: 'New conversation', navigation: 'Navigation', moreNavigation: 'More', recent: 'Conversations', projects: 'Workspaces', all: 'All conversations', results: 'Search results', cloud: 'Cloud chat', local: 'Local work', recentEmpty: 'No recent conversations', recentSearchEmpty: 'No matches in the current list', chat: 'Chat', work: 'Work', label: 'Chat and Work', loading: 'Connecting to enterprise Chat…', error: 'Could not connect to enterprise Chat. Try again.', retry: 'Reconnect', refresh: 'Refresh Chat history', historyLoading: 'Loading history…', historyError: 'Loading failed. Retry', empty: 'No chats yet', more: 'Load more', newChat: 'New chat', signIn: 'Sign in to your enterprise account', signInTitle: 'Sign in to use Chat', signInDescription: 'Chat is provided by your enterprise platform. Sign in to use its models and conversations.', continueWork: 'Continue in Work', close: 'Close' }
    }
    Object.assign(MODES_COPY.zh, { 'time.now': '刚刚', 'time.minutes': '{n}分钟', 'time.hours': '{n}小时', 'time.days': '{n}天', 'time.months': '{n}个月', 'time.years': '{n}年', 'time.ago': '{t}前' })
    Object.assign(MODES_COPY.en, { 'time.now': 'now', 'time.minutes': '{n}min', 'time.hours': '{n}h', 'time.days': '{n}d', 'time.months': '{n}mo', 'time.years': '{n}y', 'time.ago': '{t} ago' })
    /**
     * Host tokens the embedded enterprise document reuses. It cannot read the host's CSS, so the
     * presenter resolves them here and sends plain channels with the presentation.
     */
    const PALETTE_TOKENS = {
      surface: '--dsw-alias-bg-layer-2', raised: '--dsw-alias-bg-layer-3', strong: '--dsw-alias-bg-overlay',
      labelPrimary: '--dsw-alias-label-primary', labelSecondary: '--dsw-alias-label-secondary', labelTertiary: '--dsw-alias-label-tertiary',
      borderBase: '--dsw-alias-border-l2', borderDeep: '--dsw-alias-border-l3', composer: '--dsw-specific-input-major'
    }
    // A token that does not resolve leaves the fallback behind, which is how a missing one is told
    // apart from a real color; the probe never renders, so the sentinel is never seen.
    const PALETTE_FALLBACK = [1, 2, 3]

    function samplePalette() {
      if (!document.body) return undefined
      const probe = document.createElement('span')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none'
      document.body.appendChild(probe)
      try {
        const read = (token) => {
          probe.style.color = `var(${token}, rgb(1, 2, 3))`
          const channels = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number)
          if (channels.length < 3 || PALETTE_FALLBACK.every((channel, index) => channel === channels[index])) return undefined
          return channels
        }
        const surface = read(PALETTE_TOKENS.surface)
        if (!surface) return undefined
        const palette = {}
        for (const [role, token] of Object.entries(PALETTE_TOKENS)) {
          const channels = read(token)
          if (!channels) return undefined
          // Translucent host tokens (borders, hover fills) are flattened over the surface they sit on.
          const alpha = channels.length > 3 ? channels[3] : 1
          palette[role] = channels.slice(0, 3).map((channel, index) => Math.max(0, Math.min(255, Math.round(surface[index] + (channel - surface[index]) * alpha))))
        }
        const mask = read('--dsw-alias-bg-mask-1')
        if (mask) palette.mask = [...mask.slice(0, 3), mask[3] ?? 1]
        return palette
      } catch { return undefined } finally { probe.remove() }
    }

    let sampledPalette
    /**
     * The palette only moves with the theme, so a successful probe is kept per theme rather than run
     * per frame; a probe that found no tokens yet (theme styles still loading) is tried again next time.
     */
    function hostPalette() {
      const theme = document.body?.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      if (sampledPalette?.theme !== theme) {
        const value = samplePalette()
        sampledPalette = value ? { theme, value } : undefined
        return value
      }
      return sampledPalette.value
    }

    /** One renderer-owned mode/history controller shared by the content and sidebar slots. */
    function createChatNavigation(ctx) {
      let value = { mode: 'work', connected: false, phase: 'idle', epoch: undefined, items: [], page: 0, hasMore: false, historyPhase: 'idle', settingsOpen: false, signInPromptOpen: false, approvalsOpen: false, accountDialogOpen: false, settingsSurface: undefined, pageId: undefined, navigation: undefined, workLanding: false, nativeWork: true, panelOpen: false, activePanelId: null }
      const listeners = new Set()
      const projects = createChatProjects()
      let openRequest = 0
      let active = false, revision = 0, historyRequest = 0, historyDirty = false
      const publish = (patch) => { value = { ...value, ...patch }; listeners.forEach(fn => fn()) }
      const select = (mode) => {
        if (mode === 'chat' && !value.connected) {
          publish({ signInPromptOpen: true })
          return false
        }
        publish({ mode, pageId: undefined, signInPromptOpen: false })
        return true
      }
      const refreshHistory = async (more = false) => {
        if (!value.connected || !window.dshEnterpriseChat) return
        if (value.historyPhase === 'loading') { if (!more) historyDirty = true; return }
        const request = ++historyRequest, epoch = value.epoch
        const page = more ? value.page + 1 : 1
        const lastPage = more ? page : Math.max(1, value.page)
        publish({ historyPhase: 'loading' })
        try {
          let items = more ? [...value.items] : [], response, fetchedPage = page
          for (let next = page; next <= lastPage; next++) {
            response = await window.dshEnterpriseChat.history(next)
            if (!active || request !== historyRequest || epoch !== value.epoch) return
            if (response.epoch !== epoch) { publish({ historyPhase: 'idle' }); return }
            fetchedPage = next
            items.push(...response.items)
            if (!response.hasMore) break
          }
publish({ items: [...new Map(items.map(item => [item.id, item])).values()], page: fetchedPage, hasMore: response.hasMore, historyPhase: 'ready' })
        } catch {
          if (active && request === historyRequest && epoch === value.epoch) publish({ historyPhase: 'error' })
        } finally {
          if (active && request === historyRequest && historyDirty) { historyDirty = false; void refreshHistory() }
        }
      }
      const deletion = createSessionDeletion(async (id, epoch) => {
        if (epoch !== value.epoch || !value.connected) throw new Error('Chat identity changed.')
        const response = await window.dshEnterpriseChat.remove(id, epoch)
        if (!active || epoch !== value.epoch || response.epoch !== epoch) return
        historyRequest++
        publish({ items: value.items.filter(item => item.id !== id), historyPhase: 'idle' })
        void refreshHistory()
      })
      const open = async (id, projectId) => {
        if (!select('chat')) return
        const epoch = value.epoch
        const request = ++openRequest
        try {
          if (projectId) await window.dshEnterpriseChat.open(id, projectId)
          else await window.dshEnterpriseChat.open(id)
          if (active && request === openRequest && epoch === value.epoch) { publish({ conversationId: id, draftProjectId: projectId }); void refreshHistory() }
        }
        catch { if (active && epoch === value.epoch) void readHostState() }
      }
      // Account notifications also follow ordinary enterprise reads. The host epoch,
      // shared by history responses and state updates, owns the in-memory history.
      const applyState = (next, refresh = false) => {
        const identityChanged = next.epoch !== value.epoch
        const signedIn = next.connected && !value.connected
        const conversationChanged = next.conversationId !== value.conversationId
        const becameReady = next.phase === 'ready' && value.phase !== 'ready'
        const clearHistory = identityChanged || !next.connected
if (clearHistory) { historyRequest++; openRequest++; historyDirty = false; deletion.reset() }
        projects.setScope(next.connected ? next.projectScope : undefined, next.epoch)
        publish({
          ...next,
          ...(clearHistory ? { items: [], page: 0, hasMore: false, historyPhase: 'idle' } : {}),
          signInPromptOpen: next.connected ? false : value.signInPromptOpen,
          pageId: next.navigation?.entries.find(entry => entry.active)?.id,
          mode: next.connected ? signedIn ? 'chat' : value.mode : 'work'
        })
        if (signedIn) window.dispatchEvent(new CustomEvent('dsh-desktop:close-settings'))
        if (next.connected && next.phase === 'ready' && (refresh || identityChanged || signedIn || conversationChanged || becameReady)) void refreshHistory()
      }
      const sync = async () => {
        const request = ++revision
        try {
          const next = await window.dshEnterpriseChat?.state()
          if (!active || request !== revision || !next) return
          applyState(next, true)
        } catch { /* A missed focus read must not paint the reconnect page. */ }
      }
      // One guarded read. It does not refresh history; sync() owns that on focus and visibility.
      const readHostState = async () => {
        const request = ++revision
        try {
          const next = await window.dshEnterpriseChat?.state()
          if (!active || request !== revision || !next) return
          applyState(next)
        } catch { /* Keep the last host snapshot. A missed read is not a dead session. */ }
      }
      return {
        snapshot: () => value,
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        select, open, refreshHistory, deletion, projects,
        startProjectChat(id) {
          if (!value.connected || !projects.snapshot().projects.some(project => project.id === id)) return
          projects.reveal(id)
          ctx.layout.selectPanel(null)
          void open('new', id)
        },
        async moveProjectChat(id, epoch, projectId) {
          const state = projects.snapshot()
          if (epoch !== value.epoch || !value.connected || state.phase !== 'ready' || state.assigning.has(id) ||
            !(value.items.some(item => item.id === id) || Object.hasOwn(state.assignments, id))) return
          if (projectId === undefined) projects.edit('create', id)
          else if (await projects.assign(id, projectId) && projectId && value.epoch === epoch) projects.reveal(projectId)
        },
        requestDelete(id, title, epoch) {
          if (value.connected && epoch === value.epoch && (value.items.some(item => item.id === id) || Object.hasOwn(projects.snapshot().assignments, id))) deletion.request(id, title, epoch)
        },
        bindWorkbench(service) {
          const sync = () => {
            const snapshot = service.getSnapshot()
            publish({ nativeWork: snapshot.enabled === false || snapshot.state.active == null })
          }
          const unsubscribe = service.subscribe(sync)
          sync()
          return () => { unsubscribe(); publish({ nativeWork: true }) }
        },
        dismissSignIn() { publish({ signInPromptOpen: false }) },
        signIn() {
          publish({ signInPromptOpen: false })
          window.dispatchEvent(new CustomEvent('dsh-desktop:open-settings-section', { detail: { id: 'enterprise-account' } }))
        },
        async openPage(id) {
          if (!value.connected || !value.navigation?.entries.some(entry => entry.id === id)) return
          openRequest++
          ctx.layout.selectPanel(null)
          publish({ mode: 'chat', pageId: id })
          const epoch = value.epoch
          try { await window.dshEnterpriseChat.openPage(id) }
          catch { if (active && epoch === value.epoch) void readHostState() }
        },
        choose(mode) {
          if (!select(mode)) return false
          if (mode === 'chat' && value.conversationId !== 'new') void open('new')
          if (mode === 'work' && (!value.workLanding || value.panelOpen)) ctx.uiWorkspace.startSession()
          return true
        },
        start() {
          active = true
          const account = () => { void sync() }
          const visibility = () => { if (!document.hidden) void sync() }
// Older workspace hosts omit this registration. Failing here used to skip
// the enterprise menu sync, so More never received knowledge and the other pages.
const hasNavigationHandler = typeof ctx.uiWorkspace.registerNavigationHandler === 'function'
const disposeNavigation = hasNavigationHandler
  ? ctx.uiWorkspace.registerNavigationHandler((intent, workspaceId) => {
    if (intent === 'new' && workspaceId === undefined && value.mode === 'chat') { void open('new'); return true }
    select('work')
  })
  : () => {}
// This host never notifies session opens. A history click still replaces
// the work session, so reveal that column when chat is covering it.
const originalOpenSession = ctx.uiWorkspace.openSession
const revealWorkSession = hasNavigationHandler || typeof originalOpenSession !== 'function'
  ? null
  : function (target, source) {
    const result = originalOpenSession.call(this, target, source)
    if (typeof target === 'string' && value.mode === 'chat') select('work')
    return result
  }
if (revealWorkSession) ctx.uiWorkspace.openSession = revealWorkSession
          const settings = (event) => publish({ settingsOpen: event.detail?.open === true, ...(event.detail?.open ? {} : { settingsSurface: undefined }) })
          const approvals = (event) => publish({ approvalsOpen: event.detail?.open === true })
          // A sidebar account dialog is drawn by the renderer, so the native view yields the region.
          const accountDialog = (event) => publish({ accountDialogOpen: event.detail?.open === true })
          const settingsSurface = (event) => {
            const detail = event.detail
            if (detail?.close) { if (value.settingsSurface?.token === detail.token) publish({ settingsSurface: undefined }); return }
            if (detail?.bounds && typeof detail.section === 'string') publish({ settingsSurface: detail })
          }
          let workSession, unsubscribeWork = () => {}
          const workState = () => {
            const list = ctx.sessions.list.getSnapshot()
            const current = Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
            const session = current && ctx.sessions.binding(current.id)?.session
            if (session !== workSession) {
              unsubscribeWork()
              workSession = session
              unsubscribeWork = session ? session.subscribe(workState) : () => {}
            }
            const live = session?.getSnapshot()
            const blank = live ? live.blank && live.pendingSubmissions.length === 0 && !live.running && !live.awaitingFirstTurn : current?.blank
            publish({ workLanding: current ? blank === true : list.phase === 'ready' })
          }
          const panel = () => {
            const { activePanelId } = ctx.layout.panelInfo.getSnapshot()
            const panelOpen = activePanelId !== null
            publish({ panelOpen, activePanelId, ...(panelOpen ? { mode: 'work' } : {}) })
          }
          const unsubscribe = ctx.layout.panelInfo.subscribe(panel)
          const unsubscribeSessions = ctx.sessions.list.subscribe(workState)
          const unsubscribeChat = window.dshEnterpriseChat?.subscribe?.((next) => {
            revision++
            applyState(next)
          })
          const unsubscribeProjects = window.dshEnterpriseChat?.onProjectsChanged?.(next => {
            const previous = projects.snapshot().revision
            projects.apply(next)
            if (next.epoch === value.epoch && next.revision !== previous) void refreshHistory()
          })
          workState(); panel()
          window.addEventListener('dsh-desktop:enterprise-account-changed', account)
          window.addEventListener('dsh-desktop:settings-visibility', settings)
          window.addEventListener('dsh-desktop:approvals-visibility', approvals)
          window.addEventListener('dsh-desktop:account-dialog-visibility', accountDialog)
          window.addEventListener('dsh-desktop:settings-surface', settingsSurface)
          window.addEventListener('focus', sync)
          document.addEventListener('visibilitychange', visibility)
          void sync()
          return () => {
active = false; deletion.reset(); projects.setScope(undefined); revision++; historyRequest++; unsubscribe(); unsubscribeSessions(); unsubscribeWork(); unsubscribeChat?.(); unsubscribeProjects?.()
            window.removeEventListener('dsh-desktop:enterprise-account-changed', account)
            disposeNavigation()
            if (revealWorkSession && ctx.uiWorkspace.openSession === revealWorkSession) ctx.uiWorkspace.openSession = originalOpenSession
            window.removeEventListener('dsh-desktop:settings-visibility', settings)
            window.removeEventListener('dsh-desktop:approvals-visibility', approvals)
            window.removeEventListener('dsh-desktop:account-dialog-visibility', accountDialog)
            window.removeEventListener('dsh-desktop:settings-surface', settingsSurface)
            window.removeEventListener('focus', sync)
            document.removeEventListener('visibilitychange', visibility)
          }
        }
      }
    }
    /** Mirror Harness's title reveal without making pointer movement rerender the list. */
    function useHistoryTitleMarquee(title) {
      const ref = React.useRef(null)
      const frame = React.useRef(0)
      const reset = React.useCallback(() => {
        cancelAnimationFrame(frame.current)
        const element = ref.current
        if (!element) return
        element.scrollLeft = 0
        element.removeAttribute('data-scrolled')
        element.removeAttribute('data-clipped')
      }, [])
      React.useLayoutEffect(() => reset, [title, reset])
      const reveal = event => {
        if (event.pointerType === 'touch') return
        reset()
        const element = ref.current
        if (!element) return
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        let start, distance
        const tick = (now) => {
          // Measure after the timestamp has yielded its space to the menu trigger.
          distance ??= element.scrollWidth - element.clientWidth
          if (distance <= 8) return
          start ??= now
          const position = reducedMotion ? distance : Math.min(distance, (now - start) * .03)
          element.scrollLeft = position
          element.toggleAttribute('data-scrolled', position > 0)
          element.toggleAttribute('data-clipped', position < distance)
          if (position < distance) frame.current = requestAnimationFrame(tick)
        }
        frame.current = requestAnimationFrame(tick)
      }
      return { ref, reveal, reset }
    }
    function projectMenuKeys(event) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
      const list = event.target.closest('.dshCloudHistoryMenu')
      if (!list) return
      const trigger = list.querySelector('button[aria-haspopup="menu"][aria-expanded="true"]')
      const submenu = list.querySelector('[role="menu"]')
      const next = event.key === 'ArrowRight' && event.target === trigger ? submenu?.querySelector('button:not(:disabled)')
        : event.key === 'ArrowLeft' && submenu?.contains(event.target) ? trigger : null
      if (next) { event.preventDefault(); next.focus() }
    }
    function CloudHistoryRow({ item, selected, navigation, t, projectText, deleteText, now }) {
      const menu = useSidebarRowMenu()
      const title = item.title || t('newChat')
      const marquee = useHistoryTitleMarquee(title)
      const timeId = React.useId()
      const date = Date.parse(item.updatedAt)
      const time = Number.isFinite(date) ? relativeTime(date, now) : null
      const dateTime = time && new Date(date).toISOString()
      const age = time && t(`time.${time.unit}`, { n: time.n })
      const projects = navigation.projects.snapshot()
      const canMove = projects.phase === 'ready' && !projects.assigning.has(item.id)
      const currentProject = Object.hasOwn(projects.assignments, item.id) ? projects.assignments[item.id] : undefined
      const actions = []
      if (menu.open) {
        if (projectText) {
          actions.push({
            id: 'move', disabled: !canMove,
            label: React.createElement('span', { className: 'dshChatProjectMenuLabel' }, projectText('move'),
              React.createElement(IconChevronRightOutlineRegular, { 'aria-hidden': true })),
            icon: React.createElement(IconFolderOpenRegular),
            submenu: canMove ? [
              { id: 'new-project', label: React.createElement('span', { className: 'dshChatProjectMenuCreate' }, projectText('create')), icon: React.createElement(IconPlusOutlineRegular) },
              ...projects.projects.filter(project => project.id !== currentProject).map(project => ({
                id: `project:${project.id}`, label: project.name, icon: React.createElement(IconFolderCloseRegular)
              })),
              ...(currentProject ? [{ id: 'move-out', label: React.createElement('span', { className: 'dshChatProjectMenuRemove' }, projectText('moveOut')) }] : [])
            ] : undefined
          })
        }
        actions.push({ id: 'delete', label: deleteText('menu'), icon: React.createElement(IconTrashOutlineRegular), danger: true })
      }
      const select = action => {
        const epoch = navigation.snapshot().epoch
        menu.close()
        // Only deletion and creation need a dialog. Let Menu restore focus before it opens.
        if (action === 'delete') setTimeout(() => navigation.requestDelete(item.id, title, epoch), 0)
        else if (action === 'new-project') setTimeout(() => { void navigation.moveProjectChat(item.id, epoch) }, 0)
        else if (action === 'move-out') void navigation.moveProjectChat(item.id, epoch, null)
        else if (action.startsWith('project:')) void navigation.moveProjectChat(item.id, epoch, action.slice('project:'.length))
      }
      return React.createElement(HoverCard, {
        anchor: React.createElement('div', {
          className: 'dshSidebarItem dshCloudHistoryRow', 'data-menu-open': menu.open || undefined, 'data-selected': selected || undefined,
          onContextMenu: menu.onContextMenu, onKeyDown: event => { menu.onKeyDown(event); projectMenuKeys(event) },
          onPointerEnter: marquee.reveal, onPointerLeave: marquee.reset
        },
          React.createElement('button', {
            type: 'button', 'data-history-kind': 'chat', className: 'dshHistoryRow', 'aria-current': selected ? 'page' : undefined,
            'aria-label': title, 'aria-describedby': time ? timeId : undefined, onClick: () => navigation.open(item.id)
          },
            React.createElement('span', { className: 'dshHistoryTitle', ref: marquee.ref }, title),
            time && React.createElement('time', { id: timeId, dateTime }, age)),
          React.createElement('div', { className: 'dshSidebarItemTools' },
            React.createElement(Menu, {
              open: menu.open, onClose: menu.close, closeOnPointerLeave: menu.closeOnPointerLeave, portal: true, align: 'end', autoFocus: menu.fromKeyboard, dense: true,
              items: actions, onSelect: select, listClassName: 'dshCloudHistoryMenu',
              anchor: React.createElement('button', { type: 'button', className: 'dshCloudHistoryActions', 'aria-label': `${deleteText('actions')} · ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': menu.open, onClick: menu.toggle },
                React.createElement(IconEllipsisOutlineRegular, { 'aria-hidden': true }))
            }))),
        content: React.createElement('div', { className: 'dshCloudHistoryPreview', 'data-dsh-chat-history-preview': '' },
          React.createElement('div', null, title),
          time && React.createElement('time', { dateTime }, time.unit === 'now' ? age : t('time.ago', { t: age }))),
        openDelayMs: 800, grouped: true, disabled: menu.open
      })
    }
    /** Cloud identities stay namespaced; project ownership is projected by Harness. */
    function SharedCollection({ projects, items, mode, query, archivedOnly, searchPending = false, navigation, t, projectText, deleteText }) {
      const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      const projectState = React.useSyncExternalStore(navigation.projects.subscribe, navigation.projects.snapshot)
      const initialHistoryLoading = state.historyPhase === 'loading' && state.page === 0
      const resultsPending = initialHistoryLoading || (mode === 'search' && searchPending) || projectState.search.phase === 'loading'
      const search = query.trim().toLocaleLowerCase()
      const now = Date.now()
      React.useEffect(() => {
        const timer = setTimeout(() => { void navigation.projects.search(archivedOnly || !state.connected ? '' : search) }, search ? 200 : 0)
        return () => clearTimeout(timer)
      }, [navigation, search, archivedOnly, state.connected, state.epoch])
      const showProjects = mode === 'projects' && !archivedOnly && !search
      const local = items.map(item => ({ ...item, key: `work:${item.id}`, kind: 'work' }))
      const cloudItems = [...new Map([...state.items, ...(search && projectState.search.query === search ? projectState.search.items : [])].map(item => [item.id, item])).values()]
      const cloud = archivedOnly ? [] : cloudItems.filter(item => (!showProjects || !Object.hasOwn(projectState.assignments, item.id)) && (item.title || t('newChat')).toLocaleLowerCase().includes(search))
        .map(conversation => ({ key: `chat:${state.epoch}:${conversation.id}`, kind: 'chat', updatedAt: Date.parse(conversation.updatedAt) || 0, conversation }))
      const rows = [...local, ...cloud].sort((a, b) => Number(!!b.blank) - Number(!!a.blank) || Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
      return React.createElement('div', { className: 'dshSharedCollection', 'data-mode': state.mode },
        projects(state.mode === 'work'),
        showProjects && React.createElement(ChatProjects, { navigation, t, projectText, deleteText, now }),
        projectState.editor && React.createElement(ChatProjectDialog, { key: `${projectState.scope}:${projectState.editor.mode}:${projectState.editor.id || ''}`, store: navigation.projects, state: projectState, t: projectText }),
        React.createElement('section', { className: 'dshRecentHistory', 'aria-label': t(mode === 'projects' ? 'recent' : mode === 'search' ? 'results' : 'all') },
          React.createElement('div', { className: 'dshHistoryHeading' },
            React.createElement('span', null, t(mode === 'projects' ? 'recent' : mode === 'search' ? 'results' : 'all'))),
          rows.length > 0 && React.createElement('div', { className: 'dshRecentHistoryRows' },
            rows.map(row => row.kind === 'work'
              ? React.createElement('div', { key: row.key, 'data-history-kind': 'work' }, row.render(state.mode === 'work'))
              : React.createElement(CloudHistoryRow, { key: row.key, item: row.conversation, now, selected: state.mode === 'chat' && !state.pageId && state.conversationId === row.conversation.id, navigation, t, projectText, deleteText }))),
          state.historyPhase === 'error' && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', onClick: () => navigation.refreshHistory() }, t('historyError')),
          !showProjects && projectState.error === 'failed' && !projectState.editor && React.createElement('div', { role: 'alert', className: 'dshHistoryNotice' }, projectText('failed')),
          initialHistoryLoading && React.createElement('div', { className: 'dshHistoryNotice', role: 'status' }, t('historyLoading')),
          rows.length === 0 && !resultsPending && React.createElement('div', { className: 'dshHistoryNotice' }, t(search ? 'recentSearchEmpty' : 'recentEmpty')),
          search && projectState.search.phase === 'error' && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', onClick: () => { void navigation.projects.search(search) } }, projectText('unavailable')),
          (state.hasMore || (search && projectState.search.nextCursor)) && !archivedOnly && React.createElement('button', { type: 'button', className: 'dshHistoryNotice', disabled: state.historyPhase === 'loading' || projectState.search.phase === 'loading', onClick: () => {
            if (state.hasMore) void navigation.refreshHistory(true)
            if (search && projectState.search.nextCursor) void navigation.projects.search(search, true)
          } }, t('more'))))
    }
    /** Track semantic overlays, including inline menus and nested menus, without rescanning streamed content. */
    function observeHostOverlays(report) {
      // HoverCard exposes its content, not the portal element. Measure the entire card,
      // including its padding, when a cloud history preview crosses into the native view.
      const selector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], dialog, [popover], [data-dsh-host-overlay], :has(> [data-dsh-chat-history-preview])'
      const elements = new Set()
      const identities = new WeakMap()
      const pending = new Set()
      let style = document.querySelector('style[data-plugin-css="dsh-native-overlay-handoff"]')
      if (!style) {
        style = document.createElement('style')
        style.dataset.pluginCss = 'dsh-native-overlay-handoff'
        style.textContent = '[data-dsh-native-overlay-pending]{opacity:0!important;pointer-events:none!important}html[data-dsh-native-overlay-handoff] [data-menu-backing]{opacity:0!important}'
        document.head.append(style)
      }
      style.dataset.observers = String(Number(style.dataset.observers || 0) + 1)
      const release = () => {
        if (!pending.size) return
        for (const element of pending) element.removeAttribute('data-dsh-native-overlay-pending')
        pending.clear()
        document.documentElement.removeAttribute('data-dsh-native-overlay-handoff')
      }
      const intersects = (rect, bounds, surface) => (!surface || !rect.element.contains(surface)) && rect.x < bounds.x + bounds.width && rect.x + rect.width > bounds.x && rect.y < bounds.y + bounds.height && rect.y + rect.height > bounds.y
      let nextId = 0, modals = [], rectangles = [], previous = '', initialized = false, disposed = false
      const collect = node => {
        if (!(node instanceof Element)) return false
        let added = false
        for (const element of [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]) {
          if (elements.has(element)) continue
          elements.add(element); identities.set(element, ++nextId); resize.observe(element); added = true
        }
        return added
      }
      const refresh = () => {
        if (disposed || document.hidden) return
        modals = []; rectangles = []
        for (const element of elements) {
          if (!element.isConnected || !element.matches(selector)) {
            resize.unobserve(element); elements.delete(element); continue
          }
          // Our paint gate must not look like a dismissed menu to this observer.
          if (!element.checkVisibility({ checkVisibilityCSS: true, opacityProperty: !pending.has(element) })) continue
          const nativeModal = element instanceof HTMLDialogElement && element.matches(':modal')
          if (element.getAttribute('aria-modal') === 'true' || nativeModal) { modals.push(element); continue }
          if (element.matches('dialog:not([open])') || element.hasAttribute('popover') && !element.matches(':popover-open')) continue
          // A persistent inline dialog region is content, not a floating surface.
          if (element.matches('[role="dialog"], [role="alertdialog"]') && document.getElementById('root')?.contains(element) &&
            !['absolute', 'fixed'].includes(getComputedStyle(element).position)) continue
          const rect = element.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) rectangles.push({ element, x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        }
        const signature = JSON.stringify([modals.map(element => identities.get(element)), rectangles.map(({ element, ...rect }) => [identities.get(element), rect])])
        if (previous === signature) return
        previous = signature
        if (initialized) report()
      }
      const resize = new ResizeObserver(refresh)
      const body = new MutationObserver(records => {
        if (disposed || document.hidden) return
        let changed = false
        for (const record of records) {
          if (record.type === 'childList') {
            for (const node of record.addedNodes) changed = collect(node) || changed
            if (elements.size && (record.removedNodes.length || record.target instanceof Element && record.target.closest(selector))) changed = true
          } else if (record.target instanceof Element) {
            if (record.target.matches(selector) && !elements.has(record.target)) changed = collect(record.target) || changed
            if ([...elements].some(element => element === record.target || record.target.contains(element) || element.contains(record.target))) changed = true
          }
        }
        if (changed) refresh()
      })
      // Only added subtrees are searched. Attribute changes outside an active overlay's
      // ancestry are ignored; there is no per-token full-document query or polling loop.
      body.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'open', 'popover', 'hidden', 'style', 'class', 'data-dsh-host-overlay'] })
      const resume = () => { if (!document.hidden) { collect(document.body); refresh() } }
      document.addEventListener('visibilitychange', resume)
      window.addEventListener('scroll', refresh, true)
      window.addEventListener('resize', refresh)
      collect(document.body); refresh(); initialized = true
      return {
        // Settings/approvals may own this very native surface. Only a different
        // foreground layer should cover their content, including nested confirmations.
        isModal: surface => modals.some(element => !surface || !element.contains(surface)),
        intersects: (bounds, surface) => rectangles.some(rect => intersects(rect, bounds, surface)),
        defer: (bounds, surface) => {
          // MutationObserver runs before paint. Keep both the surface and its native
          // menu material out of that first paint until Main confirms the view yielded.
          for (const rect of rectangles) if (intersects(rect, bounds, surface)) {
            pending.add(rect.element)
            rect.element.setAttribute('data-dsh-native-overlay-pending', '')
          }
          if (pending.size) document.documentElement.setAttribute('data-dsh-native-overlay-handoff', '')
          return release
        },
        dispose() {
          if (disposed) return
          disposed = true; body.disconnect(); resize.disconnect(); elements.clear(); release()
          const users = Number(style.dataset.observers) - 1
          if (users) style.dataset.observers = String(users)
          else style.remove()
          document.removeEventListener('visibilitychange', resume)
          window.removeEventListener('scroll', refresh, true); window.removeEventListener('resize', refresh)
        }
      }
    }

    /** Freeze only the backing while host overlays own input; keep the remote document alive. */
    function createNativeSurfacePresenter(bridge, target) {
      let latest, revision = 0, cycle = 0, preparing = false, held = false, yielded = false, image, cancelPaint, disposed = false
      let warmReady, warmPending, warmImage, warmTimer, warmGeneration = 0
      const releases = new Set()
      const releaseOverlays = () => { for (const release of releases) release(); releases.clear() }
      const frameKey = value => JSON.stringify([value.bounds, value.settings, value.theme, value.locale])
      const clearWarm = retained => {
        warmGeneration++; warmReady = undefined; warmPending = undefined; clearTimeout(warmTimer)
        if (warmImage && warmImage !== retained) { cancelPaint?.(); warmImage.remove() }
        warmImage = undefined
      }
      const clear = () => { image?.remove(); image = undefined; held = false; yielded = false; clearWarm() }
      const backingFor = frame => {
        const backing = document.createElement('img')
        backing.dataset.dshNativeFrame = ''
        backing.alt = ''; backing.setAttribute('aria-hidden', 'true')
        Object.assign(backing.style, { position: 'absolute', zIndex: '0', pointerEvents: 'none', maxWidth: 'none', userSelect: 'none' })
        backing.src = frame.dataURL
        return backing
      }
      const decode = async backing => {
        let timeout
        try {
          await Promise.race([backing.decode(), new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Backing decode timed out')), 1500) })])
        } finally { clearTimeout(timeout) }
      }
      const warm = () => {
        if (disposed || document.hidden || !bridge.capture || !latest?.value.visible || latest.occluded || held) return
        const key = frameKey(latest.value)
        if (warmReady?.key === key && Date.now() - warmReady.at < 250) return
        if (warmPending?.key === key) return warmPending.promise
        clearWarm()
        const generation = warmGeneration
        const promise = (async () => {
          try {
            const frame = await bridge.capture()
            if (!frame || disposed || generation !== warmGeneration || key !== frameKey(latest.value)) return
            const backing = backingFor(frame)
            await decode(backing)
            if (disposed || generation !== warmGeneration || key !== frameKey(latest.value)) return
            warmImage = backing; placeBacking(backing, frame.bounds)
            await paint()
            if (disposed || generation !== warmGeneration || key !== frameKey(latest.value)) return
            warmReady = { frame, backing, key, at: Date.now() }
            // Only an interaction prepares a frame; no polling or long-lived page cache.
            warmTimer = setTimeout(() => { if (generation === warmGeneration) clearWarm() }, 500)
          } catch {
            // Speculative preparation is optional; opening still has the normal capture path.
            if (generation === warmGeneration) clearWarm()
          } finally {
            if (generation === warmGeneration) warmPending = undefined
          }
        })()
        warmPending = { key, promise }
        return promise
      }
      const paint = () => new Promise(resolve => {
        let first, second, settled = false
        const finish = () => {
          if (settled) return
          settled = true
          cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(timeout)
          cancelPaint = undefined; resolve()
        }
        // decode() makes pixels available, but the host must also composite them before
        // the native sibling disappears. Bound the wait when the window becomes hidden.
        const timeout = setTimeout(finish, 1500)
        cancelPaint = finish
        first = requestAnimationFrame(() => { second = requestAnimationFrame(finish) })
      })
      const send = async value => {
        try { await bridge.present(value); return true }
        catch { console.warn('[desktop-native-surface] presentation_failed'); return false }
      }
      const placeBacking = (backing, bounds) => {
        const parent = target(latest.value)
        if (!backing || !parent) return
        if (backing.parentElement !== parent) parent.append(backing)
        const rect = parent.getBoundingClientRect()
        Object.assign(backing.style, { left: `${bounds.x - rect.x}px`, top: `${bounds.y - rect.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
      }
      const place = bounds => placeBacking(image, bounds)
      const present = (value, occluded = false, defer) => {
        if (disposed) return
        const restoring = held || latest?.occluded
        if (latest && frameKey(latest.value) !== frameKey(value)) clearWarm()
        if (!latest || latest.value.visible !== value.visible || latest.occluded !== occluded || latest.value.settings !== value.settings) cycle++
        latest = { value, occluded }
        const request = ++revision
        if (!value.visible || !occluded) {
          // Restore the real surface before releasing its backing. A late response must
          // not remove a newer overlay's frame or revive a view after mode/account changes.
          if (!value.visible) clear()
          yielded = false
          releaseOverlays()
          if (!value.visible || restoring) cancelPaint?.()
          if (restoring) clearWarm()
          void send(value).then(restored => { if (restored && restoring && !disposed && request === revision) clear() })
          return
        }
        if (!yielded && defer) releases.add(defer())
        if (held) {
          place(value.bounds)
          const current = cycle
          void send({ ...value, visible: false }).then(applied => {
            if (!disposed && current === cycle) { yielded = applied; releaseOverlays() }
          })
          return
        }
        if (preparing) return
        preparing = true
        const captureCycle = cycle
        void (async () => {
          let frame
          try {
            const key = frameKey(value)
            if (warmPending?.key === key) await warmPending.promise
            if (disposed || captureCycle !== cycle || !latest.value.visible || !latest.occluded) return
            const prepared = warmReady?.key === key && Date.now() - warmReady.at < 250 ? warmReady : undefined
            frame = prepared?.frame ?? await bridge.capture?.()
            clearWarm(prepared?.backing)
            if (disposed || captureCycle !== cycle || !latest.value.visible || !latest.occluded) return
            if (frame) {
              const backing = prepared?.backing ?? backingFor(frame)
              if (!prepared) await decode(backing)
              if (disposed || captureCycle !== cycle || !latest.value.visible || !latest.occluded) return
              image = backing; place(frame.bounds)
              if (!prepared) await paint()
            }
          } catch {
            // Menus remain usable if capture/decoding fails; never retain a stale frame.
            if (captureCycle === cycle) clear()
            console.warn('[desktop-native-surface] overlay_backing_failed')
          } finally {
            preparing = false
            if (!disposed && captureCycle !== cycle && latest.value.visible && latest.occluded && !held) present(latest.value, true)
          }
          if (disposed || captureCycle !== cycle || !latest.value.visible || !latest.occluded) return
          held = true
          const applied = await send({ ...latest.value, visible: false })
          if (!disposed && captureCycle === cycle) { yielded = applied; releaseOverlays() }
        })()
      }
      return { present, warm, invalidate: clearWarm, dispose() { disposed = true; revision++; cancelPaint?.(); clear(); releaseOverlays() } }
    }
    /** Start optional capture before a host control mounts its menu, for pointer and keyboard input. */
    function observeNativeSurfaceIntent(warm) {
      const types = ['pointerover', 'pointerout', 'pointerdown', 'focusin', 'keydown', 'contextmenu']
      let hoverTimer, hovered
      const prepare = event => {
        const element = event.target
        if (!(element instanceof Element) || element.closest('[data-dsh-native-surface]')) return
        const control = element.closest('button, a[href], input, [role="button"], [role="combobox"], [aria-haspopup]')
        if (event.type === 'pointerout') {
          if (control && event.relatedTarget instanceof Element && control.contains(event.relatedTarget)) return
          clearTimeout(hoverTimer); hovered = undefined
          return
        }
        if (event.type === 'pointerover') {
          if (!control || control === hovered) return
          clearTimeout(hoverTimer); hovered = control
          // Crossing a toolbar must not encode a full page for every icon passed.
          hoverTimer = setTimeout(warm, 60)
          return
        }
        if (event.type === 'keydown' && !['Enter', ' ', 'ArrowDown', 'ContextMenu', 'F10'].includes(event.key)) return
        clearTimeout(hoverTimer)
        if (event.type === 'contextmenu' || control) warm()
      }
      for (const type of types) document.addEventListener(type, prepare, true)
      return () => { clearTimeout(hoverTimer); for (const type of types) document.removeEventListener(type, prepare, true) }
    }
    function DesktopModes({ work, columns, resizeHandle, navigation, t, locale }) {
      const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      const projectState = React.useSyncExternalStore(navigation.projects.subscribe, navigation.projects.snapshot)
      const projectDialogOpen = projectState.editor !== null
      const deletionRequest = React.useSyncExternalStore(navigation.deletion.subscribe, navigation.deletion.getSnapshot)
      const cloudDeleteOpen = deletionRequest !== null
      const { mode, settingsOpen, settingsSurface } = state
      const usesModuleFrame = /^\/(?:knowledge|channel)(?:\/|$)|^\/(?:apps|skills|capabilities)\/?$/u.test(state.path ?? '')
      React.useEffect(() => navigation.start(), [navigation])
      const panel = React.useRef(null)
      const surfacePresenter = React.useRef(null)
      const [animateWork, setAnimateWork] = React.useState(false)
      const tabs = React.useRef({})
      React.useEffect(() => {
        if (mode !== 'work') setAnimateWork(false)
      }, [mode])
      // Geometry and mode subscriptions can remount without releasing an active backing.
      // Identity changes and final unmount always destroy it, including in-flight captures.
      React.useEffect(() => () => { surfacePresenter.current?.dispose(); surfacePresenter.current = null }, [state.epoch])
      React.useEffect(() => {
        const bridge = window.dshEnterpriseChat
        if (!bridge) return
        const appRoot = document.getElementById('root')
        const macModuleFrame = usesModuleFrame && document.documentElement.dataset.platform === 'darwin'
        let observedLeading
        const presenter = surfacePresenter.current || (surfacePresenter.current = createNativeSurfacePresenter(bridge, value => value.settings
          ? document.querySelector(`[data-dsh-native-surface="${value.settings}"]`) : panel.current))
        const present = () => {
          const rect = panel.current?.getBoundingClientRect()
          if (!rect) return
          // Native WebContentsView paints above DOM chrome regardless of z-index.
          // macOS moves the sidebar opener into this seat when the rail disappears.
          const leading = document.querySelector('[data-shell-leading]')
          if (leading !== observedLeading) {
            if (observedLeading) resize.unobserve(observedLeading)
            observedLeading = leading
            if (leading) resize.observe(leading)
          }
          // The collapsed sidebar's inner rail still has a rect, but the zero-width
          // grid column clips it. The content panel tracks the actual grid edge.
          const sidebarRight = document.querySelector('[data-dsh-sidebar-root]')?.getBoundingClientRect().right || 0
          const contentLeft = macModuleFrame ? rect.x : Math.max(rect.x, sidebarRight)
          const chrome = leading?.getBoundingClientRect()
          const overlapsLeading = chrome && chrome.bottom > rect.y && chrome.left < rect.right && chrome.right > contentLeft
          // Keep the module's top inset steady as the native buttons move between
          // sidebar and title bar. The module page subtracts it from its own padding.
          // Chat uses the inline title row and still needs horizontal clearance.
          const x = overlapsLeading && !macModuleFrame ? chrome.right : contentLeft
          const titlebarHeight = macModuleFrame ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 48 : 0
          const y = macModuleFrame ? Math.min(rect.bottom, Math.max(rect.y, titlebarHeight)) : rect.y
          const surfaceOpen = settingsOpen || state.approvalsOpen || state.accountDialogOpen
          const remote = surfaceOpen && state.settingsProtocolVersion === 1 && settingsSurface
const safeModePageOpen = document.documentElement.hasAttribute('data-dsh-safe-mode-page')
const surface = remote ? document.querySelector(`[data-dsh-native-surface="${remote.section}"]`) : panel.current
// Project dialogs have an explicit lifecycle; yield the native sibling as they open.
const hostModalOpen = projectDialogOpen || cloudDeleteOpen || overlays.isModal(surface) || appRoot?.inert || document.documentElement.hasAttribute('data-dsh-about-open')
const palette = hostPalette()
const bounds = remote ? remote.bounds : { x, y, width: Math.max(0, rect.right - x), height: Math.max(0, rect.y + rect.height - y) }
presenter.present({ visible: hostModalOpen ? false : (remote ? state.connected && remote.bounds.width > 0 && remote.bounds.height > 0 : mode === 'chat' && !surfaceOpen && !safeModePageOpen), ...(remote ? { settings: remote.section } : {}), ...(palette ? { palette } : {}), bounds, theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light', locale: locale.getSnapshot().active === 'zh' ? 'zh' : 'en' }, overlays.intersects(bounds, surface), () => overlays.defer(bounds, surface))
        }
        // The native view follows the host's modal interaction boundary.
        // Onboarding makes #root inert while its dialog lives in a body portal.
        const interaction = new MutationObserver(present)
        if (appRoot) interaction.observe(appRoot, { attributes: true, attributeFilter: ['inert'] })
// About covers Chat and remote settings. The recovery page covers Chat only.
interaction.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-about-open', 'data-dsh-safe-mode-page'] })
        const resize = new ResizeObserver(present)
        if (panel.current) resize.observe(panel.current)
        const sidebar = document.querySelector('[data-dsh-sidebar-root]')
        if (sidebar) resize.observe(sidebar)
        // The leading seat mounts/unmounts as a direct frame child on collapse.
        // Observe only that boundary, not streaming conversation descendants.
        const chromeLayout = new MutationObserver(present)
        const modeSlot = panel.current?.closest('[data-slot="desktop.mode.content"]')
        const frame = modeSlot?.parentElement ?? panel.current?.closest('.dshModes')?.parentElement
        if (frame) chromeLayout.observe(frame, { childList: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
        const theme = new MutationObserver(present)
        theme.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        const overlays = observeHostOverlays(present)
        const stopWarmup = observeNativeSurfaceIntent(() => { void presenter.warm() })
        const unsubscribeLocale = locale.subscribe(present)
        window.addEventListener('resize', present)
        present()
        return () => {
          stopWarmup(); overlays.dispose(); interaction.disconnect(); resize.disconnect(); chromeLayout.disconnect(); theme.disconnect(); unsubscribeLocale(); window.removeEventListener('resize', present)
        }
      }, [mode, usesModuleFrame, settingsOpen, state.approvalsOpen, state.accountDialogOpen, settingsSurface, state.connected, state.epoch, state.settingsProtocolVersion, projectDialogOpen, cloudDeleteOpen, locale])
      React.useEffect(() => { surfacePresenter.current?.invalidate() }, [state.path, state.pageId, state.phase])
      React.useEffect(() => () => {
        void window.dshEnterpriseChat?.present({ visible: false, bounds: { x: 0, y: 48, width: 0, height: 0 }, theme: 'light' }).catch(() => {})
      }, [])
      const showModePicker = !settingsOpen && (mode === 'chat'
        ? !state.pageId && state.conversationId === 'new' && state.landing !== false
        : state.nativeWork && state.workLanding && !state.panelOpen)
      const chooseMode = (next) => {
        if (!navigation.choose(next)) return false
        if (next !== mode) {
          setAnimateWork(next === 'work' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        }
        return true
      }
      const keyDown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'work' : mode === 'chat' ? 'work' : 'chat'
        if (chooseMode(next)) tabs.current[next]?.focus()
      }
      return React.createElement('div', { className: 'dshModes' },
        state.signInPromptOpen && React.createElement(Modal, {
          open: true, title: t('signInTitle'), closeLabel: t('close'), onClose: navigation.dismissSignIn,
          footer: React.createElement('div', { className: 'dshChatSignInActions' },
            React.createElement(Button, { type: 'button', variant: 'outline', onClick: navigation.dismissSignIn }, t('continueWork')),
            React.createElement(Button, { type: 'button', variant: 'primary', onClick: navigation.signIn }, t('signIn')))
        }, React.createElement('p', { className: 'dshChatSignInDescription' }, t('signInDescription'))),
        showModePicker && React.createElement('header', { className: 'dshModesHeader' },
          React.createElement('div', { role: 'tablist', 'aria-label': t('label'), className: 'dshModesTabs', onKeyDown: keyDown },
            ...['chat', 'work'].map((key) => React.createElement('button', { key, id: `dsh-mode-${key}`, type: 'button', role: 'tab', 'aria-selected': mode === key, 'aria-controls': `dsh-panel-${key}`, tabIndex: mode === key ? 0 : -1, ref: (node) => { tabs.current[key] = node }, onClick: () => chooseMode(key) }, t(key))))),
        React.createElement('section', {
          id: 'dsh-panel-work', role: 'tabpanel', 'aria-label': t('work'), hidden: mode !== 'work',
          className: 'dshModeBody dshWorkContent', 'data-reveal-controls': mode === 'work' && animateWork,
          onAnimationEnd: event => {
            if (event.animationName === 'dshWorkControlsRise') setAnimateWork(false)
          },
          style: { gridTemplateColumns: columns }
        }, work, resizeHandle),
        React.createElement('section', { ref: panel, id: 'dsh-panel-chat', 'data-dsh-native-surface': '', role: 'tabpanel', 'aria-label': t('chat'), hidden: mode !== 'chat', className: 'dshModeBody' },
          React.createElement('div', { className: 'dshChatStatus', role: 'status' },
            React.createElement('p', null, state.phase === 'error' ? t('error') : state.phase === 'ready' ? '' : t('loading')),
            state.connected && state.phase === 'error' && React.createElement('button', { type: 'button', onClick: () => { void window.dshEnterpriseChat.retry().catch(() => {}) } }, t('retry')))))
    }
    const NAV_ICON_PATHS = {
      new: 'M12 20H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M16 16v6m-3-3h6M7 8h10M7 12h5',
      knowledge: 'M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14h14M7 6h8',
      channel: 'M5 3h14v18l-7-4-7 4V3Zm7 3v8m-4-4h8',
      apps: 'M8 5V3h8v2M3 7h18v14H3V7Zm0 5h18M9 10v5h6v-5',
      tools: 'M14.7 6.3a5.5 5.5 0 0 0-7 7L3 18a2.1 2.1 0 0 0 3 3l4.7-4.7a5.5 5.5 0 0 0 7-7l-3.5 3.5-3-3 3.5-3.5Z',
      skills: 'M5 3h14v18H5V3Zm3 4h8M8 11h8M8 15h5',
      square: 'M3 4h6v6H3V4Zm12 0h6v6h-6V4ZM3 14h6v6H3v-6Zm12 0h6v6h-6v-6',
      more: 'M5 12h.01M12 12h.01M19 12h.01'
    }
    function ResourceIcon({ id, size = 16 }) {
      return React.createElement(ReferenceIconRegular, { kind: { skills: 'skill', tools: 'tool', knowledge: 'folder' }[id], size })
    }
    function NavigationIcon({ id, size = 16 }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: id === 'more' ? 3 : 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        React.createElement('path', { d: NAV_ICON_PATHS[id === 'capabilities' ? 'skills' : id] || NAV_ICON_PATHS.apps }))
    }
    function PrimaryNavigation({ wide, renderAction, expandSidebar, panels, selectPanel, renderPanelIcon, navigation, t }) {
      const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot)
      const [menuOpen, setMenuOpen] = React.useState(false)
      React.useEffect(() => { setMenuOpen(false) }, [state.epoch])
      React.useEffect(() => { if (!wide) setMenuOpen(false) }, [wide])
      React.useEffect(() => {
        if (!menuOpen) return
        // Electron's embedded Chat view takes focus without an iframe in this document.
        // Menu already handles outside pointer clicks in the Harness document.
        const close = () => setMenuOpen(false)
        window.addEventListener('blur', close)
        return () => window.removeEventListener('blur', close)
      }, [menuOpen])
      const entries = state.connected ? state.navigation?.entries || [] : []
      const activeId = state.mode === 'chat' ? entries.find(entry => entry.active)?.id : undefined
      const plugins = panels.find(panel => panel.id === 'plugins')
      const morePanels = panels.filter(panel => panel.id !== 'plugins')
      const items = [
        ...entries.map(entry => ({ id: `web:${entry.id}`, label: entry.label, icon: React.createElement(NavigationIcon, { id: entry.id }) })),
        ...morePanels.map(panel => ({ id: `local:${panel.id}`, label: panel.label, icon: renderPanelIcon(panel.id) }))
      ]
      return React.createElement('nav', { className: 'dshPrimaryNavigation', 'data-wide': wide, 'aria-label': t('navigation') },
        plugins && renderAction({ id: plugins.id, label: plugins.label, icon: renderPanelIcon(plugins.id), active: state.mode === 'work' && state.activePanelId === plugins.id, onClick: () => { setMenuOpen(false); navigation.select('work'); selectPanel(plugins.id) } }),
        items.length > 0 && React.createElement(Menu, {
          open: menuOpen, onClose: () => setMenuOpen(false), items, autoFocus: true, dense: true,
          className: 'dshNavigationMenu', listClassName: 'dshNavigationMenuList',
          selectedId: activeId ? `web:${activeId}` : undefined,
          onSelect: id => { setMenuOpen(false); if (id.startsWith('web:')) void navigation.openPage(id.slice(4)); else { navigation.select('work'); selectPanel(id.slice(6)) } },
          anchor: renderAction({ id: 'more', label: t('moreNavigation'), icon: React.createElement(NavigationIcon, { id: 'more' }), active: Boolean(activeId) || (state.mode === 'work' && morePanels.some(panel => panel.id === state.activePanelId)), expanded: menuOpen, onClick: () => { if (!wide) expandSidebar(); setMenuOpen(open => !open) } })
        }))
    }
    // Work overlays use viewport coordinates. Isolate stacking while keeping
    // their fixed-position containing block attached to the viewport.
    function installDesktopModes(ctx) {
      const navigation = createChatNavigation(ctx)
      ctx.effect(() => () => navigation.deletion.dispose())
      ctx.effect(() => ctx.locale.register(MODES_NS, MODES_COPY), 'desktop: Chat and Work locale')
      ctx.effect(() => ctx.locale.register(CLOUD_DELETE_NS, CLOUD_DELETE_COPY))
      ctx.effect(() => ctx.locale.register(PROJECTS_NS, PROJECTS_COPY))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'desktop-cloud-chat-delete-dialog', locale: CLOUD_DELETE_NS,
        inject: () => ({ deletion: navigation.deletion, t: ctx.locale.bind(CLOUD_DELETE_NS) })
      }, DeleteSessionDialog))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-client-ui'
        style.textContent = `
          .dshPrimaryNavigation{display:flex;flex-direction:column;flex:none;gap:4px;padding:0 0 12px}
          .dshPrimaryNavigation[data-wide=false]{gap:12px}
          .dshNavigationMenu{display:flex;flex-direction:column;position:relative;width:100%}.dshNavigationMenu .dshNavigationMenuList{width:100%;min-width:0;max-width:100%;box-sizing:border-box}
          .dshModes{grid-column:2 / -1;min-width:0;min-height:0;width:100%;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
          .dshModesHeader{height:56px;flex:none;display:flex;align-items:center;justify-content:center}
          html[data-platform=darwin] .dshModesHeader{-webkit-app-region:drag}
          .dshModesTabs{position:relative;isolation:isolate;display:grid;grid-template-columns:repeat(2,1fr);padding:3px;border-radius:24px;background:var(--dsw-alias-bg-layer-2);-webkit-app-region:no-drag}
          /* Keep one indicator mounted so it can slide without delaying the mode change. */
          .dshModesTabs::before{content:'';position:absolute;inset-block:3px;inset-inline-start:3px;width:calc(50% - 3px);z-index:-1;border-radius:20px;background:var(--dsw-alias-interactive-bg-hover-solid);pointer-events:none;transform:translateX(0);transition:transform 200ms cubic-bezier(.35,0,.25,1)}
          .dshModesTabs:has(>#dsh-mode-work[aria-selected=true])::before{transform:translateX(100%)}
          .dshModesTabs:dir(rtl):has(>#dsh-mode-work[aria-selected=true])::before{transform:translateX(-100%)}
          .dshModesTabs button{font:inherit;font-size:13px;min-width:96px;height:30px;padding:0 20px;border:0;border-radius:20px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
          .dshModesTabs button[aria-selected=true]{color:var(--dsw-alias-label-primary)}
          .dshModes button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
          .dshModeBody{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}.dshModeBody[hidden]{display:none}
          .dshWorkContent{display:grid;grid-template-rows:minmax(0,1fr);isolation:isolate}.dshWorkContent[hidden]{display:none}
          /* Match the borderless Chat surface. The frame owns the resize handle separately. */
          html[data-platform=darwin] .dshWorkContent > [data-dsh-layout-center]{border-left:0}
          .dshWorkContent[data-reveal-controls=true] [data-dsh-hero-controls] {
            animation: dshWorkControlsRise 240ms cubic-bezier(.25,.5,.35,1);
          }
          /* Clip the rising row at its lower edge so it emerges above the composer. */
          @keyframes dshWorkControlsRise {
            from { opacity: 0; translate: 0 16px; clip-path: inset(-8px -8px 16px); }
            72% { opacity: 1; translate: 0 -2px; clip-path: inset(-8px); }
            to { opacity: 1; translate: 0 0; clip-path: inset(-8px); }
          }
          @media(prefers-reduced-motion:reduce){
            .dshModesTabs::before{transition:none}
            .dshWorkContent[data-reveal-controls=true] [data-dsh-hero-controls]{animation:none}
          }
          .dshSharedCollection{min-width:0}
          .dshRecentHistory{margin-top:12px;min-width:0}
          .dshRecentHistoryRows{display:flex;flex-direction:column;gap:2px}
          /* Match the native workspace section's title inset, line height and spacing. */
          .dshHistoryHeading{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;height:36px;margin-block-end:4px;padding-inline-start:4px;color:var(--dsw-alias-label-tertiary);line-height:20px}
          .dshChatProjects{margin-top:12px;min-width:0}
          /* The native list already accounts for the scrollbar. Match the workspace header's trailing button. */
          .dshChatProjects>.dshHistoryHeading>.dshChatProjectAction{width:28px;height:28px}
          .dshSidebarItem{position:relative;min-width:0;border-radius:var(--dsw-radius-md)}
          .dshSidebarItem:is(:hover,[data-selected],[data-menu-open],:has(:focus-visible)){background:var(--dsw-alias-interactive-bg-hover)}
          .dshSidebarItemTools{position:absolute;inset-block:0;inset-inline-end:8px;display:flex;align-items:center;gap:10px;pointer-events:none}
          .dshSidebarItemTools :is(.dshChatProjectAction,.dshCloudHistoryActions){opacity:0;pointer-events:none}
          /* Hidden tools stay in the Tab order. Focus reveals the tools even without a pointer. */
          .dshSidebarItem:is(:hover,[data-menu-open],:has(:focus-visible)) .dshSidebarItemTools :is(.dshChatProjectAction,.dshCloudHistoryActions){opacity:1;pointer-events:auto}
          .dshChatProjectToggle,.dshChatProjectCreate,.dshHistoryRow{box-sizing:border-box;display:flex;align-items:center;gap:6px;min-width:0;width:100%;border:0;border-radius:inherit;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer}
          .dshChatProjectToggle{height:34px;padding:0 8px}
          .dshChatProjectToggle svg{flex:none;width:16px;height:16px}
          .dshChatProjectName,.dshHistoryTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}
          .dshChatProjectFolder[data-current]{color:var(--dsw-alias-state-business-primary)}
          .dshChatProjectToggle .dshChatProjectChevron{display:none;color:var(--dsw-alias-label-caption)}
          .dshChatProjectToggle[aria-expanded=true] .dshChatProjectChevron{transform:rotate(90deg)}
          .dshChatProjectHeading:is(:hover,[data-menu-open],:has(:focus-visible)) .dshChatProjectFolder{display:none}
          .dshChatProjectHeading:is(:hover,[data-menu-open],:has(:focus-visible)) .dshChatProjectChevron{display:block}
          .dshChatProjectHeading:is(:hover,[data-menu-open],:has(:focus-visible)) .dshChatProjectToggle{padding-inline-end:64px}
          .dshChatProjectAction,.dshCloudHistoryActions{display:inline-grid;place-items:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
          :is(.dshChatProjectAction,.dshCloudHistoryActions) svg{width:16px;height:16px}
          :is(.dshChatProjectAction,.dshCloudHistoryActions):is(:hover,[aria-expanded=true]){color:var(--dsw-alias-label-primary)}
          .dshChatProjectAction:disabled{opacity:.5;cursor:default}
          .dshChatProjectCreate{width:100%;padding:6px 8px;border-radius:8px;color:var(--dsw-alias-label-secondary)}.dshChatProjectCreate:hover{background:var(--dsw-alias-interactive-bg-hover)}
          .dshChatProjectEmpty{padding:6px 8px 6px 32px;font-size:12px;color:var(--dsw-alias-label-tertiary)}.dshChatProject .dshHistoryRow{padding-left:32px}
          .dshChatProjectForm{display:grid;gap:12px}.dshChatProjectForm label{display:grid;gap:6px;color:var(--dsw-alias-label-primary)}
          .dshChatProjectForm input{box-sizing:border-box;min-width:0;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}
          .dshChatProjectForm input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
          .dshCloudHistoryMenu{anchor-scope:--dsh-chat-project-menu-row}
          .dshChatProjectMenuLabel{display:flex;align-items:center;justify-content:space-between;gap:8px}
          .dshChatProjectMenuLabel svg{flex:none;color:var(--dsw-alias-label-tertiary)}
          .dshCloudHistoryMenu button[aria-haspopup=menu]{anchor-name:--dsh-chat-project-menu-row}
          .dshCloudHistoryMenu button[aria-haspopup=menu][aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
          /* Native submenus are meant for short lists. Fit project lists on screen and
             bridge the gap from the parent row even when the child menu scrolls. */
          .dshCloudHistoryMenu [role=menu]{
            position:fixed;position-anchor:--dsh-chat-project-menu-row;top:anchor(top);bottom:auto;left:calc(anchor(right) + 6px);
            position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline;margin:0 12px 12px 0;
            max-width:240px;max-height:min(260px,calc(50dvh - 20px));overflow:auto;overscroll-behavior:contain
          }
          .dshCloudHistoryMenu :has(>button[aria-haspopup=menu][aria-expanded=true])::before,
          .dshCloudHistoryMenu :has(>button[aria-haspopup=menu][aria-expanded=true])::after{content:'';position:absolute;inset-block:0;width:6px}
          .dshCloudHistoryMenu :has(>button[aria-haspopup=menu][aria-expanded=true])::before{right:100%}
          .dshCloudHistoryMenu :has(>button[aria-haspopup=menu][aria-expanded=true])::after{left:100%}
          .dshCloudHistoryMenu [role=menu]>[role=menuitem]{flex:none}
          /* Menu's submenu accepts only actionable rows. Draw dividers on the
             following row so there is no extra keyboard stop or duplicate line. */
          .dshCloudHistoryMenu [role=menu]>button:is(button:has(.dshChatProjectMenuCreate)+button,:has(.dshChatProjectMenuRemove)){
            position:relative;margin-block-start:7px
          }
          .dshCloudHistoryMenu [role=menu]>button:is(button:has(.dshChatProjectMenuCreate)+button,:has(.dshChatProjectMenuRemove))::before{
            content:'';position:absolute;inset-block-start:-4px;inset-inline:2px;height:1px;
            background:var(--dsw-alias-border-l2);pointer-events:none
          }
          .dshHistoryRow{height:32px;padding:0 8px 0 28px;user-select:none}
          .dshHistoryTitle{flex:1}
          .dshHistoryRow time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;white-space:nowrap}
          .dshCloudHistoryRow:is(:hover,[data-menu-open],:has(:focus-visible)) .dshHistoryRow{padding-inline-end:36px}
          .dshCloudHistoryRow:is(:hover,[data-menu-open],:has(:focus-visible)) time{display:none}
          .dshHistoryTitle:is([data-scrolled],[data-clipped]){text-overflow:clip}
          .dshHistoryTitle[data-scrolled]{mask-image:linear-gradient(90deg,transparent,black 12px)}
          .dshHistoryTitle[data-clipped]{mask-image:linear-gradient(270deg,transparent,black 12px)}
          .dshHistoryTitle[data-scrolled][data-clipped]{mask-image:linear-gradient(90deg,transparent,black 12px calc(100% - 12px),transparent)}
          .dshCloudHistoryPreview{display:grid;gap:4px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
          .dshCloudHistoryPreview time{font-size:12px;color:var(--dsw-alias-label-tertiary)}
          @media(hover:none){
            .dshSidebarItem .dshSidebarItemTools :is(.dshChatProjectAction,.dshCloudHistoryActions){opacity:1;pointer-events:auto}
            .dshChatProjectHeading .dshChatProjectToggle{padding-inline-end:64px}
            .dshCloudHistoryRow .dshHistoryRow{padding-inline-end:36px}
          }
          .dshHistoryNotice{padding:8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:0;text-align:left}.dshHistoryNotice:is(button){cursor:pointer}
          .dshSharedCollection button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
          .dshChatSignInDescription{margin:0;font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
          .dshChatSignInActions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
          .dshChatStatus{margin:auto;text-align:center;font-size:14px;color:var(--dsw-alias-label-secondary)}
          .dshChatStatus button{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;cursor:pointer}
        `
        document.head.appendChild(style)
        return () => style.remove()
      })
      ctx.slots.inject('sidebar.primaryNavigation', () => ctx.slots.register({ name: 'sidebar.primaryNavigation', id: 'desktop-primary-navigation', inject: () => ({ navigation, t: ctx.locale.bind(MODES_NS) }) }, PrimaryNavigation))
      ctx.slots.inject('sidebar.workspaces.title', () => ctx.slots.register({ name: 'sidebar.workspaces.title', inject: () => ({ t: ctx.locale.bind(MODES_NS) }) }, ({ flat, t }) => t(flat ? 'all' : 'projects')))
      ctx.slots.inject('desktop.mode.content', () => ctx.slots.register({ name: 'desktop.mode.content', id: 'desktop-chat-work', inject: () => ({ navigation, t: ctx.locale.bind(MODES_NS), locale: ctx.locale }) }, DesktopModes))
      ctx.slots.inject('sidebar.workspaces.collection', () => ctx.slots.register({ name: 'sidebar.workspaces.collection', id: 'desktop-shared-collection', inject: () => ({ navigation, t: ctx.locale.bind(MODES_NS), projectText: ctx.locale.bind(PROJECTS_NS), deleteText: ctx.locale.bind(CLOUD_DELETE_NS) }) }, SharedCollection))
      return navigation
    }

    const RESOURCE_NS = 'desktop-work-resources'
    const RESOURCE_COPY = {
      zh: { tools: '工具', toolsHint: '选择本次任务使用的工具', skills: '技能', skillsHint: '选择本次任务使用的技能', knowledge: '知识空间', knowledgeHint: '选择本次任务检索的知识空间', search: '搜索知识空间', empty: '暂无可用知识空间', noMatch: '没有匹配的知识空间', loading: '正在加载知识空间…', retry: '重试', cancel: '取消', confirm: '确认添加', close: '关闭', remove: '移除', department: '部门知识空间', mine: '我创建的', joined: '我加入的', selectKnowledge: '选择知识空间', modified: '修改时间', selected: '已选 {count} 个知识空间', limit: '最多选择 50 个空间' },
      en: { tools: 'Tools', toolsHint: 'Choose tools for this task', skills: 'Skills', skillsHint: 'Choose a skill for this task', knowledge: 'Knowledge spaces', knowledgeHint: 'Choose knowledge spaces to search in this task', search: 'Search knowledge spaces', empty: 'No knowledge spaces available', noMatch: 'No matching knowledge spaces', loading: 'Loading knowledge spaces…', retry: 'Retry', cancel: 'Cancel', confirm: 'Add selected', close: 'Close', remove: 'Remove', department: 'Department spaces', mine: 'Created by me', joined: 'Joined spaces', selectKnowledge: 'Select knowledge spaces', modified: 'Modified', selected: '{count} knowledge spaces selected', limit: 'Select up to 50 spaces' }
    }
    async function workResourceRequest(operation, sessionId, spaceIds, signal) {
      const response = await fetch('/api/enterprise.work-resources', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ operation, sessionId, ...(spaceIds === undefined ? {} : { spaceIds }) })
      })
      const result = await response.json().catch(() => ({ error: `Knowledge service unavailable (${response.status})` }))
      if (!response.ok) throw new Error(result.error || `Knowledge request failed (${response.status})`)
      return result
    }
    async function workSkillRequest(body, signal) {
      const response = await fetch('/api/enterprise.work-skills', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify(body)
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Skill request failed.')
      return data
    }
    async function workToolRequest(body, signal) {
      const response = await fetch('/api/enterprise.work-tools', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify(body)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Tool request failed.')
      return result
    }
    const TOOL_REFERENCE_SOURCE = 'desktop-tool'
    const validToolLabel = label => typeof label === 'string' && label.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(label)
    const decodeToolReference = ref => {
      const tool = JSON.parse(ref)
      if (!tool || !/^mcp__bisheng__bisheng_tool_[1-9][0-9]*$/.test(tool.name) || !validToolLabel(tool.label) || typeof tool.connectionKey !== 'string' || !tool.connectionKey) throw new Error('Invalid tool reference.')
      return tool
    }
    const toolReferenceSource = {
      trigger: '/', name: TOOL_REFERENCE_SOURCE, candidates: async () => [], onPick: () => undefined, openReference: () => false,
      codec: {
        clipboardText: ref => `/${decodeToolReference(ref).label}`,
        serialize: async (ref, signal) => {
          const tool = decodeToolReference(ref)
          await workToolRequest({ operation: 'validate', names: [tool.name], connectionKey: tool.connectionKey }, signal)
          return ` [Selected tool: ${tool.name}; label: ${JSON.stringify(tool.label)}] `
        }
      }
    }
    // Persist the selection's label with its model identity. Transcript rendering
    // reads this snapshot, so account changes and catalog renames preserve history.
    const workToolMessageRule = {
      id: TOOL_REFERENCE_SOURCE, order: 20,
      match(text, from) {
        const pattern = /\[Selected tool: (mcp__bisheng__bisheng_tool_[1-9][0-9]*)(?:; label: ("(?:[^"\\\r\n]|\\.)*"))?\]/gu
        pattern.lastIndex = from
        for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
          let label
          if (match[2] !== undefined) {
            try { label = JSON.parse(match[2]) } catch { continue }
            if (!validToolLabel(label)) continue
          }
          return { id: TOOL_REFERENCE_SOURCE, start: match.index, end: pattern.lastIndex, data: { name: match[1], ...(label === undefined ? {} : { label }) } }
        }
      }
    }
    function WorkToolMessage({ node, t }) {
      // Legacy messages carry only an ID. A neutral label keeps their meaning
      // without resolving that ID against a different enterprise account.
      const label = node.data.label ?? t('selectedTool')
      return React.createElement('span', { className: 'dshWorkToolReference', title: label },
        React.createElement(NavigationIcon, { id: 'tools', size: 14 }), label)
    }
    function installWorkToolMessages(ctx) {
      const ns = 'desktop.toolMessage'
      ctx.effect(() => ctx.locale.register(ns, { zh: { selectedTool: '已选工具' }, en: { selectedTool: 'Selected tool' } }), 'desktop tool message locale')
      ctx.effect(() => ctx.uiConversation.userText.register(workToolMessageRule), 'desktop tool message rule')
      ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
        name: 'conversation.user.text.node', key: TOOL_REFERENCE_SOURCE, priority: 100,
        inject: () => ({ t: ctx.locale.bind(ns) })
      }, WorkToolMessage))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-tool-message'
        style.textContent = '.dshWorkToolReference{color:var(--dsw-alias-state-business-primary);overflow-wrap:anywhere}.dshWorkToolReference svg{vertical-align:text-bottom;margin-inline-end:4px}'
        document.head.appendChild(style)
        return () => style.remove()
      })
    }
    const SKILL_REFERENCE_SOURCE = 'desktop-skill'
    const decodeSkillReference = ref => {
      const value = JSON.parse(ref)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name) || typeof value.label !== 'string') throw new Error('Invalid skill reference.')
      return value
    }
    const skillReferenceSource = {
      trigger: '/', name: SKILL_REFERENCE_SOURCE, candidates: async () => [], onPick: () => undefined, openReference: () => false,
      codec: {
        clipboardText: ref => `/${decodeSkillReference(ref).label}`,
        serialize: async (ref, signal) => {
          const skill = decodeSkillReference(ref)
          if (skill.enterprise) await workSkillRequest({ operation: 'validate', names: [skill.name] }, signal)
          return ` /${skill.name} `
        }
      }
    }
    const KNOWLEDGE_REFERENCE_SOURCE = 'desktop-knowledge'

    // The editor owns the draft selection. Retrieval scope is committed before
    // submission, so clearing a sent draft leaves the running task's scope intact.
    function createWorkKnowledgeComposer({ inputFor, ensureSession, request }) {
      const used = new WeakSet()
      const decode = ref => {
        const space = JSON.parse(ref)
        if (!Number.isSafeInteger(space.id) || space.id <= 0 || typeof space.name !== 'string') throw new Error('Invalid knowledge reference.')
        return space
      }
      const read = sessionId => inputFor(sessionId).input.state.getSnapshot().occurrences
        .filter(item => item.source === KNOWLEDGE_REFERENCE_SOURCE).map(item => decode(item.ref))
      const update = (sessionId, spaces, captureInsertion) => {
        const { input, scope } = inputFor(sessionId)
        if (!['plain', 'claimed'].includes(input.state.getSnapshot().phase)) throw new Error('Wait for the current submission to finish, then choose knowledge spaces.')
        const wanted = new Set(spaces.map(space => space.id))
        const snapshot = input.state.getSnapshot()
        let shift = 0
        const removed = []
        for (const item of snapshot.occurrences) {
          if (item.source === KNOWLEDGE_REFERENCE_SOURCE && !wanted.has(decode(item.ref).id)) removed.push(item.offset - shift)
          shift += item.length - 1
        }
        for (const start of removed.reverse()) {
          const state = input.state.getSnapshot()
          if (!scope.bail(scope, 'slash/input-insert-text', { text: '', span: { start, end: start + 1, draftRev: state.draftRev } })) throw new Error('Knowledge selection changed. Please try again.')
        }
        const present = new Set(read(sessionId).map(space => space.id))
        for (const space of spaces) {
          if (present.has(space.id)) continue
          const ref = JSON.stringify({ id: space.id, name: space.name })
          if (!input.insertReference({ source: KNOWLEDGE_REFERENCE_SOURCE, appearance: 'folder', ref, label: space.name, clipboardText: `@${space.name}` }, captureInsertion())) throw new Error('Knowledge selection changed. Please try again.')
          present.add(space.id)
        }
        used.add(inputFor(sessionId).input)
      }
      const source = {
        trigger: '@', name: KNOWLEDGE_REFERENCE_SOURCE,
        candidates: async () => [],
        onPick: () => undefined,
        openReference: () => false,
        codec: { clipboardText: ref => `@${decode(ref).name}`, serialize: async ref => `@${decode(ref).name}` },
      }
      const catalogFor = async (sessionId, signal) => {
        const { input } = inputFor(sessionId)
        const catalog = await request('catalog', sessionId, undefined, signal)
        signal?.throwIfAborted()
        if (inputFor(sessionId).input !== input) throw new Error('Work task changed.')
        return catalog.spaces
      }
      const refresh = async (sessionId, signal) => {
        if (read(sessionId).length === 0) return
        const spaces = await catalogFor(sessionId, signal)
        const { input } = inputFor(sessionId)
        if (['plain', 'claimed'].includes(input.state.getSnapshot().phase)) {
          const allowed = new Set(spaces.map(space => space.id))
          const current = read(sessionId)
          const retained = current.filter(space => allowed.has(space.id))
          if (retained.length < current.length) update(sessionId, retained)
        }
      }
      const choose = async (sessionId, ids, captureInsertion, signal) => {
        const spaces = await catalogFor(sessionId, signal)
        update(sessionId, spaces.filter(space => ids.includes(space.id)), captureInsertion)
      }
      const prepare = async ({ sessionId, references, signal, command }) => {
        // Goal control commands keep the active objective's retrieval scope.
        if (command && (command.name !== 'goal' || !command.args.trim() || /^(?:clear|pause|resume|edit)$/i.test(command.args.trim()))) return
        signal.throwIfAborted()
        const ids = [...new Set(references.filter(item => item.source === KNOWLEDGE_REFERENCE_SOURCE).map(item => decode(item.ref).id))]
        if (!ids.length && !used.has(inputFor(sessionId).input)) return
        await ensureSession(sessionId, signal)
        await request('select', sessionId, ids, signal)
        used.add(inputFor(sessionId).input)
      }
      return { read, update, source, prepare, refresh, choose, state: sessionId => inputFor(sessionId).input.state }
    }

    function WorkResourceAccessory({ sessionId, controls, t, inputActions, knowledge }) {
      const [open, setOpen] = React.useState(false)
      const [spaces, setSpaces] = React.useState([])
      const [draft, setDraft] = React.useState([])
      const [keyword, setKeyword] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState('')
      const [accessError, setAccessError] = React.useState('')
      const [revision, retry] = React.useReducer(value => value + 1, 0)
      React.useEffect(() => {
        let pending
        let signature
        const refresh = () => {
          pending?.abort()
          const abort = new AbortController()
          pending = abort
          knowledge.refresh(sessionId, abort.signal)
            .then(() => { if (!abort.signal.aborted) setAccessError('') })
            .catch(reason => { if (!abort.signal.aborted) setAccessError(reason.message) })
        }
        const changed = () => {
          const state = knowledge.state(sessionId).getSnapshot()
          const next = JSON.stringify([state.phase, knowledge.read(sessionId)])
          if (next === signature) return
          signature = next
          if (['plain', 'claimed'].includes(state.phase)) refresh()
        }
        const visible = () => { if (document.visibilityState === 'visible') refresh() }
        const unsubscribe = knowledge.state(sessionId).subscribe(changed)
        changed()
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', visible)
        const timer = setInterval(visible, 30_000)
        return () => {
          pending?.abort(); unsubscribe(); clearInterval(timer)
          window.removeEventListener('focus', refresh)
          document.removeEventListener('visibilitychange', visible)
        }
      }, [sessionId, knowledge])
      const commitAbort = React.useRef()
      React.useEffect(() => {
        setSaving(false)
        return () => commitAbort.current?.abort()
      }, [sessionId])
      React.useEffect(() => {
        const control = { open: () => { setKeyword(''); setOpen(true) }, captureInsertion: () => inputActions.captureInsertion() }
        controls.set(sessionId, control)
        return () => { if (controls.get(sessionId) === control) controls.delete(sessionId) }
      }, [sessionId, controls, inputActions])
      React.useEffect(() => {
        if (!open) return
        const abort = new AbortController()
        setLoading(true); setError('')
        workResourceRequest('catalog', sessionId, undefined, abort.signal)
          .then(catalog => { if (!abort.signal.aborted) { setSpaces(catalog.spaces); setDraft(knowledge.read(sessionId).map(space => space.id)) } })
          .catch(reason => { if (!abort.signal.aborted) setError(reason.message) })
          .finally(() => { if (!abort.signal.aborted) setLoading(false) })
        return () => abort.abort()
      }, [open, revision, sessionId, knowledge])
      const close = () => { if (!saving) setOpen(false) }
      const commit = async ids => {
        const abort = new AbortController()
        commitAbort.current?.abort()
        commitAbort.current = abort
        setSaving(true); setError('')
        try {
          await knowledge.choose(sessionId, ids, () => inputActions.captureInsertion(), abort.signal)
          setOpen(false)
        }
        catch (reason) { if (!abort.signal.aborted) setError(reason.message) }
        finally { if (!abort.signal.aborted) setSaving(false) }
      }
      const visible = spaces.filter(space => space.name.toLowerCase().includes(keyword.trim().toLowerCase())).sort((a, b) => {
        const an = a.name.trim(), bn = b.name.trim()
        const aIsEn = an.length > 0 && an.charCodeAt(0) < 128
        const bIsEn = bn.length > 0 && bn.charCodeAt(0) < 128
        return aIsEn !== bIsEn ? (aIsEn ? -1 : 1) : an.localeCompare(bn, aIsEn ? 'en' : 'zh-Hans-u-co-pinyin', { sensitivity: 'base' })
      })
      const icon = kind => React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        kind === 'search' ? [React.createElement('circle', { key: 'circle', cx: 11, cy: 11, r: 8 }), React.createElement('path', { key: 'handle', d: 'm21 21-4.3-4.3' })] :
        kind === 'close' ? React.createElement('path', { d: 'm18 6-12 12M6 6l12 12' }) :
        [React.createElement('path', { key: 'left', d: 'M12 7v14m0-14C10 5 8 5 2 5v14c6 0 8 0 10 2' }), React.createElement('path', { key: 'right', d: 'M12 7c2-2 4-2 10-2v14c-6 0-8 0-10 2' })])
      return React.createElement(React.Fragment, null,
        (error || accessError) && !open && React.createElement('div', { role: 'alert', className: 'dshWorkResourceError' }, error || accessError),
        React.createElement(Modal, { open, onClose: close, title: t('selectKnowledge'), headless: true, backdropBlur: false, className: 'dshWorkKnowledgeDialog' },
          React.createElement('header', { className: 'dshWorkKnowledgeHeader' },
            React.createElement('h2', null, t('selectKnowledge')),
            React.createElement('button', { type: 'button', onClick: close, disabled: saving, 'aria-label': t('close') }, icon('close'))),
          React.createElement('div', { className: 'dshWorkKnowledgeBody' },
            React.createElement('div', { className: 'dshWorkKnowledgeSearchField' }, icon('search'),
              React.createElement('input', { className: 'dshWorkKnowledgeSearch', 'data-modal-autofocus': true, type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: keyword, onChange: event => setKeyword(event.target.value) })),
            React.createElement('div', { className: 'dshWorkKnowledgeColumns' }, React.createElement('span', null, t('knowledge')), React.createElement('span', null, t('modified'))),
            React.createElement('div', { className: 'dshWorkKnowledgeList', 'aria-busy': loading },
              loading ? React.createElement('p', { role: 'status' }, t('loading')) : error ? React.createElement('div', { role: 'alert' }, error, React.createElement(Button, { onClick: retry }, t('retry'))) : visible.length === 0 ? React.createElement('p', { role: 'status' }, t(keyword ? 'noMatch' : 'empty')) :
              ['department', 'mine', 'joined'].map(group => {
                const rows = visible.filter(space => space.group === group)
                return rows.length > 0 && React.createElement('section', { key: group }, React.createElement('h3', null, t(group)), rows.map(space => {
                  const checked = draft.includes(space.id)
                  const date = space.updatedAt ? new Date(space.updatedAt) : null
                  const validDate = date && !Number.isNaN(date.getTime())
                  return React.createElement('label', { key: space.id, className: 'dshWorkKnowledgeRow', 'data-selected': checked },
                    React.createElement('input', { type: 'checkbox', checked, 'aria-label': space.name, disabled: saving || (!checked && draft.length >= 50), onChange: event => setDraft(ids => event.target.checked ? [...ids, space.id] : ids.filter(id => id !== space.id)) }),
                    React.createElement('span', { className: 'dshWorkKnowledgeIcon' }, icon('book')),
                    React.createElement('span', { className: 'dshWorkResourceName', title: space.name }, space.name),
                    React.createElement('time', { className: 'dshWorkKnowledgeModified', dateTime: validDate ? space.updatedAt : undefined }, validDate ? date.toLocaleDateString() : '—'))
                }))
              })),
            draft.length >= 50 && React.createElement('p', { role: 'status' }, t('limit'))),
          React.createElement('footer', { className: 'dshWorkKnowledgeFooter' },
            React.createElement('span', { className: 'dshWorkSelectionCount', 'aria-live': 'polite' }, t('selected', { count: draft.length })),
            React.createElement(Button, { variant: 'outline', className: 'dshWorkKnowledgeCancel', disabled: saving, onClick: close }, t('cancel')),
            React.createElement(Button, { variant: 'primary', className: 'dshWorkKnowledgeConfirm', disabled: loading || saving || Boolean(error), onClick: () => commit(draft) }, t('confirm')))))
    }

    function installWorkResources(ctx) {
      const controls = new Map()
      const ensureSession = (sessionId, signal) => ctx.sessions.using(sessionId, { source: 'workResources', signal }, async () => undefined)
      const knowledge = createWorkKnowledgeComposer({ ensureSession, request: workResourceRequest, inputFor: sessionId => {
        const scope = ctx.sessions.scope(sessionId)
        if (!scope) throw new Error('Work task changed.')
        return { scope, input: ctx.conversation.input.for(scope) }
      } })
      ctx.effect(() => ctx.inputTriggers.registerSource(knowledge.source), 'desktop knowledge references')
      ctx.effect(() => ctx.inputTriggers.registerSource(skillReferenceSource), 'desktop skill references')
      ctx.effect(() => ctx.inputTriggers.registerSource(toolReferenceSource), 'desktop tool references')
      ctx.on('conversation/input-before-submit', knowledge.prepare)
      ctx.effect(() => ctx.locale.register(RESOURCE_NS, RESOURCE_COPY), 'desktop Work resources locale')
      const t = ctx.locale.bind(RESOURCE_NS)
      const available = session => ctx.sessions.subagentAddress(session.sessionId) === undefined
      ctx.commandUi.register({ name: 'skills', label: () => t('skills'), description: () => t('skillsHint'), icon: props => React.createElement(ResourceIcon, { ...props, id: 'skills' }), available,
        ui: { kind: 'popupSelect', searchMode: 'fuzzy-label',
          options: ({ sessionId }, signal) => ctx.sessions.using(sessionId, { source: 'workSkillPicker', signal }, async () => {
            const catalog = await workSkillRequest({ operation: 'catalog' }, signal)
            const labels = new Map(catalog.skills.map(skill => [skill.name, skill.displayName]))
            const result = await ctx.remote.skills.list({ sessionId }, signal)
            if (!result.ok) throw new Error(result.error.message)
            return result.value.skills.map(skill => ({
              id: JSON.stringify({ name: skill.name, label: labels.get(skill.name) || skill.name, enterprise: labels.has(skill.name) }),
              label: labels.get(skill.name) || skill.name,
              badgeIcon: labels.has(skill.name) ? props => React.createElement(ResourceIcon, { ...props, id: 'skills', size: 12 }) : undefined,
              detail: skill.description
            }))
          }),
          onSelect: (option, { sessionId }) => {
            const scope = ctx.sessions.scope(sessionId)
            if (!scope) throw new Error('Work task changed.')
            const input = ctx.conversation.input.for(scope)
            scope.bail(scope, 'slash/input-consume-token', { guard: { kind: 'bare-token', token: '/skills' } })
            const state = input.state.getSnapshot()
            const applied = input.insertReference({ source: SKILL_REFERENCE_SOURCE, appearance: 'skill', ref: option.id, label: option.label, clipboardText: `/${option.label}` }, { start: 0, end: 0, draftRev: state.draftRev })
            if (!applied) throw new Error('Finish editing the current command, then choose a skill.')
          }
        } })
      ctx.commandUi.register({ name: 'tools', label: () => t('tools'), description: () => t('toolsHint'), icon: props => React.createElement(ResourceIcon, { ...props, id: 'tools' }), available,
        ui: { kind: 'popupSelect', searchMode: 'fuzzy-label',
          options: async (_session, signal) => {
            const catalog = await workToolRequest({ operation: 'catalog' }, signal)
            return catalog.tools.map(tool => ({ id: JSON.stringify({ name: tool.name, label: tool.label, connectionKey: catalog.connectionKey }), label: tool.label, detail: tool.description }))
          },
          onSelect: (option, { sessionId }) => {
            const scope = ctx.sessions.scope(sessionId)
            if (!scope) throw new Error('Work task changed.')
            const input = ctx.conversation.input.for(scope)
            scope.bail(scope, 'slash/input-consume-token', { guard: { kind: 'bare-token', token: '/tools' } })
            const state = input.state.getSnapshot()
            if (state.occurrences.some(item => item.source === TOOL_REFERENCE_SOURCE && decodeToolReference(item.ref).name === decodeToolReference(option.id).name)) return
            if (!input.insertReference({ source: TOOL_REFERENCE_SOURCE, appearance: 'tool', ref: option.id, label: option.label, clipboardText: `/${option.label}` }, { start: 0, end: 0, draftRev: state.draftRev })) throw new Error('Finish editing the current command, then choose a tool.')
          }
        } })
      ctx.commandUi.register({ name: 'knowledge', label: () => t('knowledge'), description: () => t('knowledgeHint'), icon: props => React.createElement(ResourceIcon, { ...props, id: 'knowledge' }), available,
        ui: { kind: 'action', run: ({ sessionId }) => controls.get(sessionId)?.open() } })
      ctx.slots.inject('conversation.input.accessory', () => ctx.slots.register({ name: 'conversation.input.accessory', id: 'desktop-work-resources', order: 20, inject: sessionId => ({ sessionId, controls, t, knowledge }) }, WorkResourceAccessory))
      ctx.effect(() => {
        if (document.getElementById('desktop-work-resources-style')) return
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-client-ui'
        style.id = 'desktop-work-resources-style'
        // Match the Chat KnowledgeSpaceDialog layout using the native Work modal's focus and dismissal handling.
        style.textContent = `
          .dshWorkKnowledgeDialog{width:min(600px,100%);max-height:100%;padding:0;gap:0;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);font-size:14px;line-height:20px}
          .dshWorkKnowledgeHeader{height:56px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 16px}
          .dshWorkKnowledgeHeader h2{margin:0;font-size:16px;line-height:24px;font-weight:600}
          .dshWorkKnowledgeHeader button{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
          .dshWorkKnowledgeHeader button:hover{background:var(--dsw-alias-interactive-bg-hover)}
          .dshWorkKnowledgeBody{padding:0 16px;min-height:0;overflow:auto}
          .dshWorkKnowledgeSearchField{position:relative;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary)}
          .dshWorkKnowledgeSearchField>svg{position:absolute;left:12px;pointer-events:none}
          .dshWorkKnowledgeSearch{box-sizing:border-box;width:100%;height:32px;padding:5px 12px 5px 36px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit}
          .dshWorkKnowledgeSearch::placeholder{color:var(--dsw-alias-label-tertiary)}
          .dshWorkKnowledgeColumns{display:flex;justify-content:space-between;margin-top:20px;padding:0 8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
          .dshWorkKnowledgeList{height:min(440px,48vh);flex:none;overflow:auto;margin-top:8px}
          .dshWorkKnowledgeList section{margin-bottom:16px}
          .dshWorkKnowledgeList h3{margin:0 0 8px;font-size:12px;line-height:20px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
          .dshWorkKnowledgeRow{box-sizing:border-box;display:flex;align-items:center;gap:12px;min-height:60px;padding:12px 8px;border-radius:8px;border-bottom:1px solid var(--dsw-alias-border-l2);cursor:pointer;min-width:0}
          .dshWorkKnowledgeRow:hover,.dshWorkKnowledgeRow[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}
          .dshWorkKnowledgeRow input{appearance:none;flex:none;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer}
          .dshWorkKnowledgeRow input:checked{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3 8 3 3 7-7' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E")}
          .dshWorkKnowledgeRow input:disabled{opacity:.4;cursor:default}
          .dshWorkKnowledgeIcon{box-sizing:border-box;display:grid;place-items:center;flex:none;width:32px;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary)}
          .dshWorkResourceName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
          .dshWorkKnowledgeModified{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}
          .dshWorkKnowledgeFooter{display:flex;align-items:center;gap:12px;flex:none;padding:16px}
          .dshWorkSelectionCount{margin-right:auto;color:var(--dsw-alias-label-tertiary)}
          .dshWorkKnowledgeFooter button{height:32px;padding:0 16px;border-radius:6px;font:inherit;white-space:nowrap}
          .dshWorkKnowledgeCancel{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
          .dshWorkKnowledgeConfirm{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);border:1px solid var(--dsw-alias-state-business-primary)}
          .dshWorkKnowledgeConfirm:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 88%,var(--dsw-alias-label-primary))}
          .dshWorkKnowledgeConfirm:disabled{opacity:.5}
          .dshWorkResourceError{padding:8px 12px;color:var(--dsw-alias-state-error-primary);font-size:12px}
          @media(max-width:1023px){.dshWorkKnowledgeDialog{width:min(400px,100%)}}
          @media(max-width:575px){.dshWorkKnowledgeModified{max-width:80px}.dshWorkKnowledgeFooter{flex-wrap:wrap}.dshWorkSelectionCount{flex:1 0 100%}}
        `
        document.head.appendChild(style)
        return () => style.remove()
      })
    }

    /** Consume successful-turn facts independently of the selected conversation and animation frames. */
    function installWorkCompletionNotifications(ctx, navigation) {
      const bridge = window.dshDesktopNotifications
      if (!bridge) return
      ctx.effect(() => {
        const observed = new Map()
        const startedAt = Date.now()
        const report = () => {
          const list = ctx.sessions.list.getSnapshot()
          // Completion projections arrive independently of catalog metadata. Work
          // notifications follow those facts even while the catalog loads or fails.
          for (const [id, projection] of Object.entries(list.projectionsBySession)) {
            const completion = projection.values.desktopWorkCompletion
            if (!completion) continue
            const previous = observed.get(id)
            observed.set(id, Math.max(previous ?? 0, completion.count))
            // Baselines carry history. A first read can also contain a fast task completed since subscription.
            if (previous === undefined ? completion.count === 0 || completion.time < startedAt : completion.count <= previous) continue
            void bridge.completed({ sessionId: id, turn: completion.turn, seq: completion.seq,
              count: previous === undefined ? 1 : completion.count - previous }).catch(error => {
              console.error('[desktop-notification] completion delivery failed', error)
            })
          }
        }
        const unsubscribe = ctx.sessions.list.subscribe(report)
        report()
        const unclick = bridge.onClicked(sessionId => {
          navigation.select('work')
          ctx.uiWorkspace.openSession(sessionId)
        })
        return () => { unsubscribe(); unclick(); observed.clear() }
      })
    }

    const inject = ['slots', 'locale', 'remote', 'remote.session', 'sessions', 'uiWorkspace', 'layout']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(DELETE_SESSION_NS, {
        zh: {
          menu: '永久删除会话', title: '删除会话', close: '关闭', cancel: '取消', confirm: '删除会话',
          description: '确定删除“{name}”？工作区文件会保留。此操作无法撤销。',
          pending: '正在删除会话…', failed: '删除失败，请重试。'
        },
        en: {
          menu: 'Delete session permanently', title: 'Delete session', close: 'Close', cancel: 'Cancel', confirm: 'Delete session',
          description: 'Delete “{name}”? Workspace files are kept. This can’t be undone.',
          pending: 'Deleting session…', failed: 'Deletion failed. Please try again.'
        }
      }))
      const deletion = createSessionDeletion((sessionId) => {
        const workspace = ctx.get('uiWorkspace')
        if (!workspace) throw new Error('Workspace navigation is unavailable')
        return workspace.deleteSession(sessionId)
      })
      ctx.effect(() => () => deletion.dispose())
      const deletionText = ctx.locale.bind(DELETE_SESSION_NS)
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'desktop-delete-session-dialog', locale: DELETE_SESSION_NS,
        inject: () => ({ deletion, t: deletionText })
      }, DeleteSessionDialog))
      const navigation = installDesktopModes(ctx)
      installWorkCompletionNotifications(ctx, navigation)
      if (typeof ctx.inject === 'function') ctx.inject(['desktopWorkbenches'], scoped => {
        scoped.effect(() => navigation.bindWorkbench(scoped.desktopWorkbenches))
      })
      if (typeof ctx.inject === 'function') ctx.inject(['uiConversation'], installWorkToolMessages)
      if (typeof ctx.inject === 'function') ctx.inject(['commandUi', 'inputTriggers', 'conversation', 'remote.skills'], installWorkResources)
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
          style.dataset.plugin = 'dsh-desktop-client-ui'
          style.id = id
        }
        style.textContent = `
          [data-dsh-sidebar-brand-identity] { display:none !important; }
          :root { --dsh-page-title-top-spacing:56px; }
          /* Top-level page titles align with the sidebar brand row. Keep
             conversation chrome and detail/dialog headers in their own layout. */
          [data-plugin-panel] { scrollbar-gutter:stable; }
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
              { name: 'conversation.hero.brand.mark', inject: () => ({ navigation }) },
              ConversationBrandMark
            )
          })
        )
      )
      ctx.slots.inject('conversation.hero.brand.title', () => ctx.slots.register({ name: 'conversation.hero.brand.title', inject: () => ({ navigation, t: ctx.locale.bind(MODES_NS) }) }, ConversationBrandTitle))
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
          locale: DELETE_SESSION_NS,
          inject: () => ({ deletion, t: deletionText })
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

    exports.createWorkKnowledgeComposer = createWorkKnowledgeComposer
    exports.skillReferenceSource = skillReferenceSource
    exports.toolReferenceSource = toolReferenceSource
    exports.apply = apply
    exports.installWorkCompletionNotifications = installWorkCompletionNotifications
    exports.inject = inject
    return module.exports
  }
})
