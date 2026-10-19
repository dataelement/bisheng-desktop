// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
const disposers = []
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  disposers.splice(0).reverse().forEach(dispose => dispose())
  delete window.dshEnterpriseChat
  delete window.__ModuleLoader__
  vi.unstubAllGlobals()
})
async function mount(connected = false, collection = {}) {
  let snapshot = { connected, phase: 'ready', epoch: 1, conversationId: 'new' }
  let chatListener
  window.dshEnterpriseChat = {
    subscribe: fn => { chatListener = fn; return () => { chatListener = undefined } },
    state: vi.fn(async () => ({ ...snapshot })),
    present: vi.fn(async () => ({ ...snapshot })),
    retry: vi.fn(async () => {}),
    history: vi.fn(async () => ({ epoch: 1, items: [{ id: 'cloud-a', title: 'Cloud chat', updatedAt: '2026-10-16' }], hasMore: false })),
    openPage: vi.fn(async () => {}),
    open: vi.fn(async () => {})
  }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  let plugin, navigate
  let sessionList = { phase: 'ready', byId: { draft: { id: 'draft', blank: true, retainedBy: { mainView: 1 } } } }
  let liveState = { blank: true, pendingSubmissions: [], running: false, awaitingFirstTurn: false }
  const liveListeners = new Set()
  const liveSession = { getSnapshot: () => liveState, subscribe: fn => { liveListeners.add(fn); return () => liveListeners.delete(fn) } }
  let panelState = { activePanelId: null }
  const sessionListeners = new Set(), panelListeners = new Set()
  const setSessions = value => { sessionList = value; sessionListeners.forEach(fn => fn()) }
  const setPanel = id => { panelState = { activePanelId: id }; panelListeners.forEach(fn => fn()) }
  const registrations = new Map()
  window.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Menu: ({ anchor, open, items, onSelect }) => React.createElement('div', null, anchor, open && items.map(item => React.createElement('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label))) }
      throw new Error(name)
    })
  } }
  new Function(await readFile('packages/dsh-desktop-client-ui/client.js', 'utf8'))()
  plugin.apply({
    uiWorkspace: { registerNavigationHandler: (fn) => { navigate = fn; return () => {} }, startSession: () => { navigate('new'); setSessions({ phase: 'ready', byId: { draft: { id: 'draft', blank: true, retainedBy: { mainView: 1 } } } }); setPanel(null) } },
    sessions: { binding: id => id === 'draft' ? { session: liveSession } : undefined, list: { getSnapshot: () => sessionList, subscribe: fn => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) } } },
    layout: { selectPanel: setPanel, panelInfo: { getSnapshot: () => panelState, subscribe: fn => { panelListeners.add(fn); return () => panelListeners.delete(fn) } } },
    remote: {}, locale: { register() {}, bind: () => key => key },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    slots: {
      inject(name, fn) { if (['desktop.mode.content', 'sidebar.workspaces.collection', 'sidebar.primaryNavigation'].includes(name)) fn() },
      register(options, component) { registrations.set(options.name, { component, props: options.inject() }) }
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const content = registrations.get('desktop.mode.content'), history = registrations.get('sidebar.workspaces.collection'), primary = registrations.get('sidebar.primaryNavigation')
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement('aside', null, React.createElement('button', { 'data-navigation-id': 'new', onClick: () => navigate('new') }, 'New session'), React.createElement(primary.component, { ...primary.props, wide: true, renderAction: ({ id, label, onClick, expanded }) => React.createElement('button', { 'data-navigation-id': id, 'aria-expanded': expanded, onClick }, label), panels: [{ id: 'plugins', label: 'Plugins' }], startSession: (...args) => { expect(args).toHaveLength(0); navigate('new') }, selectPanel: setPanel, renderPanelIcon: () => null }), React.createElement(history.component, { ...history.props, mode: 'projects', query: '', archivedOnly: false, projects: () => React.createElement('div', { 'data-project': true }, 'Project task'), items: [{ id: 'local-a', updatedAt: Date.parse('2026-10-17'), render: active => React.createElement('button', { 'data-local-row': true, 'aria-current': active ? 'page' : undefined, onClick: () => navigate('open') }, 'Local task') }], ...collection })),
    React.createElement(content.component, { ...content.props, columns: '1fr 0px', work: React.createElement('textarea', { 'aria-label': 'work draft', defaultValue: 'retained draft' }) })
  )))
  return {
    async navigation(entries, path = '/skills') { snapshot = { ...snapshot, navigation: { entries, homeLabel: 'Welcome' }, path, conversationId: undefined }; await act(async () => chatListener(snapshot)) },
    navigate: (...args) => navigate(...args),
    async click(mode) { await act(async () => container.querySelector(`#dsh-mode-${mode}`).click()) },
    async account(next) {
      snapshot = { connected: next, phase: 'ready', epoch: 1, conversationId: 'new' }
      await act(async () => window.dispatchEvent(new CustomEvent('dsh-desktop:enterprise-account-changed')))
    },
    selected: () => container.querySelector('#dsh-panel-chat').hidden ? 'work' : 'chat',
    picker: () => container.querySelector('[role=tablist]'),
    async panel(id) { await act(async () => setPanel(id)) },
    async workSession(blank) { await act(async () => setSessions({ phase: 'ready', byId: { current: { id: 'current', blank, retainedBy: { mainView: 1 } } } })) },
    async cloudSession(id) { snapshot = { ...snapshot, conversationId: id }; await act(async () => window.dispatchEvent(new Event('focus'))) },
    async workLive(patch) { await act(async () => { liveState = { ...liveState, ...patch }; liveListeners.forEach(fn => fn()) }) },
    liveListenerCount: () => liveListeners.size,
    async cloudLanding(landing) { snapshot = { ...snapshot, landing }; await act(async () => chatListener(snapshot)) },
    draft: () => container.querySelector('textarea')
  }
}
it('routes unauthenticated Chat to the existing enterprise settings while keeping Work mounted', async () => {
  const ui = await mount()
  expect(ui.selected()).toBe('work')
  const draft = ui.draft()
  const open = vi.fn()
  window.addEventListener('dsh-desktop:open-settings-section', open)
  disposers.push(() => window.removeEventListener('dsh-desktop:open-settings-section', open))
  await ui.click('chat')
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

it('shares account navigation across Chat and Work and keeps local panels accessible through More', async () => {
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
  expect([...sidebar.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(['Knowledge', 'Skills', 'Plugins'])
  await choose('Knowledge')
  expect(window.dshEnterpriseChat.openPage).toHaveBeenLastCalledWith('knowledge')
  await openMore()
  await choose('Plugins')
  expect(ui.selected()).toBe('work')
  expect(ui.picker()).toBeNull()
  await openMore()
  await choose('Skills')
  expect(window.dshEnterpriseChat.openPage).toHaveBeenLastCalledWith('skills')
  expect(ui.selected()).toBe('chat')
  await ui.account(false)
  await openMore()
  expect([...sidebar.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(['Plugins'])
})

it('starts a new conversation without forwarding the click event as a workspace identity', async () => {
  const ui = await mount(true)
  await ui.cloudSession('existing')
  await act(async () => container.querySelector('[data-navigation-id=new]').click())
  expect(ui.picker()).not.toBeNull()
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
