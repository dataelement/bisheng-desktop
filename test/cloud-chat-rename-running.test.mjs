// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { loadSidebarPrimitives } from './helpers/sidebar-primitives.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const source = readFileSync('packages/dsh-desktop-client-ui/client.js', 'utf8')
let primitives, cleanup
beforeAll(() => {
  primitives = loadSidebarPrimitives(['Modal', 'Menu', 'MenuItemButton', 'Button', 'HoverCard', 'StateDot', 'relativeTime',
    ...['ChevronRightOutline', 'EditOutline', 'EllipsisOutline', 'FolderClose', 'FolderOpen', 'NewChatOutline', 'PlusOutline', 'TrashOutline', 'TriangleRightFill'].map(icon => `Icon${icon}Regular`)])
})
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.restoreAllMocks() })

async function fixture({ language = 'zh', rename = async () => {} } = {}) {
  let plugin
  const entries = new Map(), dictionaries = new Map(), disposers = []
  let state = { connected: true, phase: 'ready', epoch: 1, conversationId: 'cloud-a' }, listener
  let items = [{ id: 'cloud-a', title: '季度复盘', updatedAt: '2026-11-03' }, { id: 'cloud-b', title: '', updatedAt: '2026-11-02' }]
  const bridge = {
    state: async () => state,
    subscribe: fn => { listener = fn; return () => { listener = undefined } },
    history: vi.fn(async () => ({ epoch: state.epoch, items: items.map(item => ({ ...item })), hasMore: false })),
    rename: vi.fn(async (id, name, epoch) => {
      await rename(id, name)
      if (epoch === state.epoch) items = items.map(item => item.id === id ? { ...item, title: name, updatedAt: '2026-11-09' } : item)
      return { epoch }
    }),
    remove: vi.fn(async (_id, epoch) => ({ epoch })),
    open: vi.fn(async () => {})
  }
  window.dshEnterpriseChat = bridge
  window.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error(name)
    })
  } }
  new Function(source)()
  plugin.apply({
    uiWorkspace: { registerNavigationHandler: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }), subscribe: () => () => {} } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
    get: () => ({ deleteSession: vi.fn() }),
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    locale: {
      register(ns, dictionary) { dictionaries.set(ns, dictionary); return () => dictionaries.delete(ns) },
      bind: ns => (key, args = {}) => dictionaries.get(ns)[language][key].replace(/\{(\w+)\}/g, (_, name) => args[name])
    },
    slots: {
      inject(name, fn) { if (['shell.overlay', 'sidebar.workspaces.collection'].includes(name)) fn() },
      register(meta, Component) { entries.set(meta.id, { meta, Component }); return () => {} }
    }
  })
  const collection = entries.get('desktop-shared-collection'), overlay = entries.get('desktop-cloud-chat-rename-dialog')
  expect(overlay.meta.locale).toBe('desktop.cloudChatRename')
  const collectionProps = collection.meta.inject(), overlayProps = overlay.meta.inject()
  disposers.push(collectionProps.navigation.start())
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(collection.Component, { ...collectionProps, mode: 'projects', query: '', archivedOnly: false, items: [], projects: () => null }),
    React.createElement(overlay.Component, overlayProps))))
  const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  await settle()
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === label)
    expect(button, label).toBeDefined()
    act(() => button.click())
    await settle()
  }
  cleanup = async () => {
    await act(async () => root.unmount())
    disposers.reverse().forEach(dispose => dispose())
    container.remove()
    delete window.dshEnterpriseChat
    delete window.__ModuleLoader__
  }
  const row = title => document.querySelector(`[data-history-kind=chat][aria-label="${title}"]`)?.closest('.dshCloudHistoryRow')
  return {
    bridge, click, settle, row,
    navigation: collectionProps.navigation,
    renaming: overlayProps.renaming,
    dialog: () => document.querySelector('[role=dialog]'),
    input: () => document.querySelector('[role=dialog] input'),
    async menu(title) {
      const trigger = row(title).querySelector('.dshCloudHistoryActions')
      trigger.focus()
      await act(async () => trigger.click())
      return [...document.querySelectorAll('[role=menuitem]')].map(node => node.textContent)
    },
    async type(value) {
      const input = document.querySelector('[role=dialog] input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
    },
    async key(key, init = {}) {
      await act(async () => document.querySelector('[role=dialog] input').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
      await settle()
    },
    async push(patch) { state = { ...state, ...patch }; await act(async () => listener(state)); await settle() }
  }
}

it.each([
  ['zh', ['重命名', '移入项目', '删除'], '重命名会话', '取消'],
  ['en', ['Rename', 'Move to project', 'Delete'], 'Rename conversation', 'Cancel']
])('renames a cloud conversation from its row menu in %s', async (language, menu, title, cancel) => {
  const ui = await fixture({ language })
  expect(await ui.menu('季度复盘')).toEqual(menu)
  await ui.click(menu[0])
  expect(document.querySelector('[role=menu]')).toBeNull()
  expect(ui.dialog().textContent).toContain(title)
  expect(ui.input().value).toBe('季度复盘')
  expect(document.activeElement).toBe(ui.input())
  expect([...ui.dialog().querySelectorAll('button')].map(node => node.textContent)).toContain(cancel)
  const reads = ui.bridge.history.mock.calls.length
  await ui.type('  年度复盘  ')
  await ui.key('Enter')
  expect(ui.bridge.rename).toHaveBeenCalledWith('cloud-a', '年度复盘', 1)
  expect(ui.dialog()).toBeNull()
  expect(ui.row('年度复盘')).toBeTruthy()
  expect(ui.row('季度复盘')).toBeFalsy()
  expect(ui.bridge.history.mock.calls.length).toBeGreaterThan(reads)
})

it('starts an unnamed conversation with an empty draft and keeps blank names blocked', async () => {
  const ui = await fixture()
  await ui.menu('新聊天')
  await ui.click('重命名')
  const confirm = () => [...ui.dialog().querySelectorAll('button')].find(node => node.textContent === '重命名')
  expect(ui.input().value).toBe('')
  expect(confirm().disabled).toBe(true)
  await ui.type('   ')
  await ui.key('Enter')
  expect(confirm().disabled).toBe(true)
  expect(ui.bridge.rename).not.toHaveBeenCalled()
  await ui.click('取消')
  expect(ui.dialog()).toBeNull()
  expect(ui.bridge.rename).not.toHaveBeenCalled()
})

it('does not submit while an input method is composing', async () => {
  const ui = await fixture()
  await ui.menu('季度复盘')
  await ui.click('重命名')
  await ui.type('jidu')
  await act(async () => ui.input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await ui.key('Enter')
  expect(ui.bridge.rename).not.toHaveBeenCalled()
  await ui.type('季度')
  await act(async () => ui.input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await ui.key('Enter')
  expect(ui.bridge.rename).toHaveBeenCalledWith('cloud-a', '季度', 1)
})

it('opens rename from a title double-click like Work rows', async () => {
  const ui = await fixture()
  const title = ui.row('季度复盘').querySelector('.dshHistoryTitle')
  await act(async () => title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await ui.settle()
  expect(ui.input().value).toBe('季度复盘')
})

it('locks the dialog while saving and keeps a failed rename retryable', async () => {
  let fail
  const rename = vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    .mockResolvedValue(undefined)
  const ui = await fixture({ rename })
  await ui.menu('季度复盘')
  await ui.click('重命名')
  await ui.type('年度复盘')
  await ui.key('Enter')
  expect(ui.dialog().querySelector('[role=status]').textContent).toBe('正在重命名…')
  expect(ui.input().disabled).toBe(true)
  await act(async () => { ui.renaming.close(); void ui.renaming.confirm('again') })
  expect(ui.dialog()).toBeTruthy()
  expect(ui.bridge.rename).toHaveBeenCalledTimes(1)
  await act(async () => fail(new Error('offline')))
  await ui.settle()
  const alert = ui.dialog().querySelector('[role=alert]')
  expect(alert.textContent).toContain('重命名失败，请重试。')
  expect(alert.textContent).toContain('offline')
  expect(ui.input().value).toBe('年度复盘')
  expect(ui.row('季度复盘')).toBeTruthy()
  await ui.key('Enter')
  expect(ui.dialog()).toBeNull()
  expect(ui.bridge.rename).toHaveBeenCalledTimes(2)
  expect(ui.row('年度复盘')).toBeTruthy()
})

it('drops a pending rename when the account changes', async () => {
  const ui = await fixture()
  await ui.menu('季度复盘')
  await ui.click('重命名')
  await ui.push({ epoch: 2 })
  expect(ui.dialog()).toBeNull()
  await act(async () => ui.renaming.confirm('年度复盘'))
  expect(ui.bridge.rename).not.toHaveBeenCalled()
})

it.each([['zh', '进行中'], ['en', 'Running']])('shows host-reported activity on cloud rows in %s', async (language, label) => {
  const ui = await fixture({ language })
  const unnamed = language === 'zh' ? '新聊天' : 'New chat'
  const status = title => ui.row(title).querySelector('.dshHistoryStatus')
  expect(status('季度复盘')).toBeNull()
  await ui.push({ running: ['cloud-a', 'cloud-gone'] })
  const indicator = status('季度复盘')
  expect(indicator.querySelector('svg[data-state=ongoing]')).toBeTruthy()
  const description = ui.row('季度复盘').querySelector('[data-history-kind=chat]').getAttribute('aria-describedby').split(' ')
  expect(description.map(id => document.getElementById(id)?.textContent)).toContain(label)
  expect(status(unnamed)).toBeNull()
  // The host omits an empty list; absence clears the previous activity.
  const { running, ...rest } = ui.navigation.snapshot()
  expect(running).toEqual(['cloud-a', 'cloud-gone'])
  await ui.push({ ...rest, running: undefined })
  expect(status('季度复盘')).toBeNull()
  expect(ui.navigation.snapshot().running).toEqual([])
})

it('clears activity when the account signs out', async () => {
  const ui = await fixture()
  await ui.push({ running: ['cloud-a'] })
  await ui.push({ connected: false, running: ['cloud-a'] })
  expect(ui.navigation.snapshot().running).toEqual([])
})
