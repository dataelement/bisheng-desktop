import { beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ windows: [] as any[], loadFailure: false }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    shell: { openExternal: vi.fn(async () => {}) },
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      minimized = false
      webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
      loadURL = vi.fn(async () => { if (fake.loadFailure) throw new Error('ERR_CONNECTION_REFUSED') })
      focus = vi.fn()
      restore = vi.fn(() => { this.minimized = false })
      isMinimized = () => this.minimized
      isDestroyed = () => this.destroyed
      close = vi.fn(() => { this.destroyed = true; this.emit('closed') })
      constructor(public options: any) { super(); fake.windows.push(this) }
    }
  }
})
import { shell } from 'electron'
import { HostedAppWindows } from '../src/main/enterprise/hosted-app-window'
import { hostedAppTarget } from '../src/main/enterprise/hosted-app-url'

const origin = 'https://enterprise.test'
const pageSession = { id: 'hosted-app-session' }
function windows(overrides: Partial<ConstructorParameters<typeof HostedAppWindows>[0]> = {}) {
  const note = vi.fn()
  const prepare = vi.fn()
  const acquire = vi.fn(async () => ({ session: pageSession as never, origin, connectionKey: 'a'.repeat(16) }))
  return { controller: new HostedAppWindows({ acquire, prepare, note, ...overrides }), note, prepare, acquire }
}
function window(index: number) { const value = fake.windows[index]; if (!value) throw new Error('Missing window'); return value }
beforeEach(() => { fake.windows.length = 0; fake.loadFailure = false; vi.mocked(shell.openExternal).mockClear() })

it.each([
  ['https://enterprise.test/apps/board', { slug: 'board', url: 'https://enterprise.test/apps/board' }],
  ['https://enterprise.test/apps/board/', { slug: 'board', url: 'https://enterprise.test/apps/board/' }],
  ['https://enterprise.test/apps/team-9/records?x=1', { slug: 'team-9', url: 'https://enterprise.test/apps/team-9/records?x=1' }],
  ['https://enterprise.test/apps-admin/board', undefined],
  ['https://enterprise.test/apps/', undefined],
  ['https://enterprise.test/apps/Board', undefined],
  ['https://enterprise.test/workspace/apps', undefined],
  ['https://elsewhere.test/apps/board', undefined],
  ['javascript:alert(1)', undefined],
  ['not a url', undefined]
])('recognizes hosted app addresses only on the enterprise origin: %s', (url, expected) => {
  expect(hostedAppTarget(url, origin)).toEqual(expected)
})

it('opens a hosted app in its own sandboxed window with the user\'s web login', async () => {
  const f = windows()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  expect(fake.windows).toHaveLength(1)
  expect(window(0).options.webPreferences).toMatchObject({ session: pageSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
  expect(window(0).loadURL).toHaveBeenCalledExactlyOnceWith('https://enterprise.test/apps/board')
  expect(f.prepare).toHaveBeenCalledExactlyOnceWith(window(0))
})

it('brings an already open app forward instead of opening it twice', async () => {
  const f = windows()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  window(0).minimized = true
  await f.controller.open('https://enterprise.test/apps/board/', origin)
  expect(fake.windows).toHaveLength(1)
  expect(window(0).restore).toHaveBeenCalledOnce()
  expect(window(0).focus).toHaveBeenCalledOnce()
  window(0).close()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  expect(fake.windows).toHaveLength(2)
})

it.each([
  ['a path that is not a hosted app', 'https://enterprise.test/workspace/', origin],
  ['another enterprise', 'https://elsewhere.test/apps/board', 'https://elsewhere.test'],
  ['an origin that differs from the signed session', 'https://enterprise.test/apps/board', 'https://enterprise.test:8443']
])('refuses %s', async (_case, url, from) => {
  const f = windows()
  await expect(f.controller.open(url, from)).rejects.toThrow('Not a hosted application')
  expect(fake.windows).toHaveLength(0)
})

it('falls back to the system browser when an in-app open fails', () => {
  const f = windows()
  f.controller.fail('https://enterprise.test/apps/board', new Error('Enterprise login required.'))
  expect(f.note).toHaveBeenCalledWith('[hosted-app] open_failed Enterprise login required.')
  expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://enterprise.test/apps/board')
})

it('keeps links inside an app on the enterprise and sends other sites to the browser', async () => {
  const f = windows()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  const contents = window(0).webContents
  const handler = contents.setWindowOpenHandler.mock.calls[0][0]
  expect(handler({ url: 'https://enterprise.test/apps/other/' })).toEqual({ action: 'deny' })
  await vi.waitFor(() => expect(fake.windows).toHaveLength(2))
  expect(handler({ url: 'https://docs.example/help' })).toEqual({ action: 'deny' })
  expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://docs.example/help')

  const stay = { preventDefault: vi.fn() }
  contents.emit('will-navigate', stay, 'https://enterprise.test/workspace/login?redirect=%2Fapps%2Fboard')
  expect(stay.preventDefault).not.toHaveBeenCalled()
  const leave = { preventDefault: vi.fn() }
  contents.emit('will-navigate', leave, 'https://docs.example/next')
  expect(leave.preventDefault).toHaveBeenCalledOnce()
  expect(shell.openExternal).toHaveBeenLastCalledWith('https://docs.example/next')
  const redirect = { preventDefault: vi.fn() }
  contents.emit('will-redirect', redirect, 'https://sso.example/authorize')
  expect(redirect.preventDefault).toHaveBeenCalledOnce()
  expect(shell.openExternal).toHaveBeenCalledTimes(2)
  const webview = { preventDefault: vi.fn() }
  contents.emit('will-attach-webview', webview)
  expect(webview.preventDefault).toHaveBeenCalledOnce()
})

it('closes every app window when the account ends', async () => {
  const f = windows()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  await f.controller.open('https://enterprise.test/apps/other', origin)
  f.controller.closeAll()
  expect(window(0).close).toHaveBeenCalledOnce()
  expect(window(1).close).toHaveBeenCalledOnce()
  await f.controller.open('https://enterprise.test/apps/board', origin)
  expect(fake.windows).toHaveLength(3)
})

it('keeps the window and its error page when the app fails to load', async () => {
  fake.loadFailure = true
  const f = windows()
  await expect(f.controller.open('https://enterprise.test/apps/board', origin)).resolves.toBeUndefined()
  expect(window(0).destroyed).toBe(false)
  expect(f.note).toHaveBeenCalledWith('[hosted-app] load_failed ERR_CONNECTION_REFUSED')
})

it('does not open a window when the web login cannot be signed', async () => {
  const f = windows({ acquire: vi.fn(async () => { throw new Error('Enterprise login required.') }) })
  await expect(f.controller.open('https://enterprise.test/apps/board', origin)).rejects.toThrow('Enterprise login required.')
  expect(fake.windows).toHaveLength(0)
})
