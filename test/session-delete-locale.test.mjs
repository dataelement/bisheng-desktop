// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import React, { act } from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const source = readFileSync(process.env.DSH_TEST_DELETE_CLIENT_SOURCE ?? 'packages/dsh-desktop-client-ui/client.js', 'utf8')
let primitives, cleanup
beforeAll(async () => {
  const bundle = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { build } from 'esbuild'; import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8');
    const boundary = source.indexOf('//#region lib/types/RiskConfirmation.js');
    if (boundary < 0) throw new Error('Recheck the installed primitive layout');
    const result = await build({ stdin: { contents: source.slice(0, boundary) + '\\nexport { Modal, Menu, MenuItemButton, Button };', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'cjs', platform: 'browser',
      plugins: [{ name: 'ui-only', setup(build) {
        build.onResolve({ filter: /\\.css$/ }, args => ({ path: args.path, namespace: 'css' }));
        build.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}', loader: 'js' }));
        build.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true, sideEffects: false }));
      } }]
    }); process.stdout.write(result.outputFiles[0].text)`
  ], { encoding: 'utf8', maxBuffer: 4_000_000 })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', bundle)(module, module.exports, name => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (name === 'clsx') return (...values) => values.filter(Boolean).join(' ')
    throw new Error(name)
  })
  primitives = module.exports
})
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.restoreAllMocks() })

async function fixture({ language = 'zh', deleteSession = vi.fn(async () => {}), cloud = false } = {}) {
  let plugin, locale = language
  const entries = new Map(), dictionaries = new Map(), disposers = []
  const nativeConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Native confirmation invoked') })
  const nativeAlert = vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('Native alert invoked') })
  let cloudState = { connected: true, phase: 'ready', epoch: 1, conversationId: 'cloud-a' }, cloudListener
  let cloudItems = [{ id: 'cloud-a', title: '云端会话', updatedAt: '2026-11-03' }]
  const bridge = {
    state: async () => cloudState,
    subscribe: fn => { cloudListener = fn; return () => { cloudListener = undefined } },
    history: vi.fn(async () => ({ epoch: cloudState.epoch, items: [...cloudItems], hasMore: false })),
    remove: vi.fn(async (id, epoch) => { await deleteSession(id); if (epoch === cloudState.epoch) cloudItems = cloudItems.filter(item => item.id !== id); return { epoch } }),
    open: vi.fn(async () => {})
  }
  if (cloud) window.dshEnterpriseChat = bridge
  const clientWindow = cloud ? window : {}
  clientWindow.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error(name)
    })
  } }
  new Function('window', source)(clientWindow)
  plugin.apply({
    uiWorkspace: { registerNavigationHandler: () => () => {}, startSession: vi.fn() },
    sessions: {
      list: { getSnapshot: () => ({ phase: 'ready', byId: { 'session-a': { id: 'session-a', retainedBy: { mainView: 1 } } } }), subscribe: () => () => {} },
      retainInfo: () => ({ getSnapshot: () => ({ referenceCount: 0 }), subscribe: () => () => {} }),
      delete: deleteSession
    },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
    get: name => {
      if (name === 'uiWorkspace') return { startSession: vi.fn() }
      if (name === 'sessions') return {
        list: { getSnapshot: () => ({ phase: 'ready', byId: { 'session-a': { id: 'session-a', retainedBy: { mainView: 1 } } } }), subscribe: () => () => {} },
        retainInfo: () => ({ getSnapshot: () => ({ referenceCount: 0 }), subscribe: () => () => {} }),
        delete: deleteSession
      }
      return undefined
    },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    locale: {
      register(ns, dictionary) { dictionaries.set(ns, dictionary); return () => dictionaries.delete(ns) },
      bind: ns => (key, args = {}) => dictionaries.get(ns)[locale][key].replace(/\{(\w+)\}/g, (_, name) => args[name])
    },
    slots: {
      inject(name, fn) { if (['shell.overlay', 'sidebar.workspaces.session.menu.item', ...(cloud ? ['sidebar.workspaces.collection'] : [])].includes(name)) fn() },
      register(meta, Component) { entries.set(meta.id, { meta, Component }); return () => {} }
    }
  })
  const menu = entries.get('desktop-delete-session')
  const overlay = entries.get(cloud ? 'desktop-cloud-chat-delete-dialog' : 'desktop-delete-session-dialog')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let mounted = true
  const menuProps = menu?.meta.inject(), overlayProps = overlay?.meta.inject()
  const collection = entries.get('desktop-shared-collection')
  const collectionProps = collection?.meta.inject()
  if (cloud) disposers.push(collectionProps.navigation.start())
  function App() {
    const [open, setOpen] = React.useState(false)
    return React.createElement(React.Fragment, null,
      cloud ? React.createElement(collection.Component, { ...collectionProps, mode: 'projects', query: '', archivedOnly: false, items: [], projects: () => null }) : React.createElement(primitives.Menu, {
        open, onClose: () => setOpen(false), portal: true,
        anchor: React.createElement('button', { onClick: () => setOpen(true), 'data-trigger': true }, 'Session actions')
      }, React.createElement(menu.Component, {
        ...menuProps, sessionId: 'session-a', displayTitle: '测试工作会话', useMenuOpenState: () => [open, setOpen]
      })),
      overlay && React.createElement(overlay.Component, overlayProps)
    )
  }
  const render = () => root.render(React.createElement(App))
  await act(async () => render())
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === label)
    expect(button, label).toBeDefined()
    act(() => button.click())
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  }
  cleanup = async () => {
    if (mounted) await act(async () => root.unmount())
    disposers.reverse().forEach(dispose => dispose())
    container.remove()
    if (cloud) { delete window.dshEnterpriseChat; delete window.__ModuleLoader__ }
  }
  return {
    deleteSession, nativeConfirm, nativeAlert, click, bridge, menuMeta: menu?.meta,
    navigation: collectionProps?.navigation,
    async account(epoch) { cloudState = { ...cloudState, epoch }; await act(async () => cloudListener(cloudState)) },
    dialog: () => document.querySelector('[role=dialog]'),
    open: async () => {
      if (cloud) {
        const trigger = document.querySelector('.dshCloudHistoryActions')
        trigger.focus()
        await act(async () => trigger.click())
        await click(locale === 'zh' ? '删除' : 'Delete')
      } else {
        document.querySelector('[data-trigger]').focus()
        await click('Session actions')
        await click(locale === 'zh' ? '彻底删除' : 'Delete permanently')
      }
    },
    switchLanguage: async value => { locale = value; await act(async () => render()) },
    dispose: async () => {
      await act(async () => root.unmount())
      mounted = false
      disposers.reverse().splice(0).forEach(dispose => dispose())
    },
    deletion: overlayProps?.deletion
  }
}

it('places permanent delete as the last menu item with order 1000', async () => {
  const ui = await fixture({ cloud: false })
  expect(ui.menuMeta.order).toBe(1000)
  expect(ui.menuMeta.id).toBe('desktop-delete-session')
})

it.each(['zh', 'en'])('confirms local work session permanent deletion in %s', async language => {
  const ui = await fixture({ cloud: false, language })
  await ui.open()
  expect(ui.dialog().textContent).toContain('测试工作会话')
  expect(ui.dialog().textContent).toContain(language === 'zh' ? '彻底删除会话' : 'Delete session permanently')
  const buttons = [...ui.dialog().querySelectorAll('button')]
  expect(buttons.map(n => n.textContent)).toEqual(language === 'zh' ? ['', '取消', '彻底删除'] : ['', 'Cancel', 'Delete permanently'])
  await ui.click(language === 'zh' ? '彻底删除' : 'Delete permanently')
  expect(ui.deleteSession).toHaveBeenCalledExactlyOnceWith('session-a')
  expect(ui.dialog()).toBeNull()
})

it.each(['zh', 'en'])('confirms cloud deletion through the installed Menu and Modal in %s', async language => {
  const ui = await fixture({ cloud: true, language })
  await ui.open()
  expect(ui.bridge.open).toHaveBeenCalledTimes(0)
  expect(ui.dialog().textContent).toContain('云端会话')
  expect(document.activeElement.textContent).toBe(language === 'zh' ? '取消' : 'Cancel')
  await ui.click(language === 'zh' ? '取消' : 'Cancel')
  expect(ui.bridge.remove).toHaveBeenCalledTimes(0)
  expect(document.activeElement.className).toBe('dshCloudHistoryActions')
  await ui.open()
  await ui.click(language === 'zh' ? '删除会话' : 'Delete conversation')
  expect(ui.bridge.remove).toHaveBeenCalledExactlyOnceWith('cloud-a', 1)
  expect(ui.dialog()).toBeNull()
  expect(document.querySelector('[data-history-kind=chat]')).toBeNull()
})

it('keeps a failed cloud deletion retryable', async () => {
  const deletion = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const ui = await fixture({ cloud: true, deleteSession: deletion })
  await ui.open()
  await ui.click('删除会话')
  expect(ui.dialog().querySelector('[role=alert]').textContent).toContain('offline')
  expect(document.querySelector('[data-history-kind=chat]')).toBeTruthy()
  await ui.click('删除会话')
  expect(ui.dialog()).toBeNull()
  expect(ui.bridge.remove).toHaveBeenCalledTimes(2)
})

it('clears a pending confirmation when the authenticated account changes', async () => {
  const ui = await fixture({ cloud: true })
  await ui.open()
  await ui.account(2)
  expect(ui.dialog()).toBeNull()
  await act(async () => ui.deletion.confirm())
  expect(ui.bridge.remove).toHaveBeenCalledTimes(0)
})

it('holds the cloud confirmation during deletion and ignores duplicate confirmation', async () => {
  let finish
  const ui = await fixture({ cloud: true, deleteSession: () => new Promise(resolve => { finish = resolve }) })
  await ui.open()
  await ui.click('删除会话')
  expect(ui.dialog().querySelector('[role=status]')).toBeTruthy()
  await act(async () => { ui.deletion.close(); void ui.deletion.confirm() })
  expect(ui.dialog()).toBeTruthy()
  expect(ui.bridge.remove).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(ui.dialog()).toBeNull()
})

it('discards a list response captured before a successful deletion', async () => {
  const ui = await fixture({ cloud: true })
  let finish
  ui.bridge.history.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  act(() => { void ui.navigation.refreshHistory() })
  await ui.open()
  await ui.click('删除会话')
  expect(document.querySelector('[data-history-kind=chat]')).toBeNull()
  await act(async () => finish({ epoch: 1, items: [{ id: 'cloud-a', title: 'stale', updatedAt: '2026-11-03' }], hasMore: false }))
  expect(document.querySelector('[data-history-kind=chat]')).toBeNull()
})

it('preserves the next account history when an earlier deletion finishes', async () => {
  let finish
  const ui = await fixture({ cloud: true, deleteSession: () => new Promise(resolve => { finish = resolve }) })
  await ui.open()
  await ui.click('删除会话')
  await ui.account(2)
  expect(ui.dialog()).toBeNull()
  await act(async () => finish())
  expect(ui.navigation.snapshot().epoch).toBe(2)
  expect(ui.navigation.snapshot().items.map(item => item.id)).toEqual(['cloud-a'])
})

it('advances server pages when filtered history pages contain fewer rows', async () => {
  const ui = await fixture({ cloud: true })
  ui.bridge.history.mockResolvedValue({ epoch: 1, items: [], hasMore: true })
  await act(async () => ui.navigation.refreshHistory(true))
  await act(async () => ui.navigation.refreshHistory(true))
  expect(ui.bridge.history.mock.calls.map(call => call[0])).toEqual([1, 2, 3])
  expect(ui.navigation.snapshot().page).toBe(3)
})
