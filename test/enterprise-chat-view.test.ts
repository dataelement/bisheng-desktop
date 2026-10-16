import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseChatView } from '../src/main/enterprise/chat-view'
import { parseChatPresentation } from '../src/shared/enterprise-chat-view'
import { parseWebSession } from '../src/main/enterprise/web-session'

const fake = vi.hoisted(() => ({ views: [] as any[], sessions: [] as any[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    session: { fromPartition: () => {
      const isolated = { fetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ chat_id: 'cloud-a', name: 'Cloud A', flow_type: 15, update_time: '2026-10-16' }] }) })), cookies: { set: vi.fn(async () => {}) }, clearStorageData: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
      fake.sessions.push(isolated)
      return isolated
    } },
    shell: { openExternal: vi.fn(async () => {}) },
    WebContentsView: class {
      webContents: any
      setBounds = vi.fn()
      setVisible = vi.fn()
      setBackgroundColor = vi.fn()
      constructor(public options: any) {
        let url = ''
        this.webContents = Object.assign(new EventEmitter(), { session: options.webPreferences.session, isDestroyed: () => false, setWindowOpenHandler: vi.fn(), getURL: () => url, close: vi.fn(), executeJavaScript: vi.fn(async () => {}), loadURL: vi.fn(async (next) => { url = next; this.webContents.emit('did-finish-load') }) })
        fake.views.push(this)
      }
    }
  }
})

afterEach(() => { fake.views.length = 0; fake.sessions.length = 0 })
const presentation = { visible: true, theme: 'dark', bounds: { x: 0, y: 56, width: 1100, height: 700 } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  let state = { connected: true, connectionKey: 'tenant-a' }
  let change: (state: any) => void = () => {}
  const enterprise = { snapshot: () => state, subscribe: (listener: typeof change) => { change = listener; return vi.fn() }, webSession: vi.fn(async () => ({ base: 'https://enterprise.example', cookie: 'test-cookie', connectionKey: 'tenant-a', expiresAt: Date.now() + 300_000 })) }
  const owner: any = Object.assign(new EventEmitter(), { isDestroyed: () => false, getContentSize: () => [1100, 800], contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1 }) })
  const host = new EnterpriseChatView(enterprise as any, vi.fn())
  return { host, owner, enterprise, change: (next: typeof state) => { state = next; change(next) } }
}

describe('enterprise Chat host boundary', () => {
  it('sets a host-only cookie before loading Chat and keeps Work switches reversible', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      expect(f.host.snapshot().phase).toBe('ready')
      expect(fake.views[0].options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true })
      expect(fake.views[0].options.webPreferences.preload).toBeUndefined()
      expect(fake.sessions[0].cookies.set).toHaveBeenCalledWith(expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true, name: 'access_token_cookie' }))
      expect(fake.views[0].webContents.loadURL).toHaveBeenCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark')
      f.host.present(f.owner, { ...presentation, visible: false })
      expect(fake.views[0].setVisible).toHaveBeenLastCalledWith(false)
      f.host.present(f.owner, presentation)
      expect(fake.views).toHaveLength(1)
      expect(fake.views[0].setVisible).toHaveBeenLastCalledWith(true)
      f.change({ connected: false, connectionKey: 'tenant-a' })
      await flush()
      expect(fake.views[0].webContents.close).toHaveBeenCalledOnce()
      expect(fake.sessions[0].clearStorageData).toHaveBeenCalledOnce()
    } finally { f.host.dispose() }
  })

  it('discards an exchange finishing after logout', async () => {
    const f = fixture()
    let finish!: (value: any) => void
    f.enterprise.webSession.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    try {
      f.host.present(f.owner, presentation)
      f.change({ connected: false, connectionKey: 'tenant-a' })
      finish({ base: 'https://enterprise.example', cookie: 'stale', expiresAt: Date.now() + 300_000 })
      await flush()
      expect(fake.views).toHaveLength(0)
      expect(f.host.snapshot().connected).toBe(false)
    } finally { f.host.dispose() }
  })

  it('rejects malformed geometry and long-lived server credentials', () => {
    expect(() => parseChatPresentation({ ...presentation, bounds: { ...presentation.bounds, width: NaN } })).toThrow()
    expect(() => parseWebSession({ cookie: 'a'.repeat(40), expires_in: 3600 }, 'https://enterprise.example', 'a')).toThrow()
  })
})

it('reads cloud history through a fixed host endpoint and validates selection against that identity', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const list = await f.host.history(1)
    expect(list.items[0]).toMatchObject({ id: 'cloud-a', title: 'Cloud A' })
    expect(fake.sessions[0].fetch).toHaveBeenCalledWith('https://enterprise.example/api/v1/chat/list?page=1&limit=40', expect.objectContaining({ redirect: 'error' }))
    await f.host.open('cloud-a')
    expect(fake.views[0].webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/c/cloud-a?embed=dsh&dshTheme=dark')
    const calls = fake.views[0].webContents.loadURL.mock.calls.length
    await f.host.open('cloud-a')
    expect(fake.views[0].webContents.loadURL.mock.calls).toHaveLength(calls)
    await expect(f.host.open('unknown')).rejects.toThrow()
    await expect(f.host.open('../admin')).rejects.toThrow()
    await expect(f.host.history(-1)).rejects.toThrow()
    let finish!: (value: any) => void
    fake.sessions[0].fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const stale = f.host.history(1)
    f.change({ connected: false, connectionKey: 'tenant-a' })
    finish({ ok: true, json: async () => ({ data: [{ chat_id: 'stale' }] }) })
    await expect(stale).rejects.toThrow('identity changed')
  } finally { f.host.dispose() }
})

it('uses in-document conversation navigation and preserves view geometry while Work is visible', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.history(1)
    const view = fake.views[0]
    view.webContents.executeJavaScript.mockResolvedValue(true)
    view.setBounds.mockClear()
    view.setBackgroundColor.mockClear()
    f.host.present(f.owner, { ...presentation, visible: false, theme: 'light', bounds: { x: 0, y: 48, width: 0, height: 0 } })
    expect(view.setBounds).not.toHaveBeenCalled()
    expect(view.setBackgroundColor).not.toHaveBeenCalled()
    f.host.present(f.owner, presentation)
    await f.host.open('cloud-a')
    expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("dsh:navigate"))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.views).toHaveLength(1)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  } finally { f.host.dispose() }
})

it('discards a navigation completion after the enterprise identity changes', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.history(1)
    const view = fake.views[0]
    let finish!: (accepted: boolean) => void
    view.webContents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.host.open('cloud-a')
    f.change({ connected: false, connectionKey: 'tenant-a' })
    finish(false)
    await pending
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(f.host.snapshot().connected).toBe(false)
  } finally { f.host.dispose() }
})
