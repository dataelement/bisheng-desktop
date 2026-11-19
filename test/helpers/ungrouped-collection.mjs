import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Execute the installed Harness projection and collection seam, including its fallback.
const source = await readFile('node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', 'utf8')
const pure = source.slice(source.indexOf('function isWindowsStylePath('), source.indexOf('//#region lib/types/client/stores.js'))
const helpers = source.slice(source.indexOf('const SESSION_WATERMARK_BASE ='), source.indexOf('function SessionTree('))
const tree = source.slice(source.indexOf('function SessionTree('), source.indexOf('\n\t\t/** The flat', source.indexOf('function SessionTree(')))
const jsx = (type, props, key) => ({ type, props, key })
const SessionTree = vm.runInNewContext(`(() => { ${pure}\n${helpers}\n${tree}\nreturn SessionTree })()`, {
  react: { useMemo: fn => fn(), useEffect() {}, useState: value => [value, () => {}], useRef: value => ({ current: value }) },
  react_jsx_runtime: { jsx, jsxs: jsx }, clsx: (...args) => args.filter(Boolean).join(' '),
  WorkspaceBrowser_module_css_default: new Proxy({}, { get: (_, key) => key }),
  _deepseek_ai_dsh_client_ui_primitives: { HoverCardGroup: 'HoverCardGroup' },
  SessionNodeItem: 'NativeSession', ProjectRowItem: 'NativeProject', AnimatedRows: 'NativeRows', EmptySessions: 'Empty',
  console
})
export function fixture() {
  const session = (id, time) => ({ id, title: id, updatedAt: time, blank: false, retainedBy: {}, running: false })
  const list = { phase: 'ready', ids: ['assigned', 'loose', 'archived'], byId: { assigned: session('assigned', 30), loose: session('loose', 20), archived: session('archived', 10) }, projectionsBySession: {} }
  list.byId.assigned.retainedBy.mainView = 1
  return { list, workspaces: [{ workspaceId: 'project', title: 'Project', path: '/fixture', sessionIds: ['assigned'], createdAt: '2026-01-01' }] }
}
export function collect(props, { archivedFilter = 'default', groupExpansion = { project: true, "": true } } = {}) {
  let collection, fallback
  SessionTree({ ...props, usePanelInfo: fn => fn({ activePanelId: null }), useSessionStatus: fn => fn(new Map()),
    workspaceReady: true, ungroupedSessionIds: props.list.ids.filter(id => !props.workspaces.some(workspace => workspace.sessionIds.includes(id))), rowState: { archivedSessionIds: ['archived'], pinnedSessionIds: [], archivedFilter },
    groupExpansion, setGroupExpanded() {}, unreadSessionIds: [], shortcuts: [], t: key => key,
    renderSlot(name, owner, options) { if (name === 'sidebar.workspaces.collection') { collection = owner; fallback = options.fallback } return jsx('Collection', owner) }
  })
  return { collection, fallback }
}
export function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten)
  return node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
}
