import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const invoke = vi.fn()
  return { expose: vi.fn(), invoke, ipc: Object.assign(new EventEmitter(), { invoke }) }
})
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: mocks.ipc }))
const ipc = mocks.ipc
import { initializeEnterpriseLoginBridge } from '../src/preload/enterprise-bridge'

describe('enterprise preload composition', () => {
  beforeEach(() => { ipc.removeAllListeners(); vi.clearAllMocks() })

  it('captures early login links and cleans subscriptions', () => {
    const expose = initializeEnterpriseLoginBridge()
    ipc.emit('enterprise:login-link', {}, 'early')
    ipc.emit('enterprise:login-link', {}, 42)
    expect(mocks.expose).not.toHaveBeenCalled()
    expose()
    const login = mocks.expose.mock.calls[1]![1]
    const listener = vi.fn()
    const off = login.onLoginLink(listener)
    expect(listener).toHaveBeenCalledWith('early')
    expect(login.consumeLoginLink()).toBe('early')
    expect(login.consumeLoginLink()).toBeUndefined()
    ipc.emit('enterprise:login-link', {}, 'next')
    off()
    ipc.emit('enterprise:login-link', {}, 'last')
    expect(listener.mock.calls).toEqual([['early'], ['next']])
    expect(() => login.onLoginLink(null)).toThrow(TypeError)
  })

  it('exposes named IPC operations and removes event listeners', () => {
    initializeEnterpriseLoginBridge()()
    expect(mocks.expose.mock.calls.map(call => call[0])).toEqual(['dshEnterpriseChat', 'dshDesktopEnterprise'])
    const chat = mocks.expose.mock.calls[0]![1]
    expect(Object.keys(chat)).toEqual(['onToolsChanged', 'focusSettings', 'present', 'state', 'retry', 'usage', 'history', 'openPage', 'open', 'subscribe'])
    const input = { visible: true }
    chat.focusSettings(); chat.present(input); chat.state(); chat.retry(); chat.usage(); chat.history(2); chat.openPage('a'); chat.open('b')
    expect(mocks.invoke.mock.calls).toEqual([
      ['enterprise-chat:focus-settings'], ['enterprise-chat:present', input], ['enterprise-chat:state'],
      ['enterprise-chat:retry'], ['enterprise-chat:usage'], ['enterprise-chat:history', 2],
      ['enterprise-chat:open-page', 'a'], ['enterprise-chat:open', 'b']
    ])
    const tools = vi.fn(), changed = vi.fn()
    const offTools = chat.onToolsChanged(tools), offChanged = chat.subscribe(changed)
    ipc.emit('enterprise-chat:tools-changed', {})
    ipc.emit('enterprise-chat:changed', {}, input)
    offTools(); offChanged()
    ipc.emit('enterprise-chat:tools-changed', {})
    ipc.emit('enterprise-chat:changed', {}, input)
    expect(tools).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls).toEqual([[input]])
    expect(() => chat.onToolsChanged(null)).toThrow(TypeError)
  })

  it('forwards settings events without exposing IPC events', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    class TestEvent { constructor(public type: string, public options?: { detail: unknown }) {} }
    vi.stubGlobal('CustomEvent', TestEvent)
    try {
      initializeEnterpriseLoginBridge()()
      ipc.emit('enterprise-chat:close-settings', {})
      ipc.emit('enterprise-chat:settings-focus', {}, 'next')
      expect(dispatch.mock.calls.map(([event]) => [event.type, event.options?.detail])).toEqual([
        ['dsh-desktop:close-settings', undefined], ['dsh-desktop:settings-focus', 'next']
      ])
    } finally { vi.unstubAllGlobals() }
  })
})
