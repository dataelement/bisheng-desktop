// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = await readFile('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8')
const implementation = source.slice(source.indexOf('function createChatNavigation('), source.indexOf('function useHistoryTitleMarquee('))

it('reveals the host before the legacy sidebar starts a session and restores the service on disposal', () => {
  let onChatState
  window.dshEnterpriseChat = {
    state: () => new Promise(() => {}),
    subscribe: callback => { onChatState = callback; return () => {} },
    history: async () => ({ epoch: 1, items: [], hasMore: false }),
  }
  const projects = { setScope() {}, snapshot: () => ({ revision: 0 }), apply() {} }
  const context = vm.createContext({ window, document, CustomEvent, createChatProjects: () => projects,
    createSessionRequest: () => ({ reset() {} }) })
  vm.runInContext(implementation, context)
  const start = vi.fn(function (...args) { return { receiver: this, args, mode: navigation.snapshot().mode } })
  const uiWorkspace = { startSession: start, openSession() {} }
  const store = snapshot => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
  const ctx = { uiWorkspace, layout: { panelInfo: store({ activePanelId: null }) },
    sessions: { list: store({ phase: 'ready', byId: {} }) } }
  const navigation = context.createChatNavigation(ctx)
  const dispose = navigation.start()
  onChatState({ connected: true, epoch: 1, phase: 'idle', navigation: { entries: [] } })
  expect(navigation.snapshot().mode).toBe('chat')
  const result = uiWorkspace.startSession('workspace', { prompt: 'hello' })
  expect(result.mode).toBe('work')
  expect(result.receiver).toBe(uiWorkspace)
  expect(result.args).toEqual(['workspace', { prompt: 'hello' }])
  expect(navigation.snapshot().pageId).toBeUndefined()
  dispose()
  expect(uiWorkspace.startSession).toBe(start)
  delete window.dshEnterpriseChat
})
