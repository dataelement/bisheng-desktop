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
        this.webContents = Object.assign(new EventEmitter(), { session: options.webPreferences.session, isDestroyed: () => false, setWindowOpenHandler: vi.fn(), mainFrame: {}, getURL: () => url, close: vi.fn(), executeJavaScript: vi.fn(async () => {}), insertCSS: vi.fn(async () => 'key'), loadURL: vi.fn(async (next) => { url = next; this.webContents.emit('did-finish-load') }) })
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
  const owner: any = Object.assign(new EventEmitter(), { isDestroyed: () => false, getContentSize: () => [1100, 800], contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: Object.assign(new EventEmitter(), { send: vi.fn(), focus: vi.fn(), getZoomFactor: () => 1 }) })
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
      expect(fake.views[0].options.webPreferences.preload).toMatch(/enterprise-chat\.cjs$/u)
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
    for (const locale of ['ja', 'zh-Hans', '', 0, null, { value: 'zh' }]) {
      expect(() => parseChatPresentation({ ...presentation, locale })).toThrow('locale')
    }
  })
})

it('carries host language on first load and updates a hidden document without reloading it', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, { ...presentation, locale: 'zh' })
    await flush()
    const view = fake.views[0]
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark&dshLocale=zh')
    view.setBounds.mockClear()
    f.host.present(f.owner, { ...presentation, visible: false, locale: 'en' })
    expect(view.webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('dshHostLocale = "en"'))
    expect(view.setBounds).not.toHaveBeenCalled()
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    await f.host.open('new')
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/c/new?embed=dsh&dshTheme=dark&dshLocale=en')
    const loads = view.webContents.loadURL.mock.calls.length
    await f.host.open('new')
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads)
    view.webContents.executeJavaScript.mockClear()
    view.webContents.emit('did-navigate-in-page', {}, 'https://enterprise.example/workspace/c/new', true)
    expect(view.webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('dshHostLocale = "en"'))
  } finally { f.host.dispose() }
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

it('fills the conversation area when the new-conversation picker closes', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    f.host.present(f.owner, { ...presentation, bounds: { x: 280, y: 0, width: 820, height: 800 } })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 280, y: 0, width: 820, height: 800 })
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(fake.views).toHaveLength(1)
  } finally { f.host.dispose() }
})

it('pushes landing state from the current remote main frame and rejects stale or foreign presentation reports', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const wc = fake.views[0].webContents
    await wc.loadURL('https://enterprise.example/workspace/c/new')
    const report = (frame: unknown, input: unknown) => wc.emit('ipc-message', { senderFrame: frame }, 'enterprise-chat:landing', input)
    report(wc.mainFrame, { landing: false, path: '/workspace/c/new' })
    expect(f.host.snapshot()).toMatchObject({ landing: false, conversationId: 'new' })
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ landing: false }))
    report({}, { landing: true, path: '/workspace/c/new' })
    report(wc.mainFrame, { landing: true, path: '/workspace/c/old' })
    report(wc.mainFrame, { landing: 'true', path: '/workspace/c/new' })
    expect(f.host.snapshot().landing).toBe(false)
    report(wc.mainFrame, { landing: true, path: '/workspace/c/new' })
    expect(f.host.snapshot().landing).toBe(true)
    f.change({ connected: false, connectionKey: 'tenant-a' })
    report(wc.mainFrame, { landing: false, path: '/workspace/c/new' })
    expect(f.host.snapshot().landing).toBeUndefined()
  } finally { f.host.dispose() }
})

it('opens only account-published module entries and clears them with the identity', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0].webContents
    const report = { path: '/workspace/', navigation: { entries: [{ id: 'knowledge', label: 'Knowledge', path: '/knowledge', primary: true, active: false }] } }
    view.emit('ipc-message', { senderFrame: {} }, 'enterprise-chat:navigation', report)
    await expect(f.host.openPage('knowledge')).rejects.toThrow('unavailable')
    view.emit('ipc-message', { senderFrame: view.mainFrame }, 'enterprise-chat:navigation', report)
    await f.host.openPage('knowledge')
    expect(view.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/knowledge?embed=dsh&dshTheme=dark')
    await expect(f.host.openPage('skills')).rejects.toThrow('unavailable')
    await expect(f.host.openPage('../admin')).rejects.toThrow()
    const count = view.loadURL.mock.calls.length
    await f.host.openPage('knowledge')
    expect(view.loadURL).toHaveBeenCalledTimes(count)
    f.change({ connected: false, connectionKey: 'tenant-a' })
    expect(f.host.snapshot().navigation).toBeUndefined()
    await expect(f.host.openPage('knowledge')).rejects.toThrow('unavailable')
  } finally { f.host.dispose() }
})

it('installs the host module stylesheet and theme script once the document is ready', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    expect(view.webContents.insertCSS).toHaveBeenCalledWith(expect.stringContaining('html.dsh-module-dark'))
    const script = view.webContents.executeJavaScript.mock.calls.at(-1)?.[0] as string
    expect(script).toContain("root.dataset.dshHostTheme = 'dark'")
    expect(script).toContain('new MutationObserver(apply)')
  } finally { f.host.dispose() }
})

it('turns a stalled module navigation into a rejected open instead of a document pinned in loading', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    expect(f.host.snapshot().phase).toBe('ready')
    view.webContents.loadURL.mockImplementation(() => new Promise<void>(() => {}))
    const pending = f.host.open('new')
    const outcome = expect(pending).rejects.toThrow('timed out')
    await flush()
    expect(f.host.snapshot().phase).toBe('loading')
    await vi.advanceTimersByTimeAsync(45_000)
    await outcome
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('fails the session exchange when the first document load stalls, so Reconnect becomes available', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const note = vi.fn()
  const host = new EnterpriseChatView(f.enterprise as any, note)
  try {
    host.present(f.owner, presentation)
    // The view exists after the web-session exchange resolves; its first document load then hangs.
    await Promise.resolve()
    const view = fake.views[0]
    view.webContents.loadURL.mockImplementation(() => new Promise<void>(() => {}))
    await flush()
    await vi.advanceTimersByTimeAsync(45_000)
    await flush()
    expect(host.snapshot().phase).toBe('error')
    expect(note).toHaveBeenCalledWith('[enterprise-chat] session_failed status=timeout')
  } finally { host.dispose(); vi.useRealTimers() }
})

it('opens content-only settings, waits for the current main frame and restores the previous page', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.open('new')
    const view = fake.views[0], wc = view.webContents
    f.host.present(f.owner, { ...presentation, settings: 'account' })
    await flush()
    expect(wc.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/settings/account?dshSettings=1&embed=dsh&dshTheme=dark')
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    const report = (frame: unknown, section: string, path = '/workspace/settings/account') => wc.emit('ipc-message', { senderFrame: frame }, 'enterprise-chat:settings-ready', { section, path })
    report({}, 'account')
    report(wc.mainFrame, 'notifications')
    report(wc.mainFrame, 'account', '/workspace/settings/notifications')
    expect(f.host.snapshot().settingsReady).toBe(false)
    report(wc.mainFrame, 'account')
    expect(f.host.snapshot()).toMatchObject({ settingsSection: 'account', settingsReady: true })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:settings-close', { path: '/workspace/settings/account' })
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:close-settings')
    f.host.present(f.owner, { ...presentation, visible: false })
    await flush()
    expect(wc.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/c/new?embed=dsh&dshTheme=dark')
    f.host.present(f.owner, presentation)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(fake.views).toHaveLength(1)
    expect(f.host.snapshot().settingsSection).toBeUndefined()
  } finally { f.host.dispose() }
})

it('restricts settings navigation and rejects stale readiness after an identity change', async () => {
  for (const settings of ['general', '../admin', 'https://other.example/', '', 4, null]) {
    expect(() => parseChatPresentation({ ...presentation, settings })).toThrow('settings')
  }
  const f = fixture()
  try {
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
    await flush()
    const wc = fake.views[0].webContents
    expect(wc.loadURL).toHaveBeenLastCalledWith(expect.stringContaining('/workspace/settings/desktop-usage?dshSettings=1'))
    f.change({ connected: false, connectionKey: 'tenant-a' })
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:settings-ready', { section: 'desktop-usage', path: '/workspace/settings/desktop-usage' })
    expect(f.host.snapshot()).toMatchObject({ connected: false, settingsReady: false })
    expect(f.host.snapshot().settingsSection).toBeUndefined()
  } finally { f.host.dispose() }
})

it('hides settings when the ready document navigates away and requires a new report after reload', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, { ...presentation, settings: 'account' })
    await flush()
    const view = fake.views[0], wc = view.webContents
    wc.focus = vi.fn()
    const ready = () => wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:settings-ready', { section: 'account', path: '/workspace/settings/account' })
    expect(f.host.snapshot().settingsProtocolVersion).toBe(1)
    ready()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    await wc.loadURL('https://enterprise.example/workspace/knowledge/space/example')
    wc.emit('did-navigate-in-page', {}, wc.getURL(), true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.host.snapshot().settingsReady).toBe(false)
    f.host.focusSettings()
    expect(wc.focus).not.toHaveBeenCalled()
    await wc.loadURL('https://enterprise.example/workspace/settings/account?dshSettings=1')
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    ready()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    wc.emit('did-start-navigation', {}, wc.getURL(), false, true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.host.snapshot().settingsReady).toBe(false)
  } finally { f.host.dispose() }
})

it('leaves failed remote settings without blocking the original conversation', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.open('new')
    const view = fake.views[0]
    view.webContents.loadURL.mockRejectedValueOnce(Object.assign(new Error('Settings unavailable'), { code: 'ERR_CONNECTION_RESET' }))
    f.host.present(f.owner, { ...presentation, settings: 'account' })
    await flush()
    expect(f.host.snapshot().settingsFailure).toBe('load')
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('ready')
    expect(f.host.snapshot().settingsSection).toBeUndefined()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  } finally { f.host.dispose() }
})

it('pushes connection failures and logout to mounted settings without waiting for a poll', async () => {
  const f = fixture()
  try {
    f.enterprise.webSession.mockRejectedValueOnce(new Error('Temporary connection failure'))
    f.host.present(f.owner, { ...presentation, settings: 'account' })
    await flush()
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ phase: 'error' }))
    f.host.retry()
    await flush()
    expect(f.host.snapshot().phase).toBe('ready')
    f.change({ connected: false, connectionKey: 'tenant-a' })
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ connected: false, settingsReady: false }))
  } finally { f.host.dispose() }
})


it('delivers welcome motion once on pointer-driven Chat entry', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0].webContents
    const motions = () => view.executeJavaScript.mock.calls.filter(([script]: [string]) => script.includes('dsh:welcome-enter'))
    f.host.present(f.owner, { ...presentation, visible: false })
    f.host.present(f.owner, { ...presentation, welcomeMotion: true })
    f.host.present(f.owner, { ...presentation, welcomeMotion: true })
    expect(motions()).toHaveLength(1)
    f.host.present(f.owner, { ...presentation, visible: false })
    f.host.present(f.owner, { ...presentation, welcomeMotion: false })
    expect(motions()).toHaveLength(1)
    expect(() => parseChatPresentation({ ...presentation, welcomeMotion: 'yes' })).toThrow()
  } finally { f.host.dispose() }
})
