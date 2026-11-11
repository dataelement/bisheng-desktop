import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalArgv = [...process.argv]
let ipc, exposed, invoke
async function loadPreload(url = 'dsh-app://app/', safeMode = false) {
  vi.resetModules()
  exposed = new Map()
  ipc = new EventEmitter()
  invoke = vi.fn(async (channel, ...args) => ({ channel, args }))
  Object.assign(ipc, { invoke })
  process.argv = originalArgv.filter(arg => arg !== '--dsh-desktop-safe-mode')
  if (safeMode) process.argv.push('--dsh-desktop-safe-mode')
  vi.stubGlobal('location', new URL(url))
  vi.doMock('electron', () => ({
    contextBridge: { exposeInMainWorld: (name, bridge) => { if (exposed.has(name)) throw new Error('duplicate bridge'); exposed.set(name, bridge) } },
    ipcRenderer: ipc
  }))
  // The shared preload owns its own bridges; this suite exercises only the enterprise layer.
  vi.doMock('../src/preload/app', () => ({}))
  await import('../packages/dsh-desktop-enterprise/desktop/preload')
  return { chat: exposed.get('dshEnterpriseChat'), enterprise: exposed.get('dshDesktopEnterprise') }
}
afterEach(() => {
  ipc?.removeAllListeners()
  process.argv = [...originalArgv]
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('enterprise desktop preload bridge', () => {
  it('exposes two frozen, named bridges on the normal application page only', async () => {
    const { chat, enterprise } = await loadPreload()
    expect([...exposed.keys()]).toEqual(['dshEnterpriseChat', 'dshDesktopEnterprise'])
    expect(Object.isFrozen(chat)).toBe(true)
    expect(Object.isFrozen(enterprise)).toBe(true)
    expect(exposed.has('dshDesktop')).toBe(false)
    expect(chat.invoke).toBeUndefined()
    expect(enterprise.send).toBeUndefined()
    expect(ipc.listenerCount('enterprise:login-link')).toBe(1)
  })

  it.each([
    'file:///fixture/splash.html', 'file:///fixture/web-import.html',
    'dsh-desktop://desktop/safe-mode.html', 'https://enterprise.example/workspace',
    'http://127.0.0.1:1234/', 'dsh-app://other/', 'dsh-app://app:99/', 'dsh-app://user@app/'
  ])('does not expose enterprise bridges on %s', async url => {
    await loadPreload(url)
    expect(exposed.size).toBe(0)
    expect(ipc.eventNames()).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not expose account or chat capabilities in the Safe Mode application renderer', async () => {
    await loadPreload('dsh-app://app/', true)
    expect(exposed.size).toBe(0)
    expect(ipc.eventNames()).toEqual([])
  })

  it('maps each named chat method to its IPC channel and argument order', async () => {
    const { chat, enterprise } = await loadPreload()
    const rows = [
      ['focusSettings', 'focus-settings', []], ['present', 'present', [{ visible: true }]],
      ['capture', 'capture', []], ['state', 'state', []], ['retry', 'retry', []], ['usage', 'usage', []],
      ['history', 'history', [2]], ['openPage', 'open-page', ['page']], ['open', 'open', ['conversation', 'project']],
      ['remove', 'remove', ['conversation', 3]], ['rename', 'rename', ['conversation', 'Title', 3]],
      ['projectsState', 'projects-state', []], ['projectAction', 'project-action', [{ kind: 'select' }, 3]],
      ['projectConversations', 'project-conversations', [2, 3]]
    ]
    for (const [method, suffix, args] of rows) {
      const channel = 'enterprise-chat:' + suffix
      await expect(chat[method](...args)).resolves.toEqual({ channel, args })
      expect(invoke).toHaveBeenLastCalledWith(channel, ...args)
    }
    await enterprise.settingsInfo()
    expect(invoke).toHaveBeenLastCalledWith('enterprise:settings-info')
  })

  it('validates the three settings actions before invoking IPC and propagates rejected calls', async () => {
    const { enterprise } = await loadPreload()
    for (const value of ['install', '', null, {}, 42]) expect(() => enterprise.settingsAction(value)).toThrow('Invalid Desktop settings action')
    expect(invoke).not.toHaveBeenCalled()
    for (const action of ['check-for-updates', 'show-harness-log', 'safe-mode']) {
      await enterprise.settingsAction(action)
      expect(invoke).toHaveBeenLastCalledWith('enterprise:settings-action', action)
    }
    invoke.mockRejectedValueOnce(new Error('fixture IPC failed'))
    await expect(enterprise.settingsAction('show-harness-log')).rejects.toThrow('fixture IPC failed')
  })

  it('passes only settings-close notifications and releases the listener', async () => {
    const { enterprise } = await loadPreload()
    const listener = vi.fn()
    const dispose = enterprise.onSettingsClose(listener)
    ipc.emit('enterprise-chat:close-settings', { sender: 'private-event' })
    expect(listener).toHaveBeenCalledExactlyOnceWith()
    dispose()
    expect(ipc.listenerCount('enterprise-chat:close-settings')).toBe(0)
    ipc.emit('enterprise-chat:close-settings', {})
    expect(listener).toHaveBeenCalledOnce()
    expect(() => enterprise.onSettingsClose(null)).toThrow('listener must be a function')
  })

  it('sanitizes settings-focus payloads and rejects unknown section or direction', async () => {
    const { enterprise } = await loadPreload()
    const listener = vi.fn()
    const dispose = enterprise.onSettingsFocus(listener)
    for (const value of [null, 42, 'next', {}, { section: 'unknown', direction: 'next' }, { section: 'my-tasks', direction: 'sideways' }]) {
      ipc.emit('enterprise-chat:settings-focus', {}, value)
    }
    expect(listener).not.toHaveBeenCalled()
    for (const section of ['desktop-usage', 'ai-access', 'my-tasks', 'my-requests', 'notifications']) {
      for (const direction of ['previous', 'next']) {
        ipc.emit('enterprise-chat:settings-focus', { sender: 'private-event' }, { section, direction, extra: 'ignored' })
        expect(listener).toHaveBeenLastCalledWith({ section, direction })
      }
    }
    expect(listener).toHaveBeenCalledTimes(10)
    dispose()
    expect(ipc.listenerCount('enterprise-chat:settings-focus')).toBe(0)
    expect(() => enterprise.onSettingsFocus(null)).toThrow('listener must be a function')
  })

  it('releases tools and state subscriptions without leaking Electron event objects', async () => {
    const { chat } = await loadPreload()
    const tools = vi.fn(), state = vi.fn()
    const unsubscribeTools = chat.onToolsChanged(tools)
    const unsubscribeState = chat.subscribe(state)
    const snapshot = { phase: 'ready', connected: true }
    ipc.emit('enterprise-chat:tools-changed', { sender: 'private-event' }, 'ignored')
    ipc.emit('enterprise-chat:changed', { sender: 'private-event' }, snapshot)
    expect(tools).toHaveBeenCalledExactlyOnceWith()
    expect(state).toHaveBeenCalledExactlyOnceWith(snapshot)
    unsubscribeTools(); unsubscribeState()
    expect(ipc.listenerCount('enterprise-chat:tools-changed')).toBe(0)
    expect(ipc.listenerCount('enterprise-chat:changed')).toBe(0)
    ipc.emit('enterprise-chat:tools-changed', {})
    ipc.emit('enterprise-chat:changed', {}, snapshot)
    expect(tools).toHaveBeenCalledOnce()
    expect(state).toHaveBeenCalledOnce()
    expect(() => chat.onToolsChanged(null)).toThrow('listener must be a function')
  })

  it('buffers login links, replays to late subscribers, consumes once and unsubscribes', async () => {
    const { enterprise } = await loadPreload()
    for (const value of [null, {}, 42]) ipc.emit('enterprise:login-link', {}, value)
    expect(enterprise.consumeLoginLink()).toBeUndefined()
    ipc.emit('enterprise:login-link', {}, 'bisheng://login/fixture')
    const listener = vi.fn()
    const dispose = enterprise.onLoginLink(listener)
    expect(listener).toHaveBeenCalledExactlyOnceWith('bisheng://login/fixture')
    expect(enterprise.consumeLoginLink()).toBe('bisheng://login/fixture')
    expect(enterprise.consumeLoginLink()).toBeUndefined()
    ipc.emit('enterprise:login-link', { sender: 'private-event' }, 'bisheng://login/next')
    expect(listener).toHaveBeenLastCalledWith('bisheng://login/next')
    dispose()
    ipc.emit('enterprise:login-link', {}, 'bisheng://login/after-unsubscribe')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(() => enterprise.onLoginLink(null)).toThrow('listener must be a function')
  })
})
