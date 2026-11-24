// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { shippedFixture } from './enterprise-harness-fixture.mjs'
import * as jsxRuntime from 'react/jsx-runtime'
import { createPortal } from 'react-dom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
let root
let host
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { if (root) act(() => root.unmount()); root = undefined; document.body.replaceChildren() })
function mount({ panels = [], connected = true, wide = true, actualMenu } = {}) {
  const state = { mode: 'work', connected, epoch: 1, activePanelId: 'tools', navigation: { entries: [{ id: 'knowledge', label: 'Knowledge' }] } }
  const navigation = { snapshot: () => state, subscribe: () => () => {}, select: vi.fn(), openPage: vi.fn() }
  const selectPanel = vi.fn(), expandSidebar = vi.fn()
  const context = vm.createContext({ React, window, CustomEvent, NavigationIcon: () => null,
    Menu: actualMenu || (({ anchor, open, items, onSelect, selectedId }) => React.createElement(React.Fragment, null, anchor,
      open && React.createElement('div', { role: 'menu' }, ...items.map(item => React.createElement('button', { key: item.id, role: 'menuitem', 'data-id': item.id, 'aria-current': selectedId === item.id, onClick: () => onSelect(item.id) }, item.label))))) })
  vm.runInContext(source.slice(source.indexOf('const NAV_ICON_PATHS ='), source.indexOf('function PrimaryNavigation(')), context)
  vm.runInContext(source.slice(source.indexOf('function PrimaryNavigation('), source.indexOf('function installDesktopModes(')), context)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(React.createElement(context.PrimaryNavigation, { wide, panels, navigation, selectPanel, expandSidebar,
    renderPanelIcon: () => { throw new Error("slot 'sidebar.panellist' is not declared by this entry's children") }, t: key => key,
    renderAction: ({ id, label, icon, onClick }) => React.createElement('button', { 'data-action': id, onClick }, icon, label) })))
  const open = () => act(() => host.querySelector('[data-action="more"]').click())
  const select = id => act(() => host.querySelector(`[data-id="${id}"]`).click())
  return { navigation, selectPanel, expandSidebar, open, select }
}
it('keeps Plugins in More when it is no longer a panel, and routes all entries', () => {
  const { open, select, navigation, selectPanel } = mount({ panels: [{ id: 'tools', label: 'Tools' }] })
  const listener = vi.fn()
  window.addEventListener('dsh-desktop:open-settings-section', listener)
  try {
    expect(host.querySelectorAll('[data-action]')).toHaveLength(1)
    expect(host.querySelector('[data-action=more] svg path').getAttribute('d')).toBe('M5 12h.01M12 12h.01M19 12h.01')
    open()
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
    expect(host.querySelector('[data-id="local:tools"]').getAttribute('aria-current')).toBe('true')
    select('settings:plugins')
    expect(listener.mock.calls[0][0].detail).toEqual({ id: 'plugins' })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    open(); select('local:tools')
    expect(navigation.select).toHaveBeenCalledWith('work')
    expect(selectPanel).toHaveBeenCalledWith('tools')
    open(); select('web:knowledge')
    expect(navigation.openPage).toHaveBeenCalledWith('knowledge')
  } finally { window.removeEventListener('dsh-desktop:open-settings-section', listener) }
})
it('preserves one legacy Plugins panel entry in More', () => {
  const { open, select, selectPanel } = mount({ panels: [{ id: 'plugins', label: 'Plugins' }], connected: false })
  open()
  expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
  select('local:plugins')
  expect(selectPanel).toHaveBeenCalledWith('plugins')
})
it('keeps More accessible without an account or panels and expands the narrow sidebar', () => {
  const { open, expandSidebar } = mount({ connected: false, wide: false })
  open()
  expect(expandSidebar).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-id="settings:plugins"]')).not.toBeNull()
  expect(host.querySelector('[data-id="web:knowledge"]')).toBeNull()
})
it('allows the account settings bridge to open the Plugins section', async () => {
  const client = await readFile('packages/dsh-desktop-enterprise/client.js', 'utf8')
  const start = client.indexOf('const openSection = useCallback(id => {')
  const body = client.slice(start + 'const openSection = useCallback(id => {'.length, client.indexOf('}, [openSettingsSection', start))
  const openSettingsSection = vi.fn()
  vm.runInNewContext(`(id => {${body}})('plugins')`, { openSettingsSection, openSettings: vi.fn(), setMenuOpen: vi.fn(), setApprovalsOpen: vi.fn() })
  expect(openSettingsSection).toHaveBeenCalledWith('plugins')
})

it('renders More with the installed primitive Menu rather than a menu mock', async () => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const primitives = await readFile('node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js', 'utf8')
  const context = vm.createContext({ ...React, ...jsxRuntime, createPortal, window, document, navigator, Element, HTMLElement, Node, getComputedStyle, setTimeout, clearTimeout,
    clsx: (...args) => args.filter(Boolean).join(' ') })
  for (const match of primitives.matchAll(/import (css[\w$]*) from/g)) context[match[1]] = new Proxy({}, { get: (_, key) => String(key) })
  vm.runInContext(shippedFixture(primitives).declarations('Menu'), context)
  mount({ connected: false, actualMenu: context.Menu })
  expect(host.querySelector('[data-action="more"]')).not.toBeNull()
})

it('places the legacy More launcher in the rc.5 navigation grid seat rather than the gutter', async () => {
  const sidebar = await readFile('node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', 'utf8')
  const panelListClass = sidebar.match(/"panelList":`([^`]+)`/)[1]
  const nativeRule = sidebar.match(new RegExp('\\.' + panelListClass + '\\{([^}]+)\\}'))[1]
  const nativeSeat = nativeRule.match(/grid-area:([^;]+)/)[1]
  const enterpriseRule = source.match(/\.dshPrimaryNavigation\{([^}]+)\}/)[1]
  expect(enterpriseRule).toContain(`grid-area:${nativeSeat};`)
  expect(enterpriseRule).toContain('min-width:0;')
})
