// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const sectionSource = source.slice(source.indexOf('function createSidebarSections()'), source.indexOf('function observeHostOverlays('))
const projectSource = source.slice(source.indexOf('function ChatProjects('), source.indexOf('const MODES_NS'))
let root
let host

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  if (root) act(() => root.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
})

function fixture() {
  const stub = () => null
  const context = vm.createContext({ React, window, setTimeout, clearTimeout,
    IconChevronRightOutlineRegular: props => React.createElement('svg', props),
    IconPlusOutlineRegular: stub, ChatProjectDialog: stub,
    ChatProjectRow: ({ project }) => React.createElement('div', null, project.name),
    CloudHistoryRow: ({ item }) => React.createElement('div', null, item.title) })
  vm.runInContext(projectSource, context)
  vm.runInContext(sectionSource, context)
  const sections = context.createSidebarSections()
  const snapshot = { connected: true, mode: 'chat', epoch: 1, nativeWork: true, items: [{ id: 'chat-1', title: 'Loose chat' }], page: 1, historyPhase: 'ready' }
  const projectState = { scope: 'account', epoch: 1, phase: 'ready', connection: 'live', projects: [{ id: 'project-1', name: 'Saved project' }], rows: {}, assignments: {}, search: { phase: 'ready', items: [] } }
  const navigation = { sections, subscribe: () => () => {}, snapshot: () => snapshot,
    projects: { subscribe: () => () => {}, snapshot: () => projectState, search: vi.fn(), edit: vi.fn() } }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const render = (mode = 'projects', query = '') => act(() => root.render(React.createElement(React.Fragment, null,
    React.createElement(context.WorkspaceSectionTitle, { flat: mode !== 'projects', navigation, t: key => key }),
    React.createElement(context.SharedCollection, { projects: () => React.createElement('div', { 'data-workspaces': '' }, 'Workspace rows'), items: [], mode, query, navigation, t: key => key, projectText: key => key }))))
  render()
  return { sections, context, navigation, render }
}

it('renders peer project and conversation sections with independent collapse state and matching arrows', () => {
  const { navigation, context } = fixture()
  const toggles = () => host.querySelectorAll('.dshEnterpriseSectionToggle')
  const projectBody = () => host.querySelector('.dshChatProjects > div:last-child')
  const conversationBody = () => host.querySelector('.dshRecentHistory > div:last-child')
  const expectToggle = (index, expanded) => {
    expect(toggles()[index].getAttribute('aria-expanded')).toBe(String(expanded))
    expect(toggles()[index].querySelector('.dshEnterpriseSectionChevron').style.transform)
      .toBe(expanded ? 'rotate(90deg)' : 'rotate(0deg)')
  }
  expect(toggles()).toHaveLength(3)
  expect(host.querySelector('.dshChatProjects').parentElement).toBe(host.querySelector('.dshRecentHistory').parentElement)
  for (let index = 0; index < 3; index++) expectToggle(index, true)
  act(() => toggles()[0].click())
  expect(host.querySelector('[data-workspaces]')).toBeNull()
  expectToggle(0, false)
  act(() => toggles()[1].click())
  expectToggle(1, false)
  expectToggle(2, true)
  expect(projectBody().hidden).toBe(true)
  expect(conversationBody().hidden).toBe(false)
  act(() => toggles()[2].click())
  expectToggle(2, false)
  expect(conversationBody().hidden).toBe(true)
  expect(context.createSidebarSections().snapshot()).toEqual({ workspace: true, projects: true, conversations: true })
  act(() => toggles()[1].click())
  expectToggle(1, true)
  expect(projectBody().hidden).toBe(false)
  expect(conversationBody().hidden).toBe(true)
  act(() => host.querySelector('[aria-label="create"]').click())
  expect(navigation.projects.edit).toHaveBeenCalledWith('create')
  act(() => { toggles()[0].click(); toggles()[2].click() })
  for (let index = 0; index < 3; index++) expectToggle(index, true)
  expect(host.querySelector('[data-workspaces]')).not.toBeNull()
  expect(conversationBody().hidden).toBe(false)
  expect(host.textContent).toContain('Loose chat')
  expect(host.textContent).toContain('Saved project')
})

it('keeps search and flat-list results visible when grouped sections were collapsed', () => {
  const { sections, render } = fixture()
  act(() => { sections.toggle('workspace'); sections.toggle('projects'); sections.toggle('conversations') })
  render('search', 'Loose')
  expect(host.querySelector('[data-workspaces]')).not.toBeNull()
  expect(host.querySelector('[hidden]')).toBeNull()
  expect(host.textContent).toContain('Loose chat')
  render('flat')
  expect(host.querySelector('[hidden]')).toBeNull()
  expect(host.textContent).toContain('Loose chat')
})
