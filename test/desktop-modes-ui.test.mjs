// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
const disposers = []
beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', callback => { queueMicrotask(() => callback(0)); return 0 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  // jsdom supplies DOM state; the Electron fixture verifies native visibility/layout.
  const original = Element.prototype.checkVisibility
  Element.prototype.checkVisibility = function () {
    return !this.closest('[hidden], [style="display: none;"], [style="visibility: hidden;"]')
  }
  disposers.push(() => {
    if (original) Element.prototype.checkVisibility = original
    else delete Element.prototype.checkVisibility
    document.querySelectorAll('[data-host-dialog-fixture]').forEach(element => element.remove())
  })
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  document.documentElement.removeAttribute('data-dsh-safe-mode-page')
  document.documentElement.removeAttribute('data-dsh-about-open')
  document.documentElement.removeAttribute('data-dsh-update-card')
  document.getElementById('dsh-desktop-update-root')?.remove()
  document.body.removeAttribute('data-ds-dark-theme')
  disposers.splice(0).reverse().forEach(dispose => dispose())
  delete window.dshEnterpriseChat
  delete window.__ModuleLoader__
  vi.unstubAllGlobals()
})
async function mount(connected = false, collection = {}, inert = false, workbench, prepare, work = React.createElement('textarea', { 'aria-label': 'work draft', defaultValue: 'retained draft' })) {
  let workbenchSnapshot = workbench
  let bindWorkbench, disposeWorkbench
  const workbenchListeners = new Set()
  const attachWorkbench = () => bindWorkbench({
    desktopWorkbenches: {
      getSnapshot: () => workbenchSnapshot,
      subscribe: fn => { workbenchListeners.add(fn); return () => workbenchListeners.delete(fn) }
    },
    effect(fn) { disposeWorkbench = fn() }
  })
  disposers.push(() => disposeWorkbench?.())
  let snapshot = { connected, phase: 'ready', epoch: 1, conversationId: 'new', settingsProtocolVersion: 1, projectScope: 'account-a' }
  let chatListener
  let projectListener
  const projectAccounts = new Map()
  const projectData = () => {
    const key = snapshot.projectScope
    if (!projectAccounts.has(key)) projectAccounts.set(key, { projects: [], assignments: {}, revision: 0 })
    return projectAccounts.get(key)
  }
  const projectSnapshot = () => ({ ...structuredClone(projectData()), epoch: snapshot.epoch, revision: String(projectData().revision), phase: 'ready', connection: 'live' })
  window.dshEnterpriseChat = {
    projectsState: vi.fn(async () => projectSnapshot()),
    onProjectsChanged: fn => { projectListener = fn; return () => { projectListener = undefined } },
    projectConversations: vi.fn(async input => ({ epoch: snapshot.epoch, revision: String(projectData().revision), nextCursor: null, items: input.query ? [] : Object.entries(projectData().assignments).filter(([, id]) => id === input.project_id).map(([id]) => ({ id, title: 'Cloud chat', updatedAt: '2026-10-16' })) })),
    projectAction: vi.fn(async action => {
      const data = projectData(), outcome = {}
      if (action.operation === 'create') {
        const id = crypto.randomUUID(); data.projects.unshift({ id, name: action.name }); outcome.project_id = id
        if (action.chat_id) data.assignments[action.chat_id] = id
      } else if (action.operation === 'assign') {
        if (action.project_id) data.assignments[action.chat_id] = action.project_id
        else delete data.assignments[action.chat_id]
      } else if (action.operation === 'rename') data.projects = data.projects.map(project => project.id === action.project_id ? { ...project, name: action.name } : project)
      else if (action.operation === 'delete') {
        data.projects = data.projects.filter(project => project.id !== action.project_id)
        data.assignments = Object.fromEntries(Object.entries(data.assignments).filter(([, id]) => id !== action.project_id))
      }
      data.revision++
      projectListener?.(projectSnapshot())
      return { epoch: snapshot.epoch, outcome }
    }),
    subscribe: fn => { chatListener = fn; return () => { chatListener = undefined } },
    state: vi.fn(async () => ({ ...snapshot })),
    present: vi.fn(async () => ({ ...snapshot })),
    retry: vi.fn(async () => {}),
    history: vi.fn(async () => ({ epoch: 1, items: [{ id: 'cloud-a', title: 'Cloud chat', updatedAt: '2026-10-16' }], hasMore: false })),
    openPage: vi.fn(async () => {}),
    open: vi.fn(async () => {})
  }
  prepare?.()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  let plugin, navigate
  let sessionList = { phase: 'ready', byId: { draft: { id: 'draft', blank: true, retainedBy: { mainView: 1 } } } }
  let liveState = { blank: true, pendingSubmissions: [], running: false, awaitingFirstTurn: false }
  const liveListeners = new Set()
  const liveSession = { getSnapshot: () => liveState, subscribe: fn => { liveListeners.add(fn); return () => liveListeners.delete(fn) } }
  let panelState = { activePanelId: null }
  const sessionListeners = new Set(), panelListeners = new Set()
  const localeListeners = new Set()
  let activeLocale = 'en'
  const setSessions = value => { sessionList = value; sessionListeners.forEach(fn => fn()) }
  const setPanel = id => { panelState = { activePanelId: id }; panelListeners.forEach(fn => fn()) }
  const registrations = new Map()
  const dictionaries = new Map()
  window.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        Button: ({ variant, size, ...props }) => React.createElement('button', props),
        Modal: ({ children, title, description, footer, onClose, closeLabel }) => createPortal(React.createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': title }, React.createElement('button', { onClick: onClose, 'aria-label': closeLabel }, closeLabel), description, children, footer), document.body),
        Menu: ({ anchor, open, items = [], children, onSelect, listClassName }) => {
          const [expanded, setExpanded] = React.useState()
          const rows = children || items.map(item => React.createElement('div', { key: item.id },
            React.createElement('button', { role: 'menuitem', disabled: item.disabled, 'aria-haspopup': item.submenu ? 'menu' : undefined,
              onClick: () => item.submenu ? setExpanded(item.id) : onSelect(item.id) }, item.label),
            expanded === item.id && item.submenu && React.createElement('div', { role: 'menu' },
              ...item.submenu.map(sub => React.createElement('button', { key: sub.id, role: 'menuitem', onClick: () => onSelect(sub.id) }, sub.label)))))
          return React.createElement('div', null, anchor, open && React.createElement('div', { role: 'menu', className: listClassName }, rows))
        },
        MenuItemButton: ({ children, onSelect, disabled }) => React.createElement('button', { role: 'menuitem', onClick: onSelect, disabled }, children),
        HoverCard: ({ anchor }) => anchor,
        relativeTime: () => ({ unit: 'days', n: 1 }),
        ...Object.fromEntries(['ChevronRightOutline', 'EditOutline', 'EllipsisOutline', 'FolderClose', 'FolderOpen', 'NewChatOutline', 'PlusOutline', 'TrashOutline', 'TriangleRightFill'].map(icon => [`Icon${icon}Regular`, () => null]))
      }
      throw new Error(name)
    })
  } }
  new Function(await readFile(process.env.DSH_TEST_HOST_DIALOG_CLIENT_SOURCE || 'packages/dsh-desktop-client-ui/client.js', 'utf8'))()
  plugin.apply({
    inject(names, callback) {
      if (names.includes('desktopWorkbenches')) {
        bindWorkbench = callback
        if (workbenchSnapshot) attachWorkbench()
      }
    },
    uiWorkspace: { registerNavigationHandler: (fn) => { navigate = fn; return () => {} }, startSession: () => { navigate('new'); setSessions({ phase: 'ready', byId: { draft: { id: 'draft', blank: true, retainedBy: { mainView: 1 } } } }); setPanel(null) } },
    sessions: { binding: id => id === 'draft' ? { session: liveSession } : undefined, list: { getSnapshot: () => sessionList, subscribe: fn => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) } } },
    layout: { selectPanel: setPanel, panelInfo: { getSnapshot: () => panelState, subscribe: fn => { panelListeners.add(fn); return () => panelListeners.delete(fn) } } },
    remote: {}, locale: { register(ns, copy) { dictionaries.set(ns, copy) }, bind: ns => (key, args = {}) => ns === 'desktop.chatProjects' ? dictionaries.get(ns)[activeLocale][key].replace(/\{(\w+)\}/g, (_, name) => args[name]) : key, getSnapshot: () => ({ active: activeLocale }), subscribe: fn => { localeListeners.add(fn); return () => localeListeners.delete(fn) } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    slots: {
      inject(name, fn) { if (['desktop.mode.content', 'sidebar.workspaces.collection', 'sidebar.primaryNavigation'].includes(name)) fn() },
      register(options, component) { registrations.set(options.name, { component, props: options.inject() }) }
    }
  })
  container = document.createElement('div')
  container.id = 'root'
  // jsdom reflects the host interaction boundary through this browser property.
  Object.defineProperty(container, 'inert', { get() { return this.hasAttribute('inert') }, set(value) { this.toggleAttribute('inert', value) } })
  container.inert = inert
  document.body.append(container)
  root = createRoot(container)
  const content = registrations.get('desktop.mode.content'), history = registrations.get('sidebar.workspaces.collection'), primary = registrations.get('sidebar.primaryNavigation')
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement('aside', null, React.createElement('button', { 'data-navigation-id': 'new', onClick: () => navigate('new') }, 'New session'), React.createElement(primary.component, { ...primary.props, wide: true, renderAction: ({ id, label, onClick, expanded, active }) => React.createElement('button', { 'data-navigation-id': id, 'aria-expanded': expanded, 'aria-current': active ? 'page' : undefined, onClick }, label), panels: [{ id: 'plugins', label: 'Plugins' }], startSession: (...args) => { expect(args).toHaveLength(0); navigate('new') }, selectPanel: setPanel, renderPanelIcon: () => null }), React.createElement(history.component, { ...history.props, mode: 'projects', query: '', archivedOnly: false, projects: () => React.createElement('div', { 'data-project': true }, 'Project task'), items: [{ id: 'local-a', updatedAt: Date.parse('2026-10-17'), render: active => React.createElement('button', { 'data-local-row': true, 'aria-current': active ? 'page' : undefined, onClick: () => navigate('open') }, 'Local task') }], ...collection })),
    React.createElement(content.component, { ...content.props, columns: '1fr 0px', work })
  )))
  return {
    projectStore: history.props.navigation.projects,
    controller: history.props.navigation,
    async workbench(active, enabled = true) {
      await act(async () => {
        workbenchSnapshot = { state: { active }, enabled }
        if (disposeWorkbench) workbenchListeners.forEach(fn => fn())
        else attachWorkbench()
      })
    },
    async unloadWorkbench() { await act(async () => { disposeWorkbench(); disposeWorkbench = undefined }) },
    workbenchListenerCount: () => workbenchListeners.size,
    async locale(value) { await act(async () => { activeLocale = value; localeListeners.forEach(fn => fn()) }) },
    localeListenerCount: () => localeListeners.size,
    async navigation(entries, path = '/skills') { snapshot = { ...snapshot, navigation: { entries, homeLabel: 'Welcome' }, path, conversationId: undefined }; await act(async () => chatListener(snapshot)) },
    navigate: (...args) => navigate(...args),
    async click(mode) { await act(async () => container.querySelector(`#dsh-mode-${mode}`).click()) },
    async account(next, epoch = 1) {
      snapshot = { connected: next, phase: 'ready', epoch, conversationId: 'new', settingsProtocolVersion: 1, projectScope: 'account-a' }
      await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:enterprise-account-changed')))
    },
    async pushState(patch) { snapshot = { ...snapshot, ...patch }; await act(async () => chatListener(snapshot)) },
    selected: () => container.querySelector('#dsh-panel-chat').hidden ? 'work' : 'chat',
    picker: () => container.querySelector('[role=tablist]'),
    async panel(id) { await act(async () => setPanel(id)) },
    async workSession(blank) { await act(async () => setSessions({ phase: 'ready', byId: { current: { id: 'current', blank, retainedBy: { mainView: 1 } } } })) },
    async cloudSession(id) { snapshot = { ...snapshot, conversationId: id }; await act(async () => window.dispatchEvent(new Event('focus'))) },
    async workLive(patch) { await act(async () => { liveState = { ...liveState, ...patch }; liveListeners.forEach(fn => fn()) }) },
    liveListenerCount: () => liveListeners.size,
    async cloudLanding(landing) { snapshot = { ...snapshot, landing }; await act(async () => chatListener(snapshot)) },
    async chatState(patch) { snapshot = { ...snapshot, ...patch }; await act(async () => chatListener(snapshot)) },
    async projectState(patch) { Object.assign(projectData(), patch); projectData().revision++; await act(async () => projectListener?.(projectSnapshot())) },
    draft: () => container.querySelector('textarea')
  }
}
it('shows mode selection on the native landing page and restores it after leaving a workbench', async () => {
  const ui = await mount()
  const draft = ui.draft()
  expect(ui.picker()).not.toBeNull()
  await ui.workbench('writer')
  expect(container.querySelector('.dshModesHeader')).toBeNull()
  await ui.workSession(false)
  await ui.workSession(true)
  expect(ui.picker()).toBeNull()
  await ui.workbench('research')
  expect(ui.picker()).toBeNull()
  await ui.workbench(null)
  expect(ui.picker()).not.toBeNull()
  expect(ui.draft()).toBe(draft)
  expect(draft.value).toBe('retained draft')
})

it('respects a restored workbench, the feature switch and optional service unload/reload', async () => {
  const ui = await mount(false, {}, false, { enabled: true, state: { active: 'writer' } })
  expect(ui.picker()).toBeNull()
  await ui.workbench('writer', false)
  expect(ui.picker()).not.toBeNull()
  await ui.workbench('writer')
  expect(ui.picker()).toBeNull()
  expect(ui.workbenchListenerCount()).toBe(1)
  await ui.unloadWorkbench()
  expect(ui.picker()).not.toBeNull()
  expect(ui.workbenchListenerCount()).toBe(0)
  await ui.workbench('writer')
  expect(ui.picker()).toBeNull()
  expect(ui.workbenchListenerCount()).toBe(1)
})

it('keeps Chat landing navigation available while a workbench is retained in Work', async () => {
  const ui = await mount(true, {}, false, { enabled: true, state: { active: 'writer' } })
  expect(ui.selected()).toBe('chat')
  expect(ui.picker()).not.toBeNull()
  await ui.click('work')
  expect(ui.selected()).toBe('work')
  expect(ui.picker()).toBeNull()
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
})

it('explains Chat sign-in before opening account settings while keeping the Work draft mounted', async () => {
  const ui = await mount(false, { items: [] })
  expect(ui.selected()).toBe('work')
  const history = container.querySelector('.dshRecentHistory')
  expect(history.textContent).toBe('recentrecentEmpty')
  expect(history.querySelectorAll('button')).toHaveLength(0)
  const draft = ui.draft()
  const open = vi.fn()
  window.addEventListener('dsh-desktop:open-settings-section', open)
  disposers.push(() => window.removeEventListener('dsh-desktop:open-settings-section', open))
  await ui.click('chat')
  expect(open).toHaveBeenCalledTimes(0)
  const dialog = document.querySelector('[role=dialog]')
  expect(dialog.getAttribute('aria-label')).toBe('signInTitle')
  expect(dialog.textContent).toContain('signInDescription')
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'signIn').click())
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(open.mock.calls[0][0].detail).toEqual({ id: 'enterprise-account' })
  expect(ui.selected()).toBe('work')
  expect(ui.draft()).toBe(draft)
  expect(container.querySelector('#dsh-panel-chat').hidden).toBe(true)
  expect(container.querySelector('#dsh-panel-chat button')).toBeNull()
})
it('opens Chat after enterprise sign-in, respects Work selection on refresh, and returns to Work after logout', async () => {
  const ui = await mount()
  const draft = ui.draft()
  await ui.account(true)
  expect(ui.selected()).toBe('chat')
  await ui.click('work')
  await ui.account(true)
  expect(ui.selected()).toBe('work')
  await ui.click('chat')
  await ui.account(false)
  expect(ui.selected()).toBe('work')
  expect(ui.draft()).toBe(draft)
  expect(draft.value).toBe('retained draft')
})
it('restores the existing enterprise login directly into Chat', async () => {
  const ui = await mount(true)
  expect(ui.selected()).toBe('chat')
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledWith(expect.objectContaining({ visible: true }))
})

it('delivers the active Harness language while settings hides Chat and cleans up its subscription', async () => {
  const ui = await mount(true)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en' }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: true } })))
  await ui.locale('zh')
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, locale: 'zh' }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: false } })))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, locale: 'zh' }))
  expect(ui.localeListenerCount()).toBe(1)
  await act(async () => root.unmount())
  root = undefined
  expect(ui.localeListenerCount()).toBe(0)
  const calls = window.dshEnterpriseChat.present.mock.calls.length
  await ui.locale('en')
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledTimes(calls)
})

it('hides Chat while a cloud rename dialog is open and restores it afterwards', async () => {
  const ui = await mount(true)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  // The dialog renders in the host document, beneath the native Chat view.
  await act(async () => ui.controller.requestRename('cloud-a', 'Cloud chat', 1))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => ui.controller.renaming.close())
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('hides Chat while a sidebar account dialog is open and restores it afterwards', async () => {
  await mount(true)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:account-dialog-visibility', { detail: { open: true } })))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:account-dialog-visibility', { detail: { open: false } })))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('keeps one shared history across modes and routes records to their owner', async () => {
  const ui = await mount(true)
  const sidebar = container.querySelector('aside')
  expect(sidebar.textContent).toContain('Cloud chat')
  expect(sidebar.textContent).toContain('Local task')
  await act(async () => container.querySelector('[data-local-row]').click())
  expect(ui.selected()).toBe('work')
  expect(container.querySelector('aside')).toBe(sidebar)
  await act(async () => container.querySelector('.dshHistoryRow').click())
  expect(ui.selected()).toBe('chat')
  expect(window.dshEnterpriseChat.open).toHaveBeenLastCalledWith('cloud-a')
  expect(container.querySelector('aside')).toBe(sidebar)
  await ui.account(false)
  expect(sidebar.textContent).not.toContain('Cloud chat')
  expect(sidebar.textContent).toContain('Local task')
  expect([...sidebar.querySelectorAll('.dshRecentHistory button')].map(button => button.textContent)).toEqual(['Local task'])
})
it('creates cloud chats through the shared New Session action and clears the view for settings', async () => {
  const ui = await mount(true)
  let handled
  await act(async () => { handled = ui.navigate('new') })
  expect(handled).toBe(true)
  expect(window.dshEnterpriseChat.open).toHaveBeenCalledWith('new')
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: true } })))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: false } })))
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await ui.click('work')
  await act(async () => { handled = ui.navigate('new') })
  expect(handled).toBeUndefined()
})

it('interleaves recent cloud and unassigned local rows while projects appear once', async () => {
  const ui = await mount(true)
  const rows = [...container.querySelectorAll('[data-history-kind]')]
  expect(rows.map(row => row.dataset.historyKind)).toEqual(['work', 'chat'])
  expect(container.querySelectorAll('[data-project]')).toHaveLength(1)
  expect(container.querySelector('.dshRecentHistory').textContent).not.toContain('Project task')
  expect(container.querySelector('[data-local-row]').getAttribute('aria-current')).toBeNull()
  await act(async () => container.querySelector('[data-local-row]').click())
  expect(container.querySelector('[data-local-row]').getAttribute('aria-current')).toBe('page')
  expect(ui.selected()).toBe('work')
})

it('places cloud projects between workspaces and conversations and files each chat once', async () => {
  const ui = await mount(true)
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Research')
  })
  const id = ui.projectStore.snapshot().projects[0].id
  await act(async () => ui.projectStore.toggle(id))
  expect([...container.querySelector('.dshSharedCollection').children].map(node => node.className || node.dataset.project)).toEqual(['true', 'dshChatProjects', 'dshRecentHistory'])
  const unfiled = container.querySelector('.dshRecentHistory [data-history-kind=chat]')
  const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
  await act(async () => unfiled.dispatchEvent(context))
  expect(context.defaultPrevented).toBe(true)
  expect(window.dshEnterpriseChat.open).not.toHaveBeenCalled()
  const move = () => container.querySelector('[role=menuitem][aria-haspopup=menu]')
  const choices = () => [...container.querySelectorAll('[role=menu] [role=menu] [role=menuitem]')]
  const destination = () => choices().find(node => node.textContent === 'Research')
  expect(move().textContent).toBe('Move to project')
  await act(async () => move().click())
  expect(choices().map(node => node.textContent)).toEqual(['New project', 'Research'])
  expect(window.dshEnterpriseChat.projectAction).toHaveBeenCalledTimes(1)
  window.dshEnterpriseChat.projectAction.mockRejectedValueOnce(new Error('offline'))
  await act(async () => destination().click())
  expect(ui.projectStore.snapshot().assignments).toEqual({})
  expect(container.querySelector('[role=alert]').textContent).toContain('Could not save projects')
  await act(async () => unfiled.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await act(async () => move().click())
  await act(async () => destination().click())
  expect(window.dshEnterpriseChat.projectAction).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'assign', chat_id: 'cloud-a', project_id: id }), 1)
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(ui.projectStore.snapshot().assignments).toEqual({ 'cloud-a': id })
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(1)
  expect(container.querySelector('[data-chat-project]').textContent).toContain('Cloud chat')
  expect(container.querySelector('.dshRecentHistory').textContent).not.toContain('Cloud chat')
  await act(async () => container.querySelector('[data-chat-project] [data-history-kind=chat]').click())
  expect(window.dshEnterpriseChat.open).toHaveBeenLastCalledWith('cloud-a')
  const filed = container.querySelector('[data-chat-project] [data-history-kind=chat]')
  expect(filed.getAttribute('aria-current')).toBe('page')
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Another project')
  })
  const shortcut = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
  await act(async () => filed.dispatchEvent(shortcut))
  expect(shortcut.defaultPrevented).toBe(true)
  expect(container.querySelector('[data-chat-project] .dshCloudHistoryActions').getAttribute('aria-expanded')).toBe('true')
  // Cloud rows lead with Rename, as Work rows do; this harness echoes non-project keys.
  expect([...container.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(['rename', 'Move to project', 'menu'])
  await act(async () => move().click())
  expect(destination()).toBeUndefined()
  expect(choices().map(node => node.textContent)).toEqual(['New project', 'Another project', 'Move out of project'])
  expect(window.dshEnterpriseChat.open).toHaveBeenCalledTimes(1)
  await act(async () => container.querySelector('[data-chat-project] .dshCloudHistoryActions').click())
  await ui.navigation([{ id: 'knowledge', label: 'Knowledge', active: true }])
  expect(filed.getAttribute('aria-current')).toBeNull()
  await act(async () => {
    ui.projectStore.edit('remove', id, 'Research')
    await ui.projectStore.confirm('')
  })
  expect(container.querySelector('.dshRecentHistory').textContent).toContain('Cloud chat')
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(1)
})

it('creates and files the conversation in one request when the submenu has no existing projects', async () => {
  const ui = await mount(true, { mode: 'all' })
  await act(async () => container.querySelector('.dshCloudHistoryActions').click())
  await act(async () => container.querySelector('[role=menuitem][aria-haspopup=menu]').click())
  const choices = [...container.querySelectorAll('[role=menu] [role=menu] [role=menuitem]')]
  expect(choices.map(choice => choice.textContent)).toEqual(['New project'])
  await act(async () => { choices[0].click(); await new Promise(resolve => setTimeout(resolve, 1)) })
  expect(document.querySelector('[role=dialog]').getAttribute('aria-label')).toBe('New project')
  expect(document.querySelector('[role=dialog] select')).toBeNull()
  expect(window.dshEnterpriseChat.projectAction).not.toHaveBeenCalled()
  await act(async () => ui.projectStore.confirm('Filed from all conversations'))
  expect(window.dshEnterpriseChat.projectAction).toHaveBeenCalledTimes(1)
  expect(window.dshEnterpriseChat.projectAction).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create', chat_id: 'cloud-a', name: 'Filed from all conversations' }), 1)
  const { projects, assignments } = ui.projectStore.snapshot()
  expect(assignments['cloud-a']).toBe(projects[0].id)
})

it('keeps cloud conversations with missing dates openable without showing a misleading age', async () => {
  const ui = await mount(true)
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([
    { id: 'cloud-a', title: 'Undated chat', updatedAt: '' }
  ]))
  await act(async () => ui.controller.refreshHistory())
  const row = container.querySelector('.dshRecentHistory [data-history-kind=chat]')
  expect(row.getAttribute('aria-label')).toBe('Undated chat')
  expect(row.querySelector('time')).toBeNull()
  await act(async () => row.click())
  expect(window.dshEnterpriseChat.open).toHaveBeenLastCalledWith('cloud-a')
})

it('uses server membership instead of assigning from a delayed project route', async () => {
  const ui = await mount(true)
  let id
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Drafts')
    id = ui.projectStore.snapshot().projects[0].id
    ui.controller.startProjectChat(id)
  })
  expect(window.dshEnterpriseChat.open).toHaveBeenLastCalledWith('new', id)
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: id })
  await ui.chatState({ conversationId: 'created-in-project', path: '/c/created-in-project', draftProjectId: undefined })
  expect(ui.projectStore.snapshot().assignments).toEqual({})
  await ui.projectState({ assignments: { 'created-in-project': id } })
  expect(ui.projectStore.snapshot().assignments).toEqual({ 'created-in-project': id })
  await ui.chatState({ conversationId: 'unrelated', path: '/c/unrelated' })
  expect(ui.projectStore.snapshot().assignments.unrelated).toBeUndefined()
  await act(async () => ui.controller.startProjectChat(id))
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: id })
  await act(async () => ui.controller.open('cloud-a'))
  await ui.chatState({ conversationId: 'cloud-a', path: '/c/cloud-a', draftProjectId: undefined })
  expect(ui.projectStore.snapshot().assignments['cloud-a']).toBeUndefined()
  await act(async () => ui.controller.startProjectChat(id))
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: id })
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: undefined })
  await ui.chatState({ conversationId: 'ordinary-new', path: '/c/ordinary-new' })
  expect(ui.projectStore.snapshot().assignments['ordinary-new']).toBeUndefined()
  await act(async () => ui.controller.startProjectChat(id))
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: id })
  await ui.chatState({ epoch: 2, projectScope: 'account-b', conversationId: 'other-account', path: '/c/other-account', draftProjectId: undefined })
  expect(ui.projectStore.snapshot()).toMatchObject({ projects: [], assignments: {}, editor: null })
  await ui.chatState({ epoch: 3, projectScope: 'account-a', conversationId: 'new', path: '/c/new' })
  expect(ui.projectStore.snapshot().assignments).toEqual({ 'created-in-project': id })
})

it('keeps assigned cloud conversations searchable and hides them on logout', async () => {
  const ui = await mount(true, { mode: 'search', query: 'CLOUD', projects: () => null, items: [] })
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Research')
    await ui.projectStore.assign('cloud-a', ui.projectStore.snapshot().projects[0].id)
  })
  expect(container.querySelector('.dshChatProjects')).toBeNull()
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(1)
  await ui.account(false)
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(0)
  expect(ui.projectStore.snapshot().projects).toEqual([])
})

it('keeps the latest project intent while an earlier blank navigation is still arriving', async () => {
  const ui = await mount(true)
  let first, second
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('First')
    first = ui.projectStore.snapshot().projects[0].id
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Second')
    second = ui.projectStore.snapshot().projects[0].id
    ui.controller.startProjectChat(first)
    ui.controller.startProjectChat(second)
  })
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: first })
  await ui.chatState({ conversationId: 'new', path: '/c/new', draftProjectId: second })
  await ui.chatState({ conversationId: 'second-created', path: '/c/second-created', draftProjectId: undefined })
  expect(ui.projectStore.snapshot().assignments).toEqual({})
  await ui.projectState({ assignments: { 'second-created': second } })
  expect(ui.projectStore.snapshot().assignments).toEqual({ 'second-created': second })
  await act(async () => ui.projectStore.edit('rename', second, 'Second'))
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  await ui.account(false)
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('searches cloud titles with local results and keeps archived-only views local', async () => {
  await mount(true, { mode: 'search', query: 'missing phrase', projects: () => null, items: [] })
  expect(container.querySelectorAll('[data-history-kind]')).toHaveLength(0)
  expect(container.textContent).toContain('recentSearchEmpty')
})
it('includes cloud search matches in the shared search collection', async () => {
  await mount(true, { mode: 'search', query: 'CLOUD', projects: () => null, items: [] })
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(1)
})
it('preserves archive filtering when cloud history has no archive metadata', async () => {
  await mount(true, { archivedOnly: true })
  expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(0)
  expect(container.querySelectorAll('[data-history-kind=work]')).toHaveLength(1)
})

it('switches modes without a transient light zero-sized presentation', async () => {
  const ui = await mount(true)
  window.dshEnterpriseChat.present.mockClear()
  await ui.click('work')
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledTimes(1)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  window.dshEnterpriseChat.present.mockClear()
  await ui.click('chat')
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledTimes(1)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  expect(window.dshEnterpriseChat.open).not.toHaveBeenCalled()
})

it('starts the Work toolbar reveal on tab entry and resets it on return to Chat', async () => {
  const ui = await mount(true)
  const work = container.querySelector('#dsh-panel-work')
  expect(work.dataset.revealControls).toBe('false')

  const chatTab = container.querySelector('#dsh-mode-chat')
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  await act(async () => chatTab.dispatchEvent(key))
  expect(ui.selected()).toBe('work')
  expect(document.activeElement.id).toBe('dsh-mode-work')
  expect(work.dataset.revealControls).toBe('true')

  await ui.click('chat')
  expect(work.dataset.revealControls).toBe('false')
  await ui.click('work')
  expect(work.dataset.revealControls).toBe('true')
  await ui.click('chat')
  expect(work.dataset.revealControls).toBe('false')
})

async function mountLandingMorph({ footer = false, textMotion = false } = {}) {
  const draft = React.createElement('textarea', { defaultValue: footer ? 'retained draft\nsecond line\nthird line' : 'retained draft' })
  const work = React.createElement('div', { 'data-content-phase': 'hero' },
    React.createElement('div', { 'data-landing-fixture-title': '' },
      React.createElement('span', { 'data-slot': 'conversation.hero.brand.mark' }),
      React.createElement('span', null, React.createElement('span', { 'data-slot': 'conversation.hero.brand.title' }, 'Welcome'))),
    React.createElement('div', { 'data-dsh-hero-controls': '' }, 'Workspace controls'),
    React.createElement('div', { 'data-composer-card': '', style: footer ? { rowGap: '12px' } : undefined },
      footer || textMotion ? React.createElement('div', {
        'data-input-scroll': textMotion ? '' : undefined, style: { height: '118px' }
      }, draft) : draft,
      footer && React.createElement('div', { 'data-landing-fixture-footer': '' },
        React.createElement('div', null,
          React.createElement('button', { 'aria-haspopup': 'listbox' }, '+'),
          React.createElement('span', { 'data-slot': 'conversation.input.permission' }, React.createElement('button', null, 'Work permission'))),
        React.createElement('div', null,
          React.createElement('span', { 'data-slot': 'conversation.input.model' },
            React.createElement('button', { 'aria-haspopup': 'menu' }, React.createElement('span', null, 'Work model'), React.createElement('svg'))),
          React.createElement('button', { 'aria-label': 'Send', style: { opacity: 1 } }, 'Send')))))
  const ui = await mount(true, {}, false, undefined, undefined, work)
  const workPanel = container.querySelector('#dsh-panel-work')
  const chatPanel = container.querySelector('#dsh-panel-chat')
  const seat = new DOMRect(240, 56, 800, 640)
  workPanel.getBoundingClientRect = chatPanel.getBoundingClientRect = () => seat
  const elements = {
    card: workPanel.querySelector('[data-composer-card]'),
    title: workPanel.querySelector('[data-landing-fixture-title]'),
    controls: workPanel.querySelector('[data-dsh-hero-controls]')
  }
  const rects = {
    card: new DOMRect(340, 310, 600, 172),
    title: new DOMRect(530, 220, 220, 32),
    controls: new DOMRect(340, 270, 600, 32)
  }
  const motions = []
  const recordMotion = (name, frames) => {
    const { promise: finished, resolve, reject } = Promise.withResolvers()
    const cancel = vi.fn(() => reject(new DOMException('Animation cancelled', 'AbortError')))
    const pause = vi.fn(), play = vi.fn()
    motions.push({ name, frames, resolve, cancel, pause, play })
    return { finished, cancel, pause, play }
  }
  for (const [name, element] of Object.entries(elements)) {
    element.getBoundingClientRect = () => rects[name]
    element.animate = frames => recordMotion(name, frames)
  }
  if (textMotion) {
    elements.writing = elements.card.querySelector('[data-input-scroll]')
    elements.writing.animate = frames => recordMotion('writing', frames)
  }
  if (footer) {
    elements.footer = elements.card.lastElementChild
    elements.add = elements.footer.querySelector('button[aria-haspopup="listbox"]')
    elements.model = elements.footer.querySelector('button[aria-haspopup="menu"]')
    elements.workModelLabel = elements.model.firstElementChild
    elements.workOnly = elements.footer.querySelector('[data-slot="conversation.input.permission"] > button')
    elements.send = elements.footer.querySelector('[aria-label="Send"]')
    elements.footer.getBoundingClientRect = () => new DOMRect(340, 440, 600, 42)
    elements.model.getBoundingClientRect = () => new DOMRect(750, 445, 110, 28)
    for (const name of ['add', 'send', 'workOnly', 'model', 'workModelLabel']) {
      elements[name].animate = frames => recordMotion(name, frames)
    }
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value(frames) {
        if (this.hasAttribute('data-dsh-landing-morph-model-label')) return recordMotion('chatModelLabel', frames)
        return animate?.value?.call(this, frames)
      }
    })
    disposers.push(() => {
      if (animate) Object.defineProperty(Element.prototype, 'animate', animate)
      else delete Element.prototype.animate
    })
  }
  const bridge = window.dshEnterpriseChat
  bridge.landingGeometry = vi.fn(async () => ({
    seat: { x: 240, y: 56, width: 800, height: 640 },
    composer: { x: 345, y: 326, width: 590, height: 108 },
    title: { x: 534, y: 248, width: 216, height: 30 },
    ...(footer ? { model: { label: 'Chat model', width: 84 }, sendOpacity: 0.4 } : {})
  }))
  await ui.cloudLanding(true)
  return { ui, bridge, workPanel, chatPanel, elements, motions }
}

it('keeps the hidden Work landing laid out and paints frame zero before hiding Chat', async () => {
  const { ui, bridge, workPanel, chatPanel, motions } = await mountLandingMorph({ footer: true })
  const draft = ui.draft()
  expect(workPanel.parentElement).toBe(chatPanel.parentElement)
  expect(workPanel.hidden).toBe(true)
  expect(workPanel.hasAttribute('inert')).toBe(true)
  expect(getComputedStyle(workPanel).display).toBe('grid')
  expect(getComputedStyle(workPanel).visibility).toBe('hidden')

  const frames = []
  vi.stubGlobal('requestAnimationFrame', callback => frames.push(callback))
  const hide = Promise.withResolvers()
  bridge.present.mockClear().mockImplementation(({ visible }) => visible ? Promise.resolve() : hide.promise)
  await ui.click('work')
  expect(motions.length).toBeGreaterThan(0)
  expect(motions.every(motion => motion.pause.mock.calls.length === 1 && !motion.play.mock.calls.length)).toBe(true)
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => frames.shift()(0))
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => frames.shift()(16))
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  expect(motions.every(motion => !motion.play.mock.calls.length)).toBe(true)
  await act(async () => hide.resolve())
  expect(motions.every(motion => motion.play.mock.calls.length === 1)).toBe(true)
  await act(async () => motions.forEach(motion => motion.resolve()))
  expect(workPanel.hasAttribute('inert')).toBe(false)
  expect(ui.draft()).toBe(draft)
  expect(draft.value).toContain('third line')
})

it('paints the Work landing before hiding Chat even when the composer cannot morph', async () => {
  const { ui, bridge, elements, workPanel, motions } = await mountLandingMorph()
  elements.card.getBoundingClientRect = () => new DOMRect(340, 0, 600, 172)
  const frames = []
  vi.stubGlobal('requestAnimationFrame', callback => frames.push(callback))
  bridge.present.mockClear()

  await ui.click('work')
  expect(motions).toHaveLength(0)
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => frames.shift()(0))
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => frames.shift()(16))
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  expect(workPanel.hasAttribute('inert')).toBe(false)
})

it('fades the current editor text before the native handoff and introduces the destination text after it starts', async () => {
  const { ui, bridge, chatPanel, elements, motions } = await mountLandingMorph({ textMotion: true })
  const draft = ui.draft()
  const fadeOut = Promise.withResolvers(), prepareIn = Promise.withResolvers()
  bridge.landingTextMotion = vi.fn(phase => phase === 'out' ? fadeOut.promise : prepareIn.promise)
  bridge.present.mockClear()
  await ui.click('work')
  expect(bridge.landingTextMotion).toHaveBeenLastCalledWith('out')
  expect(chatPanel.hidden).toBe(false)
  expect(bridge.present).not.toHaveBeenCalledWith(expect.objectContaining({ visible: false }))
  expect(motions).toHaveLength(0)

  await act(async () => fadeOut.resolve())
  const entering = motions.find(motion => motion.name === 'writing')
  expect(entering.frames[0]).toEqual({ opacity: 0 })
  expect(entering.frames[1]).toMatchObject({ opacity: 0, offset: expect.any(Number) })
  expect(entering.frames.at(-1)).toEqual({ opacity: 1 })
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  const boundary = motions.length
  await act(async () => motions.forEach(motion => motion.resolve()))
  expect(elements.writing.contains(draft)).toBe(true)

  bridge.present.mockClear()
  await ui.click('chat')
  const leaving = motions.slice(boundary).find(motion => motion.name === 'writing')
  expect(leaving.frames[0]).toMatchObject({ opacity: 1 })
  expect(leaving.frames.at(-1)).toEqual({ opacity: 0 })
  await act(async () => motions.slice(boundary).forEach(motion => motion.resolve()))
  expect(bridge.landingTextMotion.mock.calls).toEqual([['out'], ['in']])
  expect(bridge.present).not.toHaveBeenCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => prepareIn.resolve())
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  expect(chatPanel.hidden).toBe(false)
  expect(ui.draft()).toBe(draft)
  expect(draft.value).toBe('retained draft')
})

it('morphs the same Work card and title in both directions while revealing and collapsing its toolbar', async () => {
  const { ui, bridge, workPanel, chatPanel, elements, motions } = await mountLandingMorph()
  const draft = ui.draft()
  const placeholder = () => workPanel.querySelector('[data-dsh-landing-morph-placeholder]')
  bridge.present.mockClear()
  await ui.click('work')

  expect(motions.map(motion => motion.name)).toEqual(['card', 'title', 'controls'])
  expect(motions[0].frames).toEqual([
    { left: '345px', top: '326px', width: '590px', height: '108px' },
    { left: '340px', top: '310px', width: '600px', height: '172px' }
  ])
  expect(motions[1].frames).toEqual([{ translate: '2px 27px' }, { translate: '0px 0px' }])
  expect(motions[2].frames).toEqual([
    { translate: '5px 56px', clipPath: 'inset(0px -8px 100%)', opacity: 0 },
    { translate: '0px 0px', clipPath: 'inset(0px -8px 0px)', opacity: 1 }
  ])
  expect(placeholder()).not.toBeNull()
  expect(elements.card.hasAttribute('data-dsh-landing-morph-card')).toBe(true)
  expect(workPanel.hasAttribute('inert')).toBe(true)
  expect(chatPanel.hidden).toBe(true)
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => motions.slice(0, 3).forEach(motion => motion.resolve()))
  expect(placeholder()).toBeNull()
  expect(workPanel.hasAttribute('inert')).toBe(false)
  expect(ui.draft()).toBe(draft)

  const reveal = Promise.withResolvers()
  bridge.present.mockClear().mockImplementation(value => value.visible ? reveal.promise : Promise.resolve())
  await ui.click('chat')
  expect(motions.slice(3).map(motion => motion.frames)).toEqual(motions.slice(0, 3).map(motion => [...motion.frames].reverse()))
  expect(bridge.present.mock.calls.map(([value]) => value.visible)).toEqual([false])
  expect(workPanel.hidden).toBe(false)
  expect(chatPanel.hidden).toBe(true)
  await act(async () => motions.slice(3).forEach(motion => motion.resolve()))
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, landingHandoff: true }))
  expect(placeholder()).not.toBeNull()
  expect(workPanel.hidden).toBe(false)
  await act(async () => reveal.resolve())
  expect(placeholder()).toBeNull()
  expect(elements.card.hasAttribute('data-dsh-landing-morph-card')).toBe(false)
  expect(workPanel.hidden).toBe(true)
  expect(chatPanel.hidden).toBe(false)
  expect(ui.draft()).toBe(draft)
  expect(draft.value).toBe('retained draft')
})

it('pins the same composer footer during height changes and transitions the model label and send state both ways', async () => {
  const { ui, elements, motions } = await mountLandingMorph({ footer: true })
  const { card, footer, add, send, model, workModelLabel, workOnly } = elements
  const draft = ui.draft()
  const chatLabel = () => model.querySelector('[data-dsh-landing-morph-model-label]')
  const checkFooter = () => {
    expect(card.lastElementChild).toBe(footer)
    expect(footer.hasAttribute('data-dsh-landing-morph-footer')).toBe(true)
    expect(getComputedStyle(footer).position).toBe('absolute')
    expect(getComputedStyle(footer).insetBlockEnd).toMatch(/^0(px)?$/)
    expect(card.style.getPropertyValue('--dsh-morph-footer-clearance')).toBe('54px')
    expect(footer.contains(add) && footer.contains(send) && footer.contains(model)).toBe(true)
    expect(chatLabel().textContent).toBe('Chat model')
    expect(chatLabel().getAttribute('aria-hidden')).toBe('true')
    expect(workModelLabel.textContent).toBe('Work model')
  }
  const checkCleanup = () => {
    expect(card.lastElementChild).toBe(footer)
    expect(footer.hasAttribute('data-dsh-landing-morph-footer')).toBe(false)
    expect(card.style.getPropertyValue('--dsh-morph-footer-clearance')).toBe('')
    expect(footer.contains(add) && footer.contains(send) && footer.contains(model) && footer.contains(workOnly)).toBe(true)
    expect(chatLabel()).toBeNull()
    expect(model.firstElementChild).toBe(workModelLabel)
    expect(ui.draft()).toBe(draft)
    expect(draft.value).toBe('retained draft\nsecond line\nthird line')
  }
  await ui.click('work')
  checkFooter()
  const frames = Object.fromEntries(motions.map(motion => [motion.name, motion.frames]))
  expect(frames.add).toBeUndefined()
  expect(frames.send).toEqual([{ opacity: 0.4 }, { opacity: '1' }])
  expect(frames.model).toEqual([{ width: '84px' }, { width: '110px' }])
  expect(frames.workModelLabel).toEqual([{ opacity: 0 }, { opacity: 1 }])
  expect(frames.chatModelLabel).toEqual([{ opacity: 1 }, { opacity: 0 }])
  expect(frames.workOnly).toEqual([{ opacity: 0 }, { opacity: 1 }])
  const first = motions.length
  await act(async () => motions.forEach(motion => motion.resolve()))
  checkCleanup()

  await ui.click('chat')
  checkFooter()
  for (const { name, frames: reverse } of motions.slice(first)) {
    expect(reverse).toEqual([...frames[name]].reverse())
  }
  await act(async () => motions.slice(first).forEach(motion => motion.resolve()))
  checkCleanup()
})

it('skips geometry and animations when the user prefers reduced motion', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const { ui, bridge, chatPanel, motions } = await mountLandingMorph()
  await ui.click('work')
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await ui.click('chat')
  expect(chatPanel.hidden).toBe(false)
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  expect(bridge.landingGeometry).not.toHaveBeenCalled()
  expect(motions).toHaveLength(0)
})

it('discards a stale measurement and cleans up an animation when the user switches back', async () => {
  const { ui, bridge, workPanel, chatPanel, elements, motions } = await mountLandingMorph()
  const pending = Promise.withResolvers()
  const geometry = await bridge.landingGeometry()
  bridge.landingGeometry.mockReturnValueOnce(pending.promise)
  await ui.click('work')
  await ui.click('chat')
  await act(async () => pending.resolve(geometry))
  expect(chatPanel.hidden).toBe(false)
  expect(motions).toHaveLength(0)

  await ui.click('work')
  expect(motions).toHaveLength(3)
  await ui.click('chat')
  expect(motions.every(motion => motion.cancel.mock.calls.length === 1)).toBe(true)
  expect(workPanel.querySelector('[data-dsh-landing-morph-placeholder]')).toBeNull()
  expect(elements.card.hasAttribute('data-dsh-landing-morph-card')).toBe(false)
  expect(chatPanel.hidden).toBe(false)
  expect(bridge.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('shows the picker only on the Work landing page and releases the header space on panels and active sessions', async () => {
  const ui = await mount()
  expect(ui.picker()).not.toBeNull()
  await ui.panel('plugins')
  expect(ui.picker()).toBeNull()
  expect(container.querySelector('.dshModesHeader')).toBeNull()
  await ui.panel(null)
  expect(ui.picker()).not.toBeNull()
  await ui.workSession(false)
  expect(ui.picker()).toBeNull()
  await ui.workSession(true)
  expect(ui.picker()).not.toBeNull()
})

it('hides the picker after cloud submission or history navigation and restores it for New Session', async () => {
  const ui = await mount(true)
  expect(ui.picker()).not.toBeNull()
  await ui.cloudSession('cloud-created')
  expect(ui.picker()).toBeNull()
  await act(async () => ui.navigate('new'))
  expect(ui.picker()).not.toBeNull()
  await act(async () => container.querySelector('.dshHistoryRow').click())
  expect(ui.picker()).toBeNull()
})

it('chooses a new Work session when the previously selected local session is active', async () => {
  const ui = await mount(true)
  await ui.workSession(false)
  await ui.click('work')
  expect(ui.selected()).toBe('work')
  expect(ui.picker()).not.toBeNull()
})

it('hides Work mode selection on the local submission echo before catalog admission and restores after rejected send', async () => {
  const ui = await mount()
  expect(ui.picker()).not.toBeNull()
  await ui.workLive({ pendingSubmissions: [{ requestId: 'pending' }] })
  expect(ui.picker()).toBeNull()
  await ui.workLive({ pendingSubmissions: [], blank: false, awaitingFirstTurn: true })
  expect(ui.picker()).toBeNull()
  await ui.workLive({ blank: true, awaitingFirstTurn: false })
  expect(ui.picker()).not.toBeNull()
  await ui.workSession(false)
  expect(ui.liveListenerCount()).toBe(0)
})

it('hides Chat mode selection on pushed local state while the URL is still new', async () => {
  const ui = await mount(true)
  expect(ui.picker()).not.toBeNull()
  await ui.cloudLanding(false)
  expect(ui.picker()).toBeNull()
  await ui.cloudLanding(true)
  expect(ui.picker()).not.toBeNull()
})

it('shares account navigation across Chat and Work and keeps Plugins directly accessible alongside More', async () => {
  const ui = await mount(true)
  await ui.navigation([
    { id: 'knowledge', label: 'Knowledge', path: '/knowledge', primary: true, active: false },
    { id: 'skills', label: 'Skills', path: '/skills', primary: false, active: true }
  ])
  expect(ui.picker()).toBeNull()
  const sidebar = container.querySelector('aside')
  expect(sidebar.textContent).not.toContain('Welcome')
  expect(sidebar.querySelector('[data-navigation-id=knowledge]')).toBeNull()
  const openMore = () => act(async () => sidebar.querySelector('[data-navigation-id=more]').click())
  const choose = label => act(async () => [...sidebar.querySelectorAll('[role=menuitem]')].find(node => node.textContent === label).click())
  await openMore()
  expect([...sidebar.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(['Knowledge', 'Skills'])
  await choose('Knowledge')
  expect(window.dshEnterpriseChat.openPage).toHaveBeenLastCalledWith('knowledge')
  await act(async () => sidebar.querySelector('[data-navigation-id=plugins]').click())
  expect(sidebar.querySelector('[data-navigation-id=plugins]').getAttribute('aria-current')).toBe('page')
  expect(sidebar.querySelector('[data-navigation-id=more]').getAttribute('aria-current')).toBeNull()
  expect(ui.selected()).toBe('work')
  expect(ui.picker()).toBeNull()
  await openMore()
  await choose('Skills')
  expect(window.dshEnterpriseChat.openPage).toHaveBeenLastCalledWith('skills')
  expect(ui.selected()).toBe('chat')
  await ui.account(false)
  expect(sidebar.querySelector('[data-navigation-id=plugins]')).not.toBeNull()
  expect(sidebar.querySelector('[data-navigation-id=more]')).toBeNull()
})

it('starts a new conversation without forwarding the click event as a workspace identity', async () => {
  const ui = await mount(true)
  await ui.cloudSession('existing')
  await act(async () => container.querySelector('[data-navigation-id=new]').click())
  expect(ui.picker()).not.toBeNull()
})


it('reserves the native opener after collapse on an active Chat and restores full bounds on expansion', async () => {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-shell-leading')) return { left: 80, right: 156, bottom: 48 }
    return { x: 0, y: 0, right: 960, width: 960, height: 748 }
  }
  try {
    const ui = await mount(true)
    await ui.cloudSession('existing')
    expect(ui.picker()).toBeNull()
    const present = window.dshEnterpriseChat.present
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 0, width: 960, height: 748 } }))
    const leading = document.createElement('div')
    leading.dataset.shellLeading = 'true'
    const opener = document.createElement('button')
    opener.textContent = 'Open sidebar'
    opener.onclick = () => leading.remove()
    leading.append(opener)
    await act(async () => container.append(leading))
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 156, y: 0, width: 804, height: 748 } }))
    // The retained host chrome invokes the original action; no duplicate controls.
    await act(async () => opener.click())
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 0, width: 960, height: 748 } }))
    await act(async () => root.unmount())
    root = undefined
    const calls = present.mock.calls.length
    await act(async () => container.append(leading))
    expect(present).toHaveBeenCalledTimes(calls)
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original
  }
})

it('keeps the chat view full height when an update card is on screen', async () => {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === 'dsh-desktop-update-root') return { x: 560, y: 600, left: 560, right: 940, top: 600, bottom: 740, width: 380, height: 140 }
    return { x: 0, y: 0, left: 0, right: 960, top: 0, bottom: 748, width: 960, height: 748 }
  }
  try {
    await mount(true)
    const present = window.dshEnterpriseChat.present
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 0, width: 960, height: 748 } }))
    const calls = present.mock.calls.length
    const card = document.createElement('div')
    card.id = 'dsh-desktop-update-root'
    card.style.display = 'block'
    await act(async () => {
      document.body.append(card)
      document.documentElement.setAttribute('data-dsh-update-card', '160')
    })
    expect(present).toHaveBeenCalledTimes(calls)
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 0, width: 960, height: 748 } }))
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original
  }
})

it('keeps the native sidebar visible when the embedded pane spans the frame', async () => {
  const sidebar = document.createElement('div')
  sidebar.dataset.dshSidebarRoot = ''
  sidebar.getBoundingClientRect = () => ({ right: 56 })
  document.body.append(sidebar)
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 48, right: 960, width: 960, height: 700 } }
  try {
    await mount(true)
    expect(window.dshEnterpriseChat.present).toHaveBeenCalledWith(expect.objectContaining({ bounds: { x: 56, y: 48, width: 904, height: 700 } }))
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original
    sidebar.remove()
  }
})

it('keeps the tinted Square below the macOS title bar across sidebar toggles', async () => {
  let collapsed = true
  document.documentElement.dataset.platform = 'darwin'
  const tokens = document.createElement('style')
  tokens.textContent = `:root {
    --dsw-alias-bg-base: rgb(255,255,255);
    --dsw-alias-bg-layer-2: rgb(255,255,255); --dsw-alias-bg-layer-3: rgb(238,238,238);
    --dsw-alias-bg-overlay: rgb(225,225,225); --dsw-alias-label-primary: rgb(15,15,15);
    --dsw-alias-label-secondary: rgb(70,70,70); --dsw-alias-label-tertiary: rgb(100,100,100);
    --dsw-alias-border-l2: rgb(200,200,200); --dsw-alias-border-l3: rgb(210,210,210);
    --dsw-specific-input-major: rgb(244,244,244); --dsw-alias-link: rgb(55,115,235);
  } body[data-ds-dark-theme] { --dsw-alias-bg-base: rgb(20,20,22); --dsw-alias-bg-layer-2: rgb(44,44,46); }`
  document.head.append(tokens)
  const getStyle = window.getComputedStyle
  vi.stubGlobal('getComputedStyle', element => {
    const computed = getStyle(element)
    // jsdom leaves var() unresolved in color even though it inherits the token values.
    const token = computed.color.match(/^var\((--dsw-[\w-]+),/u)?.[1]
    return token ? { color: computed.getPropertyValue(token) } : computed
  })
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-shell-leading')) return { left: 80, right: 156, bottom: 47.5 }
    if (this.hasAttribute('data-dsh-sidebar-root')) return { right: collapsed ? 20 : 280 }
    const x = !collapsed && this.id === 'dsh-panel-chat' ? 280 : 0
    return { x, y: 0, right: 960, bottom: 748, width: 960 - x, height: 748 }
  }
  try {
    const ui = await mount(true)
    const leading = document.createElement('div')
    leading.dataset.shellLeading = ''
    const sidebar = document.createElement('aside')
    sidebar.dataset.dshSidebarRoot = ''
    await act(async () => container.append(sidebar, leading))
    const present = window.dshEnterpriseChat.present
    for (const path of ['/knowledge', '/channel', '/apps', '/capabilities']) {
      await ui.pushState({ path, conversationId: undefined })
      expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 48, width: 960, height: 700 } }))
    }

    collapsed = false
    await act(async () => { leading.remove(); container.setAttribute('data-sidebar-collapsed', 'false') })
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 280, y: 0, width: 680, height: 748 } }))
    await ui.pushState({ path: '/square', conversationId: undefined })
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 280, y: 48, width: 680, height: 700 } }))
    const chromeStyle = container.querySelector('#dsh-panel-chat').style
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-height')).toBe('48px')
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-fill')).toBe('rgb(245 248 254)')

    collapsed = true
    await act(async () => container.append(leading))
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 0, y: 48, width: 960, height: 700 } }))
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-height')).toBe('48px')
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-fill')).toBe('rgb(245 248 254)')
    expect(present.mock.lastCall[0].palette.squareBanner).toEqual([245, 248, 254])
    await act(async () => document.body.setAttribute('data-ds-dark-theme', ''))
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-fill')).toBe('rgb(22 25 33)')
    expect(present.mock.lastCall[0].palette.squareBanner).toEqual([22, 25, 33])

    collapsed = false
    await act(async () => leading.remove())
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 280, y: 48, width: 680, height: 700 } }))
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-height')).toBe('48px')
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-fill')).toBe('rgb(22 25 33)')

    collapsed = true
    await act(async () => container.append(leading))
    await ui.pushState({ path: '/c/existing', conversationId: 'existing' })
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ bounds: { x: 156, y: 0, width: 804, height: 748 } }))
    expect(chromeStyle.getPropertyValue('--dsh-square-chrome-fill')).toBe('')
  } finally {
    delete document.documentElement.dataset.platform
    HTMLElement.prototype.getBoundingClientRect = original
    tokens.remove()
  }
})


async function mountOnboarding({ acknowledged = false, save = async () => ({ ok: true, json: async () => ({ acknowledged: true }) }) } = {}) {
  let notice
  window.__ModuleLoader__ = { load({ factory }) {
    const plugin = factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        Button: ({ children, variant, ...props }) => React.createElement('button', props, children),
        IconGlobeOutlineRegular: () => null,
        Modal: ({ children, title }) => createPortal(React.createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': title }, children), document.body)
      }
      throw new Error(name)
    })
    const scope = {
      locale: { register() {}, bind: () => key => key },
      configForms: { get: () => ({ getSnapshot: () => ({ mode: 'memory', value: { eligible: true, wizardVersion: acknowledged ? '1' : '' } }), subscribe: () => () => {} }) },
      slots: { inject: (_name, fn) => fn(), register: (options, component) => { notice = { component, props: options.inject() } } }
    }
    plugin.apply({ inject: (_deps, fn) => fn(scope) })
  } }
  vi.stubGlobal('fetch', vi.fn(save))
  new Function(await readFile('packages/dsh-desktop-onboarding/client.js', 'utf8'))()
  const host = document.createElement('div')
  document.body.append(host)
  const noticeRoot = createRoot(host)
  const complete = vi.fn(() => noticeRoot.render(null))
  const openSection = vi.fn(() => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: true } })))
  await act(async () => noticeRoot.render(React.createElement(notice.component, { ...notice.props, complete, openSection })))
  return {
    complete, openSection,
    async click(label) { await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === label).click()) },
    async dispose() { await act(async () => noticeRoot.unmount()); host.remove() }
  }
}

it('keeps native Chat behind the initial host modal boundary and follows its release', async () => {
  const ui = await mount(true, {}, true)
  const present = window.dshEnterpriseChat.present
  expect(present.mock.calls.every(([value]) => value.visible === false)).toBe(true)
  await ui.locale('zh')
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, locale: 'zh' }))
  await act(async () => { container.inert = false })
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => root.unmount())
  root = undefined
  present.mockClear()
  await act(async () => { container.inert = true })
  expect(present).toHaveBeenCalledTimes(0)
})

it('yields native Chat to onboarding and restores the same chat and Work draft after acknowledgment', async () => {
  const ui = await mount(true)
  const draft = ui.draft()
  const notice = await mountOnboarding()
  try {
    expect(container.inert).toBe(true)
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
    await notice.click('later')
    expect(fetch).toHaveBeenCalledWith('/api/desktop-onboarding/acknowledge', expect.objectContaining({ method: 'POST' }))
    expect(notice.complete).toHaveBeenCalledTimes(1)
    expect(container.inert).toBe(false)
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
    expect(ui.selected()).toBe('chat')
    expect(ui.draft()).toBe(draft)
  } finally { await notice.dispose() }
})

it('hands onboarding directly to model settings while native Chat stays hidden', async () => {
  await mount(true)
  const notice = await mountOnboarding()
  try {
    const present = window.dshEnterpriseChat.present
    present.mockClear()
    await notice.click('configureModel')
    expect(notice.openSection).toHaveBeenCalledWith('models')
    expect(container.inert).toBe(false)
    expect(present.mock.calls.length).toBeGreaterThan(0)
    expect(present.mock.calls.every(([value]) => value.visible === false)).toBe(true)
    await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: false } })))
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  } finally { await notice.dispose() }
})

it('keeps onboarding in front through acknowledgment failure and releases its boundary on unmount', async () => {
  await mount(true)
  const notice = await mountOnboarding({ save: async () => ({ ok: false }) })
  try {
    await notice.click('later')
    expect(document.querySelector('[role=alert]').textContent).toBe('saveFailed')
    expect(notice.complete).toHaveBeenCalledTimes(0)
    expect(container.inert).toBe(true)
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  } finally { await notice.dispose() }
  expect(container.inert).toBe(false)
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('lets returning users continue in Chat when onboarding is already acknowledged', async () => {
  await mount(true)
  const notice = await mountOnboarding({ acknowledged: true })
  try {
    expect(notice.complete).toHaveBeenCalledTimes(1)
    expect(container.inert).toBe(false)
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  } finally { await notice.dispose() }
})


it.each(['continueWork', 'close'])('returns to the existing Work draft when the sign-in prompt is dismissed with %s', async action => {
  const ui = await mount()
  const draft = ui.draft()
  await ui.click('chat')
  await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === action).click())
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(ui.selected()).toBe('work')
  expect(ui.draft()).toBe(draft)
  await ui.click('chat')
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
})

it('dismisses the sign-in prompt and enters Chat when the account becomes available', async () => {
  const ui = await mount()
  await ui.click('chat')
  expect(document.querySelector('[role=dialog]')).toBeTruthy()
  await ui.account(true)
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(ui.selected()).toBe('chat')
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it.each([false, true])('gives the recovery page the pane, including restored state=%s', async (alreadyOpen) => {
  document.documentElement.toggleAttribute('data-dsh-safe-mode-page', alreadyOpen)
  const ui = await mount(true)
  const present = window.dshEnterpriseChat.present
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: !alreadyOpen }))
  await act(async () => document.documentElement.setAttribute('data-dsh-safe-mode-page', ''))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  const draft = ui.draft()
  await ui.locale('zh')
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    document.body.toggleAttribute('data-ds-dark-theme', true)
  })
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, locale: 'zh', theme: 'dark' }))
  // Remote settings are a foreground surface above the recovery iframe.
  await act(async () => {
    window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: true } }))
    window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { section: 'tools', bounds: { x: 200, y: 80, width: 500, height: 400 } } }))
  })
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, settings: 'tools' }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: false } })))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => document.documentElement.removeAttribute('data-dsh-safe-mode-page'))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  expect(ui.draft()).toBe(draft)
  await act(async () => document.documentElement.setAttribute('data-dsh-safe-mode-page', ''))
  await ui.click('work')
  await act(async () => document.documentElement.removeAttribute('data-dsh-safe-mode-page'))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => root.unmount())
  root = undefined
  present.mockClear()
  await act(async () => document.documentElement.setAttribute('data-dsh-safe-mode-page', ''))
  expect(present).toHaveBeenCalledTimes(0)
})

it.each([false, true])('gives About the foreground including initial state=%s', async initial => {
  document.documentElement.toggleAttribute('data-dsh-about-open', initial)
  const ui = await mount(true)
  const present = window.dshEnterpriseChat.present
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: !initial }))
  await act(async () => document.documentElement.setAttribute('data-dsh-about-open', ''))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await ui.locale('zh')
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    document.body.setAttribute('data-ds-dark-theme', '')
    window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: true } }))
    window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { section: 'tools', bounds: { x: 200, y: 80, width: 500, height: 400 } } }))
  })
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, settings: 'tools', locale: 'zh', theme: 'dark' }))
  await act(async () => document.documentElement.removeAttribute('data-dsh-about-open'))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, settings: 'tools' }))
  await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-visibility', { detail: { open: false } })))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => document.documentElement.setAttribute('data-dsh-about-open', ''))
  await ui.click('work')
  await act(async () => document.documentElement.removeAttribute('data-dsh-about-open'))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => { container.inert = true; document.documentElement.setAttribute('data-dsh-about-open', '') })
  await ui.click('chat')
  await act(async () => document.documentElement.removeAttribute('data-dsh-about-open'))
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => { container.inert = false })
  expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => root.unmount())
  root = undefined
  present.mockClear()
  await act(async () => document.documentElement.setAttribute('data-dsh-about-open', ''))
  expect(present).toHaveBeenCalledTimes(0)
})

function hostDialog(markup = '<div role="dialog" aria-modal="true"><button>Cancel</button></div>') {
  const portal = document.createElement('section')
  portal.dataset.hostDialogFixture = 'true'
  portal.innerHTML = markup
  document.body.append(portal)
  return portal
}

it('yields native Chat to an existing host dialog and restores the same conversation after dismissal', async () => {
  const dialog = hostDialog()
  const view = await mount(true)
  await view.click('chat')
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => dialog.remove())
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  expect(container.querySelector('[aria-label="work draft"]').value).toBe('retained draft')
})

it('keeps native Chat behind nested host confirmations until their final removal', async () => {
  const view = await mount(true)
  await view.click('chat')
  let first, second
  await act(async () => { first = hostDialog() })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => { second = hostDialog('<div role="alertdialog" aria-modal="true">Confirm</div>'); first.remove() })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => second.remove())
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('tracks modal visibility and semantics within surviving portal containers', async () => {
  const view = await mount(true)
  await view.click('chat')
  let portal
  await act(async () => { portal = hostDialog('<div role="dialog" aria-modal="true" hidden>Confirm</div><div role="menu">Menu</div><div role="dialog" aria-modal="false">Popover</div>') })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => { portal.firstElementChild.hidden = false })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => { portal.firstElementChild.style.visibility = 'hidden' })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  await act(async () => { portal.firstElementChild.style.visibility = '' })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => { portal.firstElementChild.setAttribute('aria-modal', 'false') })
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
})

it('keeps Work selected when its confirmation closes and releases modal observers on unmount', async () => {
  const view = await mount(true)
  await view.click('chat')
  let portal
  await act(async () => { portal = hostDialog() })
  await view.click('work')
  await act(async () => portal.remove())
  expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  await act(async () => root.unmount())
  root = undefined
  window.dshEnterpriseChat.present.mockClear()
  await act(async () => { hostDialog() })
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledTimes(0)
})

it('keeps native presentation stable while conversation content streams inside the app root', async () => {
  const view = await mount(true)
  await view.click('chat')
  window.dshEnterpriseChat.present.mockClear()
  await act(async () => {
    const stream = document.createElement('div')
    container.querySelector('[aria-label="work draft"]').parentElement.append(stream)
    for (let i = 0; i < 100; i++) stream.append(document.createTextNode('token '))
  })
  expect(window.dshEnterpriseChat.present).toHaveBeenCalledTimes(0)
})

it('retains the native backing across geometry subscription changes and clears it on account change', async () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect, originalDecode = HTMLImageElement.prototype.decode
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 280, y: 48, right: 1000, width: 720, height: 700 })
  HTMLImageElement.prototype.decode = async () => {}
  try {
    const ui = await mount(true)
    window.dshEnterpriseChat.capture = vi.fn(async () => ({ dataURL: 'data:image/png;base64,fixture', bounds: { x: 280, y: 48, width: 720, height: 700 } }))
    let menu
    await act(async () => { menu = hostDialog('<div role="menu">Session menu</div>') })
    const backing = document.querySelector('[data-dsh-native-frame]')
    expect(backing).not.toBeNull()
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
    await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:settings-surface', { detail: { section: 'desktop-usage', bounds: { x: 300, y: 80, width: 500, height: 400 } } })))
    expect(document.querySelector('[data-dsh-native-frame]')).toBe(backing)
    expect(window.dshEnterpriseChat.capture).toHaveBeenCalledTimes(1)
    await ui.account(false, 2)
    expect(document.querySelector('[data-dsh-native-frame]')).toBeNull()
    await act(async () => menu.remove())
    expect(window.dshEnterpriseChat.present).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    if (originalDecode) HTMLImageElement.prototype.decode = originalDecode
    else delete HTMLImageElement.prototype.decode
  }
})

function deferredHistory() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const cloudRows = () => [...container.querySelectorAll('[data-history-kind=chat]')]
const cloudRowTitles = () => cloudRows().map(row => row.querySelector('.dshHistoryTitle').textContent)
const historyResult = (items, epoch = 1, hasMore = false) => ({ epoch, items, hasMore })
const historyItem = (id, title = id) => ({ id, title, updatedAt: '2026-10-18' })

it('keeps cached rows and scroll position during same-account refresh, then replaces the list', async () => {
  const ui = await mount(true)
  const row = cloudRows()[0]
  const scroll = container.querySelector('.dshRecentHistory')
  scroll.scrollTop = 48
  const pending = deferredHistory()
  window.dshEnterpriseChat.history.mockReturnValueOnce(pending.promise)
  await ui.account(true)
  expect(cloudRows()[0]).toBe(row)
  expect(scroll.scrollTop).toBe(48)
  expect(scroll.textContent).not.toContain('historyLoading')
  await act(async () => pending.resolve(historyResult([historyItem('cloud-a', 'Renamed chat'), historyItem('cloud-b')])))
  expect(cloudRowTitles()).toEqual(['Renamed chat', 'cloud-b'])
  expect(cloudRows()[0]).toBe(row)
})

it('keeps cached rows on refresh failure and replaces them with a successful empty response', async () => {
  const ui = await mount(true)
  const row = cloudRows()[0]
  window.dshEnterpriseChat.history.mockRejectedValueOnce(new Error('offline'))
  await ui.account(true)
  expect(cloudRows()[0]).toBe(row)
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'historyError')
  expect(retry).toBeDefined()
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([]))
  await act(async () => retry.click())
  expect(cloudRows()).toHaveLength(0)
  expect(container.querySelector('[data-local-row]')).not.toBeNull()
})

it('keeps the last list while an account-state read fails', async () => {
  const ui = await mount(true)
  const row = cloudRows()[0]
  window.dshEnterpriseChat.state.mockRejectedValueOnce(new Error('state unavailable'))
  await ui.account(true)
  expect(cloudRows()[0]).toBe(row)
})

it('coalesces repeated account refresh notifications while history is pending', async () => {
  const ui = await mount(true)
  const pending = deferredHistory()
  window.dshEnterpriseChat.history.mockClear().mockReturnValue(pending.promise)
  await ui.account(true)
  await ui.account(true)
  await ui.account(true)
  expect(window.dshEnterpriseChat.history).toHaveBeenCalledTimes(1)
  expect(cloudRows()).toHaveLength(1)
  await act(async () => pending.resolve(historyResult([historyItem('fresh')])))
  expect(cloudRowTitles()).toEqual(['fresh'])
})

it.each(['poll', 'push'])('clears account-owned history on %s identity changes and rejects old responses', async source => {
  const ui = await mount(true)
  const oldRequest = deferredHistory(), newRequest = deferredHistory()
  window.dshEnterpriseChat.history.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
  await ui.account(true)
  if (source === 'poll') await ui.account(true, 2)
  else await ui.pushState({ connected: true, epoch: 2 })
  expect(cloudRows()).toHaveLength(0)
  await act(async () => oldRequest.resolve(historyResult([historyItem('old-account')], 1)))
  expect(cloudRows()).toHaveLength(0)
  await act(async () => newRequest.resolve(historyResult([historyItem('new-account')], 2)))
  expect(cloudRowTitles()).toEqual(['new-account'])
})

it('clears cloud rows immediately on pushed logout and keeps local work rows', async () => {
  const ui = await mount(true)
  await ui.pushState({ connected: false, epoch: 2 })
  expect(cloudRows()).toHaveLength(0)
  expect(container.querySelector('[data-local-row]')).not.toBeNull()
})

it('keeps loaded pages visible until the entire refresh has completed', async () => {
  const ui = await mount(true)
  const firstPage = Array.from({ length: 40 }, (_, i) => historyItem(`page-1-${i}`))
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult(firstPage, 1, true))
  await ui.account(true)
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([historyItem('page-2')]))
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'more').click())
  const secondPage = deferredHistory()
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult(firstPage.map(item => ({ ...item, title: 'updated' })), 1, true)).mockReturnValueOnce(secondPage.promise)
  await ui.account(true)
  expect(cloudRows()).toHaveLength(41)
  expect(cloudRows().some(row => row.title === 'updated')).toBe(false)
  await act(async () => secondPage.resolve(historyResult([historyItem('page-2-new')])))
  expect(cloudRows()).toHaveLength(41)
  expect(cloudRowTitles()).toContain('page-2-new')
})

it('keeps a confirmed empty state visible while refreshing an empty history', async () => {
  const ui = await mount(true, { items: [] })
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([]))
  await ui.account(true)
  const history = container.querySelector('.dshRecentHistory')
  expect(history.textContent).toBe('recentrecentEmpty')
  const pending = deferredHistory()
  window.dshEnterpriseChat.history.mockReturnValueOnce(pending.promise)
  await ui.account(true)
  expect(history.textContent).toBe('recentrecentEmpty')
  await act(async () => pending.resolve(historyResult([])))
})

const enterpriseNavigation = {
  entries: [{ id: 'knowledge', label: 'Knowledge', path: '/knowledge', primary: true, active: false }],
  homeLabel: 'Welcome'
}
const readyEnterpriseState = (navigation) => ({ connected: true, phase: 'ready', epoch: 1, conversationId: 'new', settingsProtocolVersion: 1, ...(navigation ? { navigation } : {}) })
async function moreLabels() {
  const sidebar = container.querySelector('aside')
  await act(async () => sidebar.querySelector('[data-navigation-id=more]').click())
  return [...sidebar.querySelectorAll('[role=menuitem]')].map(node => node.textContent)
}
it.each(['rejection', 'empty response'])('restores enterprise navigation after the startup state read gets a %s', async failure => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let attempt = 0
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockImplementation(async () => {
        attempt += 1
        if (attempt === 1) {
          if (failure === 'rejection') throw new Error('state unavailable')
          return undefined
        }
        return readyEnterpriseState(enterpriseNavigation)
      })
    })
    expect(container.querySelector('[data-navigation-id=more]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(249) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(await moreLabels()).toEqual(['Knowledge'])
    const calls = window.dshEnterpriseChat.state.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(calls)
  } finally { vi.useRealTimers() }
})

it('stops startup state retries after the bounded delays', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockRejectedValue(new Error('state unavailable'))
    })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(4)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(4)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(5)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(5)
  } finally { vi.useRealTimers() }
})

it('rereads a connected startup snapshot until navigation arrives or the bounded retries end', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let attempt = 0
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockImplementation(async () => {
        attempt += 1
        return attempt < 3 ? readyEnterpriseState() : readyEnterpriseState(enterpriseNavigation)
      })
    })
    expect(container.querySelector('[data-navigation-id=more]')).toBeNull()
    expect(window.dshEnterpriseChat.history).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(container.querySelector('[data-navigation-id=more]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(await moreLabels()).toEqual(['Knowledge'])
    expect(window.dshEnterpriseChat.history).toHaveBeenCalledTimes(1)
    const calls = window.dshEnterpriseChat.state.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(calls)
    expect(window.dshEnterpriseChat.history).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('uses the remaining startup retries when navigation stays absent and stops after an empty report', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockResolvedValue(readyEnterpriseState())
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(250 + 1000 + 3000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(4)
    expect(window.dshEnterpriseChat.history).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(4)
    await act(async () => root.unmount())
    container.remove()
    root = undefined
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockResolvedValue(readyEnterpriseState({ entries: [] }))
    })
    const calls = window.dshEnterpriseChat.state.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(calls)
  } finally { vi.useRealTimers() }
})

it('keeps pushed navigation when the startup state response is older', async () => {
  let resolveState
  const ui = await mount(true, {}, false, undefined, () => {
    window.dshEnterpriseChat.state.mockReturnValue(new Promise(resolve => { resolveState = resolve }))
  })
  await ui.navigation(enterpriseNavigation.entries)
  await act(async () => resolveState(readyEnterpriseState()))
  expect(await moreLabels()).toEqual(['Knowledge'])
})

it('stops startup state retries when navigation is pushed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const ui = await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockRejectedValue(new Error('state unavailable'))
    })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    await ui.navigation(enterpriseNavigation.entries)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    expect(await moreLabels()).toEqual(['Knowledge'])
  } finally { vi.useRealTimers() }
})

it('cancels startup state retries when the account is reread or navigation unmounts', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const ui = await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockRejectedValueOnce(new Error('state unavailable'))
    })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    await ui.account(true)
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
    container.remove()
    root = undefined
    await mount(true, {}, false, undefined, () => {
      window.dshEnterpriseChat.state.mockRejectedValue(new Error('state unavailable'))
    })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    root = undefined
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(window.dshEnterpriseChat.state).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('refreshes cloud history on push transitions and focus without periodic state polling', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const ui = await mount(true)
    const bridge = window.dshEnterpriseChat
    expect(bridge.history).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(250 + 1000 + 3000) })
    expect(bridge.state).toHaveBeenCalledTimes(4)
    expect(bridge.history).toHaveBeenCalledTimes(1)
    const stateCalls = bridge.state.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(bridge.state).toHaveBeenCalledTimes(stateCalls)
    expect(bridge.history).toHaveBeenCalledTimes(1)
    await ui.chatState({ conversationId: 'another' })
    expect(bridge.history).toHaveBeenCalledTimes(2)
    await ui.chatState({ connected: false })
    expect(container.querySelectorAll('[data-history-kind=chat]')).toHaveLength(0)
    await ui.chatState({ connected: true, epoch: 2 })
    expect(bridge.history).toHaveBeenCalledTimes(3)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(bridge.history).toHaveBeenCalledTimes(4)
  } finally { vi.useRealTimers() }
})


async function projectTitleFixture(items) {
  const ui = await mount(true)
  let id
  await act(async () => {
    ui.projectStore.edit('create')
    await ui.projectStore.confirm('Title sync')
    id = ui.projectStore.snapshot().projects[0].id
  })
  window.dshEnterpriseChat.projectConversations.mockImplementation(async () => ({
    epoch: 1, revision: ui.projectStore.snapshot().revision, nextCursor: null, items
  }))
  await act(async () => {
    for (const item of items) await ui.projectStore.assign(item.id, id)
    await ui.projectStore.load(id)
  })
  return { ui, id, section: () => container.querySelector(`[data-chat-project="${id}"]`) }
}
const projectTitleRow = (id, title, updatedAt) => ({ id, title, updatedAt })

it('project title freshness uses a newer ordinary-history row over a cached project page', async () => {
  const { ui, section } = await projectTitleFixture([
    projectTitleRow('cloud-a', 'New Chat', '2026-11-06T22:09:20')
  ])
  expect(section().textContent).toContain('New Chat')
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([
    projectTitleRow('cloud-a', 'Desktop Sync Issue', '2026-11-06T22:09:43')
  ]))
  await act(async () => ui.controller.refreshHistory())
  expect(section().textContent).toContain('Desktop Sync Issue')
  expect(section().textContent).not.toContain('New Chat')
})

it('project title freshness keeps newer project pages and their equal-timestamp priority', async () => {
  const { ui, section } = await projectTitleFixture([
    projectTitleRow('cloud-a', 'Current project title', '2026-11-06T22:09:43')
  ])
  for (const updatedAt of ['2026-11-06T22:09:20', '2026-11-06T22:09:43']) {
    window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([
      projectTitleRow('cloud-a', 'Older history title', updatedAt)
    ]))
    await act(async () => ui.controller.refreshHistory())
    expect(section().textContent).toContain('Current project title')
    expect(section().textContent).not.toContain('Older history title')
  }
})

it('project title freshness rejects a late older page after ordinary history has updated', async () => {
  const stale = projectTitleRow('cloud-a', 'New Chat', '2026-11-06T22:09:20')
  const { ui, id, section } = await projectTitleFixture([stale])
  const delayed = deferredHistory()
  window.dshEnterpriseChat.projectConversations.mockReturnValueOnce(delayed.promise)
  let loading
  await act(async () => { loading = ui.projectStore.load(id) })
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult([
    projectTitleRow('cloud-a', 'Desktop Sync Issue', '2026-11-06T22:09:43')
  ]))
  await act(async () => ui.controller.refreshHistory())
  await act(async () => {
    delayed.resolve({ epoch: 1, revision: ui.projectStore.snapshot().revision, nextCursor: null, items: [stale] })
    await loading
  })
  expect(section().textContent).toContain('Desktop Sync Issue')
  expect(section().textContent).not.toContain('New Chat')
})

it('project title freshness retains members outside the loaded ordinary-history pages', async () => {
  const { ui, section } = await projectTitleFixture([
    projectTitleRow('older-member', 'Earlier project conversation', '2026-10-01T12:00:00')
  ])
  const current = Array.from({ length: 40 }, (_, i) =>
    projectTitleRow(`recent-${i}`, `Recent conversation ${i}`, '2026-11-06T22:09:43'))
  window.dshEnterpriseChat.history.mockResolvedValueOnce(historyResult(current))
  await act(async () => ui.controller.refreshHistory())
  expect(section().textContent).toContain('Earlier project conversation')
  expect(section().querySelectorAll('[data-history-kind=chat]')).toHaveLength(1)
  expect(container.querySelector('.dshRecentHistory').querySelectorAll('[data-history-kind=chat]')).toHaveLength(40)
})
