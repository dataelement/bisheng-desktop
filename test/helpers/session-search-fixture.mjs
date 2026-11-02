import defaultReact from 'react'
import * as defaultReactDOM from 'react-dom/client'
import * as defaultJsx from 'react/jsx-runtime'

// Host stores and search transport are fixtures; native checks supply shipped shared modules.
export function createSessionSearchFixture(workspaceSource, desktopSource, { groupBy = 'flat', shared = true, archivedOnly = false, locale, runtime = {}, searchSessions = async () => ({ items: [], hasMore: false }) } = {}) {
  const React = runtime.react || defaultReact
  const { createRoot } = runtime['react-dom/client'] || defaultReactDOM
  const jsx = runtime['react/jsx-runtime'] || defaultJsx
  const primitives = runtime['@deepseek-ai/dsh-client-ui-primitives'] || new Proxy({}, { get: (_, name) => name === 'relativeTime'
    ? () => ({ unit: 'day', n: 1 })
    : name.startsWith('Icon') ? () => null
      : ({ children, anchor }) => React.createElement(React.Fragment, null, anchor || children) })
  const store = { createSnapshotStore(value) {
    const listeners = new Set()
    return { getSnapshot: () => value, set(next) { value = next; listeners.forEach(fn => fn()) }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  } }
  const modules = { react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/cordis': { Service: class {} }, '@deepseek-ai/dsh-client-store': store, '@deepseek-ai/dsh-client-ui-primitives': primitives }
  function load(source, exports) {
    let runtime
    const previous = window.__ModuleLoader__
    window.__ModuleLoader__ = { load({ factory }) { runtime = factory(name => {
      if (name in modules) return modules[name]
      throw new Error(`Unexpected fixture dependency: ${name}`)
    }) } }
    try { new Function(source.replace('exports.apply = apply', `${exports}; exports.apply = apply`))() }
    finally { window.__ModuleLoader__ = previous }
    return runtime
  }
  const { WorkspaceBrowser, createWorkspaceShortcutControls, zh, en } = load(workspaceSource, 'exports.WorkspaceBrowser = WorkspaceBrowser; exports.createWorkspaceShortcutControls = createWorkspaceShortcutControls; exports.zh = zh; exports.en = en')
  const { SharedCollection, MODES_COPY } = load(desktopSource, 'exports.SharedCollection = SharedCollection; exports.MODES_COPY = MODES_COPY')
  const workspaceCopy = locale === 'zh' ? zh : en
  const t = key => locale ? workspaceCopy[key] || key : key
  const desktopT = key => locale ? MODES_COPY[locale][key] || key : key
  const controls = createWorkspaceShortcutControls()
  const catalog = { phase: 'ready', projectionsBySession: {}, ids: ['one', 'two'], byId: Object.fromEntries(['one', 'two'].map(id => [id, { id, title: `会话 ${id}`, updatedAt: 1, blank: false, retainedBy: {} }])) }
  const workspaces = { phase: 'ready', state: 'ready', items: [], archivedSessionIds: [], pinnedSessionIds: [] }
  const view = { groupBy, orderBy: 'updated', archivedFilter: archivedOnly ? 'only' : 'default', groupExpansion: { '': true }, sessionOrderByAccount: {}, unreadSessionIds: [] }
  let cloud = { mode: 'work', page: 1, historyPhase: 'ready', items: [{ id: 'cloud', title: '云端会话', updatedAt: '2026-01-01T00:00:00Z' }] }
  const cloudListeners = new Set()
  const opened = []
  const navigation = { snapshot: () => cloud, subscribe: fn => { cloudListeners.add(fn); return () => cloudListeners.delete(fn) }, open: id => opened.push(`chat:${id}`) }
  const actions = Object.fromEntries(['retainAccountKeys', 'syncSessionOrders', 'setGroupExpanded', 'setSessionOrder'].map(name => [name, () => {}]))
  const props = {
    wide: true,
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: selector => selector(catalog),
    useSessionStatus: selector => selector(new Map()),
    useWorkspaces: selector => selector(workspaces),
    useStore: selector => selector(view),
    useHostInfo: selector => selector({ home: '/fixture' }),
    useShortcuts: selector => selector([]),
    useWorkspaceShortcuts: selector => selector(React.useSyncExternalStore(controls.state.subscribe, controls.state.getSnapshot)),
    useSessionVisibility: selector => selector(0),
    useWorkspaceVisibility: selector => selector(0),
    isSessionVisible: () => true,
    isWorkspaceVisible: () => true,
    useDirectoryFlow: selector => selector(false),
    requestSearch: controls.search,
    closeAddWorkspace: controls.closeAdd,
    searchSessions,
    searchResultLimit: 20,
    open: id => opened.push(`work:${id}`),
    actions,
    renderSlot: (name, props, options) => shared && name === 'sidebar.workspaces.collection'
      ? React.createElement(SharedCollection, { ...props, navigation, t: desktopT })
      : options?.fallback,
    t
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  return {
    host, catalog, get cloud() { return cloud }, opened,
    updateCloud(patch) { cloud = { ...cloud, ...patch }; cloudListeners.forEach(fn => fn()) },
    mount: () => root.render(React.createElement(WorkspaceBrowser, props)),
    openSearch: () => host.querySelector(`[aria-label="${t('search.sessions.aria')}"]`).click(),
    type(query) {
      const input = host.querySelector(`input[placeholder="${t('search.placeholder')}"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    clear: () => host.querySelector(`[aria-label="${t('search.clear')}"]`).click(),
    escape: () => host.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    unmount() { root.unmount(); host.remove() }
  }
}
