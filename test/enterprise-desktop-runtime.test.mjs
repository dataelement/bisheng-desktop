import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root = '../packages/dsh-desktop-enterprise/desktop/'
const context = { userDataPath: '/fixture/product', dshHome: '/fixture/product/harness', safeMode: false, version: '1.2.3' }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fakeWindow(url = 'dsh-app://app/') {
  const window = new EventEmitter()
  const contents = new EventEmitter()
  Object.assign(contents, { mainFrame: { url }, getURL: () => contents.mainFrame.url, send: vi.fn() })
  return Object.assign(window, { webContents: contents, isDestroyed: vi.fn(() => false), show: vi.fn(), focus: vi.fn() })
}
const eventFor = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame })

let createRuntime, mocks, runtimes
beforeEach(async () => {
  vi.resetModules()
  runtimes = []
  const app = Object.assign(new EventEmitter(), { getAppPath: vi.fn(() => '/fixture/app') })
  const handlers = new Map()
  const views = []
  const environment = { DSH_DESKTOP_ENTERPRISE_BROKER_URL: 'http://127.0.0.1:1', DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY: 'test-only-capability' }
  const desktop = { harnessEnvironment: vi.fn(() => ({ ...environment })), stop: vi.fn(async () => {}) }
  const start = vi.fn(async () => desktop)
  const ipcMain = {
    handle: vi.fn((channel, handler) => { if (handlers.has(channel)) throw new Error('duplicate handler'); handlers.set(channel, handler) }),
    removeHandler: vi.fn(channel => handlers.delete(channel))
  }
  class Chat {
    constructor(...args) { this.args = args; views.push(this) }
    snapshot = vi.fn(() => ({ phase: 'ready', connected: true, epoch: 3 }))
    present = vi.fn((_window, presentation) => ({ phase: 'ready', presentation }))
    capture = vi.fn(async () => ({ dataURL: 'fixture-frame' }))
    retry = vi.fn()
    usage = vi.fn(async () => ({ used: 2 }))
    history = vi.fn(async page => ({ page }))
    open = vi.fn(async () => {})
    openPage = vi.fn(async () => {})
    remove = vi.fn(async () => ({ epoch: 4 }))
    rename = vi.fn(async () => {})
    projectsState = vi.fn(() => ({ epoch: 3 }))
    projectAction = vi.fn(async () => ({}))
    projectConversations = vi.fn(async () => ({}))
    focusSettings = vi.fn()
    dispose = vi.fn()
  }
  const parseLink = vi.fn(async value => ({ url: value }))
  const argvLink = vi.fn(async () => undefined)
  const protocol = vi.fn()
  const harnessVersion = vi.fn(() => '0.2.2-test')
  vi.doMock('electron', () => ({ app, ipcMain, net: { fetch: vi.fn() }, safeStorage: {} }))
  vi.doMock(root + 'enterprise-desktop', () => ({ startEnterpriseDesktop: start }))
  vi.doMock(root + 'chat-view', () => ({ EnterpriseChatView: Chat }))
  vi.doMock(root + 'platform-fetch', () => ({ createElectronEnterpriseFetch: () => vi.fn() }))
  vi.doMock(root + 'login-link', () => ({ allowInsecureEnterpriseLoopback: () => false, enterpriseLoginFromArgv: argvLink, parseEnterpriseLoginLink: parseLink, registerEnterpriseLoginProtocol: protocol }))
  vi.doMock('../src/main/version-info', () => ({ bundledHarnessVersion: harnessVersion }))
  createRuntime = (await import('../packages/dsh-desktop-enterprise/desktop/runtime')).createEnterpriseProductRuntime
  mocks = { app, handlers, views, desktop, start, ipcMain, environment, argvLink, parseLink, protocol, harnessVersion }
})
afterEach(async () => {
  for (const runtime of runtimes) await runtime.dispose()
  mocks.app.removeAllListeners()
  vi.restoreAllMocks()
})

async function startRuntime(overrides = {}) {
  const runtime = await createRuntime({ ...context, ...overrides })
  runtimes.push(runtime)
  return runtime
}
function handler(channel) {
  const callback = mocks.handlers.get(channel)
  if (!callback) throw new Error('Missing IPC handler: ' + channel)
  return callback
}
function attach(runtime, window = fakeWindow()) {
  const actions = { checkForUpdates: vi.fn(async () => {}), showLogs: vi.fn(async () => {}), restartInSafeMode: vi.fn() }
  runtime.attachWindow(window, actions)
  return { window, actions, event: eventFor(window) }
}

describe('enterprise desktop product runtime', () => {
  it('awaits broker initialization and returns Host environment without mutating process.env', async () => {
    const started = deferred()
    mocks.start.mockReturnValue(started.promise)
    const before = { ...process.env }
    let completed = false
    const pending = startRuntime().then(runtime => { completed = true; return runtime })
    await tick()
    expect(completed).toBe(false)
    expect(mocks.handlers.size).toBe(0)
    started.resolve(mocks.desktop)
    const runtime = await pending
    expect(completed).toBe(true)
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ userDataPath: context.userDataPath, desktopVersion: context.version }))
    expect(Object.keys(runtime.hostEnvironment()).sort()).toEqual(Object.keys(mocks.environment).sort())
    expect(runtime.hostEnvironment().DSH_DESKTOP_ENTERPRISE_BROKER_URL).toBe(mocks.environment.DSH_DESKTOP_ENTERPRISE_BROKER_URL)
    // Assert booleans so failures cannot print the caller's real environment values.
    expect(JSON.stringify(process.env) === JSON.stringify(before)).toBe(true)
    const { window } = attach(runtime)
    mocks.start.mock.calls[0][0].activateDesktop()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it.each(['DSH_DESKTOP_ENTERPRISE_BROKER_URL', 'DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY'])('rejects a missing %s and stops the partial runtime', async key => {
    delete mocks.environment[key]
    await expect(createRuntime(context)).rejects.toThrow('broker failed to initialize')
    expect(mocks.desktop.stop).toHaveBeenCalledOnce()
    expect(mocks.handlers.size).toBe(0)
    expect(mocks.protocol).not.toHaveBeenCalled()
  })

  it('propagates startup failure without registering IPC', async () => {
    mocks.start.mockRejectedValue(new Error('fixture startup failed'))
    await expect(createRuntime(context)).rejects.toThrow('fixture startup failed')
    expect(mocks.handlers.size).toBe(0)
  })

  it('awaits login initialization and rolls back handlers if it fails', async () => {
    const login = deferred()
    mocks.argvLink.mockReturnValue(login.promise)
    let completed = false
    const pending = startRuntime().then(runtime => { completed = true; return runtime })
    await tick()
    expect(completed).toBe(false)
    login.resolve(undefined)
    await pending
    expect(completed).toBe(true)
  })

  it('cleans registered handlers and stops runtime when setup fails after broker startup', async () => {
    mocks.argvLink.mockRejectedValue(new Error('fixture login initialization failed'))
    await expect(createRuntime(context)).rejects.toThrow('fixture login initialization failed')
    expect(mocks.handlers.size).toBe(0)
    expect(mocks.desktop.stop).toHaveBeenCalledOnce()
  })

  it('starts no broker, creates no view and registers no IPC in Safe Mode', async () => {
    const runtime = await startRuntime({ safeMode: true })
    expect(runtime.hostEnvironment()).toEqual({})
    attach(runtime)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.handlers.size).toBe(0)
    expect(mocks.views).toHaveLength(0)
    expect(mocks.protocol).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(mocks.desktop.stop).not.toHaveBeenCalled()
  })

  it('requires an explicitly attached main window before serving any IPC', async () => {
    await startRuntime()
    const stranger = fakeWindow()
    for (const [channel, callback] of mocks.handlers) {
      await expect(Promise.resolve().then(() => callback(eventFor(stranger), 'safe-mode'))).rejects.toThrow('unowned window or frame')
    }
    expect(mocks.views).toHaveLength(0)
  })

  it('accepts the attached application main frame and rejects other windows, subframes and origins', async () => {
    const runtime = await startRuntime()
    const { window, event } = attach(runtime)
    const state = handler('enterprise-chat:state')
    expect(state(event)).toEqual({ phase: 'ready', connected: true, epoch: 3 })
    const foreign = fakeWindow()
    for (const bad of [eventFor(foreign), { sender: window.webContents, senderFrame: null }, { sender: window.webContents, senderFrame: { url: 'dsh-app://app/' } }]) {
      expect(() => state(bad)).toThrow('unowned window or frame')
    }
    for (const url of ['https://app/', 'dsh-app://other/', 'dsh-app://app:99/', 'dsh-app://fixture@app/']) {
      window.webContents.mainFrame.url = url
      expect(() => state(event)).toThrow('untrusted application origin')
    }
    window.webContents.mainFrame.url = 'dsh-app://app/'
    window.isDestroyed.mockReturnValue(true)
    expect(() => state(event)).toThrow('unowned window or frame')
    expect(mocks.views[0].snapshot).toHaveBeenCalledOnce()
  })

  it('routes each named chat operation and its arguments to the attached view', async () => {
    const runtime = await startRuntime()
    const { window, event } = attach(runtime)
    const chat = mocks.views[0]
    const presentation = { visible: true }
    const rows = [
      ['present', [presentation], [window, presentation]], ['capture', [], [window]], ['retry', [], []], ['usage', [], []],
      ['history', [2], [2]], ['open-page', ['page'], ['page']], ['open', ['conversation', 'project'], ['conversation', 'project']],
      ['remove', ['conversation', 3], ['conversation', 3]], ['rename', ['conversation', 'Title', 3], ['conversation', 'Title', 3]],
      ['projects-state', [], []], ['project-action', [{ kind: 'select' }, 3], [{ kind: 'select' }, 3]],
      ['project-conversations', [2, 3], [2, 3]], ['focus-settings', [], []]
    ]
    const method = { 'open-page': 'openPage', 'projects-state': 'projectsState', 'project-action': 'projectAction', 'project-conversations': 'projectConversations', 'focus-settings': 'focusSettings' }
    for (const [channel, args, expected] of rows) {
      await handler('enterprise-chat:' + channel)(event, ...args)
      expect(chat[method[channel] ?? channel]).toHaveBeenLastCalledWith(...expected)
    }
  })

  it('returns product versions and permits only the three settings actions', async () => {
    const runtime = await startRuntime()
    const { event, actions } = attach(runtime)
    expect(handler('enterprise:settings-info')(event)).toEqual({ desktopVersion: context.version, harnessVersion: '0.2.2-test' })
    expect(mocks.harnessVersion).toHaveBeenCalledWith('/fixture/app')
    const action = handler('enterprise:settings-action')
    await action(event, 'check-for-updates')
    await action(event, 'show-harness-log')
    await action(event, 'safe-mode')
    expect(actions.checkForUpdates).toHaveBeenCalledOnce()
    expect(actions.showLogs).toHaveBeenCalledOnce()
    expect(actions.restartInSafeMode).toHaveBeenCalledOnce()
    for (const value of ['install', '', {}, null, 42]) await expect(action(event, value)).rejects.toThrow('Invalid Desktop settings action')
    expect(actions.checkForUpdates).toHaveBeenCalledOnce()
    actions.showLogs.mockRejectedValueOnce(new Error('fixture action failed'))
    await expect(action(event, 'show-harness-log')).rejects.toThrow('fixture action failed')
  })

  it('does not adopt windows from Electron creation events and reattaches only explicitly', async () => {
    const runtime = await startRuntime()
    const first = attach(runtime)
    const other = fakeWindow()
    mocks.app.emit('browser-window-created', {}, other)
    expect(mocks.views).toHaveLength(1)
    expect(() => handler('enterprise-chat:state')(eventFor(other))).toThrow()
    attach(runtime, other)
    expect(mocks.views[0].dispose).toHaveBeenCalledOnce()
    expect(first.window.listenerCount('closed')).toBe(0)
    expect(first.window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(() => handler('enterprise-chat:state')(first.event)).toThrow()
    expect(handler('enterprise-chat:state')(eventFor(other)).phase).toBe('ready')
    attach(runtime, other)
    expect(mocks.views).toHaveLength(2)
  })

  it('disposes views on window close and rejects calls until another window is attached', async () => {
    const runtime = await startRuntime()
    const { window, event } = attach(runtime)
    window.emit('closed')
    expect(mocks.views[0].dispose).toHaveBeenCalledOnce()
    expect(() => handler('enterprise-chat:state')(event)).toThrow('unowned window or frame')
    expect(mocks.desktop.stop).not.toHaveBeenCalled()
    attach(runtime)
    expect(mocks.views).toHaveLength(2)
  })

  it('removes owned IPC and listeners, rejects retained handlers and stops once on disposal', async () => {
    const runtime = await startRuntime()
    const { window, event, actions } = attach(runtime)
    const state = handler('enterprise-chat:state')
    const action = handler('enterprise:settings-action')
    await runtime.dispose()
    expect(mocks.handlers.size).toBe(0)
    expect(window.listenerCount('closed')).toBe(0)
    expect(window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(mocks.views[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.desktop.stop).toHaveBeenCalledOnce()
    expect(runtime.hostEnvironment()).toEqual({})
    expect(() => state(event)).toThrow('stopping')
    await expect(action(event, 'safe-mode')).rejects.toThrow('stopping')
    expect(() => runtime.attachWindow(window, actions)).toThrow('stopping')
    await runtime.dispose()
    expect(mocks.desktop.stop).toHaveBeenCalledOnce()
  })

  it('queues login links until a trusted application page is attached, then releases once', async () => {
    const runtime = await startRuntime()
    const preventDefault = vi.fn()
    mocks.app.emit('open-url', { preventDefault }, 'bisheng://login/fixture')
    await tick()
    const window = fakeWindow('file:///fixture/splash.html')
    attach(runtime, window)
    expect(window.webContents.send).not.toHaveBeenCalled()
    window.webContents.mainFrame.url = 'dsh-app://app/'
    window.webContents.emit('did-finish-load')
    expect(window.webContents.send).toHaveBeenCalledWith('enterprise:login-link', 'bisheng://login/fixture')
    window.webContents.emit('did-finish-load')
    expect(window.webContents.send).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
    await runtime.dispose()
    mocks.app.emit('open-url', { preventDefault }, 'bisheng://login/next')
    await tick()
    expect(window.webContents.send).toHaveBeenCalledOnce()
  })
})
