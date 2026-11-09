import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseChatView } from '../src/main/enterprise/chat-view'
import { EnterprisePlatformError } from '../src/main/enterprise/enterprise-request'
import { parseChatPresentation } from '../src/shared/enterprise-chat-view'
import { parseWebSession } from '../src/main/enterprise/web-session'

const fake = vi.hoisted(() => ({ views: [] as any[], sessions: [] as any[], hangLoads: false, loadFailures: 0, loadErrorCode: 'ERR_CONNECTION_RESET', emitCloseAsGone: false, loadLanding: undefined as string | undefined }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    session: { fromPartition: () => {
      const isolated = { webRequest: { onCompleted: vi.fn() }, fetch: vi.fn(async (url: string) => url.endsWith('usage-summary') || url.endsWith('quota/effective') ? usageResponse(url) : ({ ok: true, json: async () => ({ data: [{ chat_id: 'cloud-a', name: 'Cloud A', flow_type: 15, update_time: '2026-10-16' }] }) })), cookies: { set: vi.fn(async () => {}) }, clearStorageData: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
      fake.sessions.push(isolated)
      return isolated
    } },
    shell: { openExternal: vi.fn(async () => {}) },
    WebContentsView: class {
      webContents: any
      bounds = { x: 0, y: 0, width: 0, height: 0 }
      visible = false
      setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => { this.bounds = { ...bounds } })
      setVisible = vi.fn((visible: boolean) => { this.visible = visible })
      getBounds = () => this.bounds
      getVisible = () => this.visible
      setBackgroundColor = vi.fn()
      constructor(public options: any) {
        let url = ''
        let zoom = 1
        this.webContents = Object.assign(new EventEmitter(), { id: fake.views.length + 100, session: options.webPreferences.session, isDestroyed: () => false, setWindowOpenHandler: vi.fn(), focus: vi.fn(), send: vi.fn(), mainFrame: {}, getURL: () => url, getZoomFactor: () => zoom, setZoomFactor: vi.fn((value: number) => { zoom = value }), capturePage: vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,fixture' })), close: vi.fn(() => { if (fake.emitCloseAsGone) { const contents = this.webContents; setTimeout(() => contents.emit('render-process-gone'), 0) } }), executeJavaScript: vi.fn(async () => {}), insertCSS: vi.fn(async () => 'key'), loadURL: vi.fn(async (next: string) => {
          if (fake.hangLoads) return await new Promise<void>(() => {})
          if (fake.loadFailures > 0) { fake.loadFailures -= 1; throw Object.assign(new Error('load failed'), { code: fake.loadErrorCode }) }
          url = fake.loadLanding ?? next
          this.webContents.emit('did-finish-load')
        }) })
        fake.views.push(this)
      }
    }
  }
})

afterEach(() => { fake.views.length = 0; fake.sessions.length = 0; fake.hangLoads = false; fake.loadFailures = 0; fake.loadErrorCode = 'ERR_CONNECTION_RESET'; fake.emitCloseAsGone = false; fake.loadLanding = undefined })
const networkError = () => new EnterprisePlatformError('Could not reach the BiSheng platform.', { code: 'network_error' })
const elapse = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await flush() }
const presentation = { visible: true, theme: 'dark', bounds: { x: 0, y: 56, width: 1100, height: 700 } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  let state = { connected: true, connectionKey: 'tenant-a' }
  let change: (state: any) => void = () => {}
  const enterprise = { snapshot: () => state, subscribe: (listener: typeof change) => { change = listener; return vi.fn() }, webSession: vi.fn(async () => ({ base: 'https://enterprise.example', cookie: 'test-cookie', cookieName: 'bs_credits_3007', connectionKey: 'tenant-a', expiresAt: Date.now() + 300_000 })) }
  const owner: any = Object.assign(new EventEmitter(), { isDestroyed: () => false, getContentSize: () => [1100, 800], contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: Object.assign(new EventEmitter(), { send: vi.fn(), focus: vi.fn(), getZoomFactor: () => 1, isDestroyed: () => false, executeJavaScript: vi.fn(async () => true) }) })
  const host = new EnterpriseChatView(enterprise as any, vi.fn())
  return { host, owner, enterprise, change: (next: typeof state) => { state = next; change(next) } }
}

describe('enterprise Chat host boundary', () => {
  it('inherits host zoom on creation, menu changes, hidden presentation and reconnect', async () => {
    const f = fixture()
    let zoom = 0.8
    f.owner.webContents.getZoomFactor = () => zoom
    try {
      f.host.present(f.owner, presentation)
      await flush()
      const view = fake.views[0]
      expect(view.webContents.getZoomFactor()).toBe(0.8)
      for (const value of [0.7, 1.2, 1]) {
        zoom = value
        f.host.syncZoom(f.owner)
        expect(view.webContents.getZoomFactor()).toBe(value)
        expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: Math.round(56 * value), width: Math.min(1100, Math.round(1100 * value)), height: Math.min(800 - Math.round(56 * value), Math.round(700 * value)) })
      }
      zoom = 1.25
      f.host.present(f.owner, { ...presentation, visible: false })
      expect(view.webContents.getZoomFactor()).toBe(1.25)
      f.host.present(f.owner, presentation)
      await f.host.open('new')
      expect(view.webContents.getZoomFactor()).toBe(1.25)
      f.host.retry()
      await flush()
      expect(fake.views[1].webContents.getZoomFactor()).toBe(1.25)
      zoom = 0.5
      const other = fixture()
      try {
        f.host.syncZoom(other.owner)
        expect(fake.views[1].webContents.getZoomFactor()).toBe(1.25)
      } finally { other.host.dispose() }
    } finally { f.host.dispose() }
  })

  it('reads fixed self-service usage with the isolated session and discards logout races', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      const totals = { message_count: 2, input_tokens: 10, output_tokens: 5, total_tokens: 15, missing_usage_count: 0 }
      const summary = { start_at: '2026-10-22T00:00:00+08:00', end_at: '2026-10-22T12:00:00+08:00', timezone: 'Asia/Shanghai', granularity: 'day', totals, points: [] }
      fake.sessions[0].fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ status_code: 200, data: url.endsWith('usage-summary') ? summary : [{ resource_type: 'knowledge_space_file', user_used: 0.1, effective: -1 }] })))
      expect(await f.host.usage()).toMatchObject({ summary: { status: 'ready', data: { totals } }, storage: { status: 'ready', data: { used: 0.1, limit: -1 } } })
      expect(fake.sessions[0].fetch.mock.calls.map((call: unknown[]) => call[0])).toEqual(['https://enterprise.example/api/v1/dsh/me/usage-summary', 'https://enterprise.example/api/v1/quota/effective'])
      const finishes: Array<(response: Response) => void> = []
      fake.sessions[0].fetch.mockImplementation(() => new Promise<Response>(resolve => { finishes.push(resolve) }))
      const pending = f.host.usage()
      const rejected = expect(pending).rejects.toThrow('identity changed')
      f.change({ connected: false, connectionKey: 'tenant-a' })
      // Both requests must settle before the identity check.
      for (const finish of finishes) finish(new Response(JSON.stringify({ status_code: 200, data: [] })))
      await rejected
    } finally { f.host.dispose() }
  })

  it('sets a host-only cookie before loading Chat and keeps Work switches reversible', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      expect(f.host.snapshot().phase).toBe('ready')
      expect(fake.views[0].webContents.insertCSS).toHaveBeenCalledWith(expect.stringContaining('.dsh-chat-header .dsh-chat-section-row { display: none !important; }'))
      expect(fake.views[0].options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true })
      expect(fake.views[0].options.webPreferences.preload).toMatch(/enterprise-chat\.cjs$/u)
      expect(fake.sessions[0].cookies.set).toHaveBeenCalledWith(expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true, name: 'bs_credits_3007' }))
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

  it('does not exchange or replace the cookie on unchanged connected publishes', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      const view = fake.views[0]
      f.change({ connected: true, connectionKey: 'tenant-a' })
      f.change({ connected: true, connectionKey: 'tenant-a' })
      await flush()
      expect(f.enterprise.webSession).toHaveBeenCalledTimes(1)
      expect(fake.sessions[0].cookies.set).toHaveBeenCalledTimes(1)
      expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
      expect(view.webContents.close).not.toHaveBeenCalled()
      await elapse(270_000)
      expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
      expect(fake.sessions[0].cookies.set).toHaveBeenCalledTimes(2)
      expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    } finally { f.host.dispose(); vi.useRealTimers() }
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

  it('validates the ingress cookie name and supports the existing server default', () => {
    const body = { cookie: 'a'.repeat(40), expires_in: 300 }
    expect(parseWebSession(body, 'https://enterprise.example', 'a').cookieName).toBe('access_token_cookie')
    expect(parseWebSession({ ...body, cookie_name: 'bs_credits_3007' }, 'https://enterprise.example', 'a').cookieName).toBe('bs_credits_3007')
    for (const cookie_name of ['', 'a=b', 'a; b', '\r\nCookie: x', null, 3, 'a'.repeat(65)]) {
      expect(() => parseWebSession({ ...body, cookie_name }, 'https://enterprise.example', 'a')).toThrow('cookie name')
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
    // New conversation is a reset action even if the document URL is unchanged.
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads + 1)
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

it('scopes desktop projects to the enterprise identity and routes only validated project drafts', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().projectScope).toBe('tenant-a')
    await f.host.open('new', '11111111-1111-4111-8111-111111111111')
    expect(fake.views[0].webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/c/new?projectId=11111111-1111-4111-8111-111111111111&embed=dsh&dshTheme=dark')
    expect(f.host.snapshot()).toMatchObject({ draftProjectId: '11111111-1111-4111-8111-111111111111', conversationId: 'new' })
    await expect(f.host.open('new', '../admin')).rejects.toThrow('identity')
    await expect(f.host.open('cloud-a', '11111111-1111-4111-8111-111111111111')).rejects.toThrow('new Chat draft')
    await f.host.open('new')
    expect(f.host.snapshot().draftProjectId).toBeUndefined()
    f.host.retry()
    await flush()
    expect(f.host.snapshot().projectScope).toBe('tenant-a')
    f.change({ connected: false, connectionKey: 'tenant-a' })
    expect(f.host.snapshot().projectScope).toBeUndefined()
  } finally { f.host.dispose() }
})

it('requests a fresh project conversation even when the same draft URL is already open', async () => {
  const f = fixture()
  const projectId = '11111111-1111-4111-8111-111111111111'
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.open('new', projectId)
    const view = fake.views[0]
    const loads = view.webContents.loadURL.mock.calls.length
    view.webContents.executeJavaScript.mockClear()
    view.webContents.executeJavaScript.mockResolvedValue(true)
    await f.host.open('new', projectId)
    expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining(`path: "/c/new?projectId=${projectId}"`))
    expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('resetDraft: true'))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads)
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
    expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('resetDraft: false'))
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

it('publishes a reported approval backlog and rejects a malformed one without dropping the identity', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0].webContents
    const entries = [{ id: 'knowledge', label: 'Knowledge', path: '/knowledge', primary: true, active: false }]
    view.emit('ipc-message', { senderFrame: view.mainFrame }, 'enterprise-chat:navigation', { path: '/workspace/', navigation: { entries } })
    expect(f.host.snapshot().navigation?.approvals).toBeUndefined()
    view.emit('ipc-message', { senderFrame: view.mainFrame }, 'enterprise-chat:navigation', { path: '/workspace/', navigation: { entries, approvals: { pending: 7 } } })
    expect(f.host.snapshot().navigation?.approvals).toEqual({ pending: 7 })
    for (const approvals of [{ pending: -1 }, { pending: 1.5 }, { pending: '3' }, { pending: 10_000 }, {}, null]) {
      view.emit('ipc-message', { senderFrame: view.mainFrame }, 'enterprise-chat:navigation', { path: '/workspace/', navigation: { entries, approvals } })
      expect(f.host.snapshot().navigation?.approvals).toEqual({ pending: 7 })
    }
    view.emit('ipc-message', { senderFrame: view.mainFrame }, 'enterprise-chat:navigation', { path: '/workspace/', navigation: { entries, approvals: { pending: 0 } } })
    expect(f.host.snapshot().navigation?.approvals).toEqual({ pending: 0 })
  } finally { f.host.dispose() }
})

it('delivers the host palette to module pages, backs the view with it, and rejects a malformed one', async () => {
  const f = fixture()
  try {
    const palette = {
      surface: [44, 44, 46], raised: [53, 54, 56], strong: [97, 102, 107],
      labelPrimary: [249, 250, 251], labelSecondary: [207, 211, 214], labelTertiary: [173, 178, 184],
      borderBase: [69, 69, 71], borderDeep: [78, 78, 79]
    }
    f.host.present(f.owner, { ...presentation, palette })
    await flush()
    const view = fake.views[0], wc = view.webContents
    // Chat keeps its backing color in the content seat; the native layer stays transparent.
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#00000000')
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('background: #141416'))
    f.host.present(f.owner, { ...presentation, palette, settings: 'desktop-usage' })
    await flush()
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('--bg-page:44 44 46'))
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('--text-1:249 250 251'))
    // The module page paints the host surface, so the view backs it with the same color.
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#2c2c2e')
    // Approvals open in a Modal on the same layer-2 surface; its pages take the same backing.
    for (const section of ['my-tasks', 'my-requests', 'notifications'] as const) {
      f.host.present(f.owner, { ...presentation, palette, settings: section })
      await flush()
      expect(wc.loadURL).toHaveBeenLastCalledWith(`https://enterprise.example/workspace/settings/${section}?dshSettings=1&embed=dsh&dshTheme=dark`)
      expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#2c2c2e')
    }
    for (const invalid of [{ ...palette, surface: [44, 44] }, { ...palette, surface: [44, 44, 256] }, { ...palette, raised: ['53', 54, 56] }, { ...palette, strong: undefined }, { ...palette, composer: [1, 2] }, { ...palette, composer: [0, 0, 256] }, { ...palette, composer: ['40', 41, 45] }, 'dark']) {
      expect(() => f.host.present(f.owner, { ...presentation, palette: invalid })).toThrow('Invalid Chat palette.')
    }
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

it('retries a stalled first document load and exposes Reconnect only after the attempts are exhausted', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const note = vi.fn()
  const host = new EnterpriseChatView(f.enterprise as any, note)
  fake.hangLoads = true
  try {
    host.present(f.owner, presentation)
    await flush()
    expect(host.snapshot().phase).toBe('loading')
    await elapse(45_000)
    expect(host.snapshot().phase).toBe('loading')
    expect(note).toHaveBeenCalledWith('[enterprise-chat] session_retry stage=load attempt=1 status=timeout')
    expect(fake.views[0].webContents.close).toHaveBeenCalled()
    await elapse(2_400)
    await elapse(45_000)
    await elapse(6_000)
    await elapse(45_000)
    await elapse(12_000)
    await elapse(45_000)
    expect(host.snapshot().phase).toBe('error')
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(4)
    expect(note).toHaveBeenCalledWith('[enterprise-chat] session_failed stage=load status=timeout')
  } finally { host.dispose(); f.host.dispose(); vi.useRealTimers() }
})

it('opens content-only settings, waits for the current main frame and restores the previous page', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.open('new')
    const view = fake.views[0], wc = view.webContents
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
    await flush()
    expect(wc.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/settings/desktop-usage?dshSettings=1&embed=dsh&dshTheme=dark')
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    const report = (frame: unknown, section: string, path = '/workspace/settings/desktop-usage') => wc.emit('ipc-message', { senderFrame: frame }, 'enterprise-chat:settings-ready', { section, path })
    report({}, 'desktop-usage')
    report(wc.mainFrame, 'notifications')
    report(wc.mainFrame, 'desktop-usage', '/workspace/settings/notifications')
    expect(f.host.snapshot().settingsReady).toBe(false)
    report(wc.mainFrame, 'desktop-usage')
    expect(f.host.snapshot()).toMatchObject({ settingsSection: 'desktop-usage', settingsReady: true })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:settings-close', { path: '/workspace/settings/desktop-usage' })
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

it('returns from settings to a project draft without requesting a fresh conversation', async () => {
  const f = fixture()
  const projectId = '11111111-1111-4111-8111-111111111111'
  try {
    f.host.present(f.owner, presentation)
    await flush()
    await f.host.open('new', projectId)
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
    await flush()
    const wc = fake.views[0].webContents
    wc.executeJavaScript.mockClear()
    wc.executeJavaScript.mockResolvedValue(true)
    f.host.present(f.owner, presentation)
    await flush()
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining(`path: "/c/new?projectId=${projectId}", resetDraft: false`))
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
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
    await flush()
    const view = fake.views[0], wc = view.webContents
    wc.focus = vi.fn()
    const ready = () => wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:settings-ready', { section: 'desktop-usage', path: '/workspace/settings/desktop-usage' })
    expect(f.host.snapshot().settingsProtocolVersion).toBe(1)
    ready()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    await wc.loadURL('https://enterprise.example/workspace/knowledge/space/example')
    wc.emit('did-navigate-in-page', {}, wc.getURL(), true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(f.host.snapshot().settingsReady).toBe(false)
    f.host.focusSettings()
    expect(wc.focus).not.toHaveBeenCalled()
    await wc.loadURL('https://enterprise.example/workspace/settings/desktop-usage?dshSettings=1')
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
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
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

it('pushes hidden account changes even before a Chat owner exists', async () => {
  const f = fixture()
  let window = undefined as typeof f.owner | undefined
  const host = new EnterpriseChatView(f.enterprise as any, vi.fn(), () => window)
  try {
    f.change({ connected: false, connectionKey: 'tenant-a' })
    expect(host.snapshot().connected).toBe(false)
    window = f.owner
    f.change({ connected: true, connectionKey: 'tenant-a' })
    expect(window.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ connected: true, phase: 'idle' }))
    expect(f.enterprise.webSession).not.toHaveBeenCalled()
    host.present(window, { ...presentation, visible: false })
    window.webContents.send.mockClear()
    f.change({ connected: true, connectionKey: 'tenant-b' })
    expect(window.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ connected: true, phase: 'idle' }))
    expect(f.enterprise.webSession).not.toHaveBeenCalled()
    f.change({ connected: false, connectionKey: 'tenant-b' })
    expect(window.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ connected: false }))
    expect(fake.views).toHaveLength(0)
  } finally { host.dispose(); f.host.dispose() }
})

it('pushes connection failures and logout to mounted settings without waiting for a poll', async () => {
  const f = fixture()
  try {
    f.enterprise.webSession.mockRejectedValueOnce(new Error('Temporary connection failure'))
    f.host.present(f.owner, { ...presentation, settings: 'desktop-usage' })
    await flush()
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ phase: 'error' }))
    f.host.retry()
    await flush()
    expect(f.host.snapshot().phase).toBe('ready')
    f.change({ connected: false, connectionKey: 'tenant-a' })
    expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ connected: false, settingsReady: false }))
  } finally { f.host.dispose() }
})


it.each(['/workspace/c/new', '/workspace/capabilities', '/workspace/skills', '/workspace/knowledge'])('presents body dialogs across the window on %s and restores the content region', async (path) => {
  const f = fixture()
  try {
    const region = { x: 240, y: 56, width: 860, height: 744 }
    f.host.present(f.owner, { ...presentation, bounds: region })
    await flush()
    const view = fake.views[0], wc = view.webContents
    await wc.loadURL('https://enterprise.example' + path)
    const report = (senderFrame: unknown, open: unknown, reportPath = path) =>
      wc.emit('ipc-message', { senderFrame }, 'enterprise-chat:modal', { open, path: reportPath })
    report({}, true)
    report(wc.mainFrame, 'true')
    report(wc.mainFrame, true, '/workspace/c/old')
    expect(view.setBounds).toHaveBeenLastCalledWith(region)
    const viewportDeliveries = () => wc.executeJavaScript.mock.calls.filter(([script]: [string]) => script.includes('dsh-window-dialog-viewport'))
    const prepared = viewportDeliveries().length
    expect(prepared).toBeGreaterThan(0)
    report(wc.mainFrame, true)
    await flush()
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1100, height: 800 })
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#00000000')
    expect(wc.focus).toHaveBeenCalledTimes(1)
    expect(viewportDeliveries()).toHaveLength(prepared)
    report(wc.mainFrame, false)
    expect(view.setBounds).toHaveBeenLastCalledWith(region)
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#00000000')
    expect(viewportDeliveries()).toHaveLength(prepared)
    report(wc.mainFrame, true)
    await flush()
    wc.emit('did-navigate-in-page', {}, 'https://enterprise.example/workspace/c/other', true)
    expect(view.setBounds).toHaveBeenLastCalledWith(region)
  } finally { f.host.dispose() }
})

it('prepares the owner backing before changing native bounds and avoids resetting unchanged native state', async () => {
  const f = fixture()
  try {
    const region = { x: 240, y: 56, width: 860, height: 744 }
    f.host.present(f.owner, { ...presentation, bounds: region })
    await flush()
    const view = fake.views[0], wc = view.webContents
    view.setBounds.mockClear()
    view.setVisible.mockClear()
    view.setBackgroundColor.mockClear()
    f.host.present(f.owner, { ...presentation, bounds: region })
    expect(view.setBounds).not.toHaveBeenCalled()
    expect(view.setVisible).not.toHaveBeenCalled()
    expect(view.setBackgroundColor).not.toHaveBeenCalled()
    let painted!: (value: boolean) => void
    f.owner.webContents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { painted = resolve }))
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:modal', { open: true, path: '/workspace/' })
    await flush()
    expect(f.owner.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('dsh-chat-dialog-backing'))
    expect(view.getBounds()).toEqual(region)
    f.host.present(f.owner, { ...presentation, bounds: region })
    expect(view.getBounds()).toEqual(region)
    painted(true)
    await flush()
    expect(view.getBounds()).toEqual({ x: 0, y: 0, width: 1100, height: 800 })
    expect(view.setVisible).not.toHaveBeenCalled()
    expect(view.setBackgroundColor).not.toHaveBeenCalled()
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:modal', { open: false, path: '/workspace/' })
    await flush()
    expect(view.getBounds()).toEqual(region)
    expect(f.owner.webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('delete window[key]'))
  } finally { f.host.dispose() }
})

it('ignores an earlier opening after close and reopen, and drops backing pixels when hidden', async () => {
  const f = fixture()
  try {
    const region = { x: 240, y: 56, width: 860, height: 744 }
    f.host.present(f.owner, { ...presentation, bounds: region })
    await flush()
    const view = fake.views[0], wc = view.webContents
    const report = (open: boolean) => wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:modal', { open, path: '/workspace/' })
    let first!: (value: boolean) => void
    let second!: (value: boolean) => void
    f.owner.webContents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    report(true)
    await flush()
    report(false)
    await flush()
    f.owner.webContents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
    report(true)
    await flush()
    first(true)
    await flush()
    expect(view.getBounds()).toEqual(region)
    second(true)
    await flush()
    expect(view.getBounds()).toEqual({ x: 0, y: 0, width: 1100, height: 800 })
    f.host.present(f.owner, { ...presentation, visible: false, bounds: region })
    await flush()
    expect(view.getVisible()).toBe(false)
    expect(f.owner.webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('delete window[key]'))
  } finally { f.host.dispose() }
})

it('retains host-owned settings bounds when an embedded settings page reports a modal', async () => {
  const f = fixture()
  try {
    const region = { x: 380, y: 100, width: 600, height: 600 }
    f.host.present(f.owner, { ...presentation, bounds: region, settings: 'desktop-usage' })
    await flush()
    const view = fake.views[0], wc = view.webContents
    wc.emit('ipc-message', { senderFrame: wc.mainFrame }, 'enterprise-chat:modal', { open: true, path: '/workspace/settings/desktop-usage' })
    expect(view.setBounds).toHaveBeenLastCalledWith(region)
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#141416')
  } finally { f.host.dispose() }
})

it('captures only its visible owner surface and converts native bounds to host CSS coordinates', async () => {
  const f = fixture()
  try {
    f.owner.webContents.getZoomFactor = () => 1.25
    f.host.present(f.owner, { ...presentation, bounds: { x: 240, y: 48, width: 640, height: 560 } })
    await flush()
    expect(await f.host.capture({ ...f.owner })).toBeUndefined()
    expect(await f.host.capture(f.owner)).toEqual({ dataURL: 'data:image/png;base64,fixture', bounds: { x: 240, y: 48, width: 640, height: 560 } })
    const view = fake.views[0]
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(1)
    f.host.present(f.owner, { ...presentation, visible: false })
    expect(await f.host.capture(f.owner)).toBeUndefined()
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(1)
  } finally { f.host.dispose() }
})

it.each(['logout', 'navigate', 'resize'])('discards native overlay captures invalidated by %s', async change => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    const view = fake.views[0]
    let finish: (value: unknown) => void = () => {}
    view.webContents.capturePage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const frame = f.host.capture(f.owner)
    if (change === 'logout') f.change({ connected: false, connectionKey: 'tenant-a' })
    if (change === 'navigate') await view.webContents.loadURL('https://enterprise.example/workspace/knowledge')
    if (change === 'resize') f.host.present(f.owner, { ...presentation, bounds: { ...presentation.bounds, width: 800 } })
    finish({ isEmpty: () => false, toDataURL: () => 'stale' })
    expect(await frame).toBeUndefined()
  } finally { f.host.dispose() }
})

it('validates platform cookie names and applies the isolated cookie to embedded Chat', async () => {
  const value = { cookie: 'a'.repeat(40), expires_in: 300, cookie_name: 'bs_credits_3007' }
  expect(parseWebSession(value, 'https://enterprise.example', 'tenant-a').cookieName).toBe('bs_credits_3007')
  for (const name of ['x; injected=value', 'x\r\nHeader:value', '', 42]) {
    expect(() => parseWebSession({ ...value, cookie_name: name }, 'https://enterprise.example', 'tenant-a')).toThrow()
  }
  const f = fixture()
  f.enterprise.webSession.mockResolvedValue(parseWebSession(value, 'https://enterprise.example', 'tenant-a'))
  try {
    f.host.present(f.owner, presentation)
    await flush()
    expect(fake.sessions[0].cookies.set).toHaveBeenCalledWith(expect.objectContaining({ name: 'bs_credits_3007' }))
  } finally { f.host.dispose() }
})


it('refreshes tools only after a current account browser completes an availability save', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0], isolated = fake.sessions[0]
    const [filter, completed] = isolated.webRequest.onCompleted.mock.calls[0]
    expect(filter.urls).toEqual(['https://enterprise.example/api/v1/dsh/capabilities/*/availability'])
    const saved = { url: 'https://enterprise.example/api/v1/dsh/capabilities/38/availability',
      method: 'PUT', statusCode: 200, webContentsId: view.webContents.id }
    f.owner.webContents.send.mockClear()
    for (const change of [{ method: 'GET' }, { statusCode: 403 }, { statusCode: 500 },
      { webContentsId: 999 }, { webContentsId: undefined },
      { url: 'https://other.example/api/v1/dsh/capabilities/38/availability' },
      { url: 'https://enterprise.example/api/v1/dsh/capabilities/38/run' }]) completed({ ...saved, ...change })
    expect(f.owner.webContents.send).toHaveBeenCalledTimes(0)
    completed(saved)
    expect(f.owner.webContents.send).toHaveBeenCalledExactlyOnceWith('enterprise-chat:tools-changed')
    f.change({ connected: true, connectionKey: 'tenant-b' })
    expect(isolated.webRequest.onCompleted).toHaveBeenLastCalledWith(null)
    f.owner.webContents.send.mockClear()
    completed(saved)
    expect(f.owner.webContents.send).toHaveBeenCalledTimes(0)
  } finally { f.host.dispose() }
})

const usageTotals = { message_count: 2, input_tokens: 10, output_tokens: 5, total_tokens: 15, missing_usage_count: 0 }
const usageSummary = { start_at: '2026-10-28T00:00:00+08:00', end_at: '2026-10-28T12:00:00+08:00', timezone: 'Asia/Shanghai', granularity: 'day', totals: usageTotals, points: [] }
const usageResponse = (url: string) => new Response(JSON.stringify({ status_code: 200, data: url.endsWith('usage-summary') ? usageSummary : [{ resource_type: 'knowledge_space_file', user_used: 0.1, effective: -1 }] }))

it.each(['summary', 'storage'])('preserves the other usage section when %s fails', async failed => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    fake.sessions[0].fetch.mockImplementation(async (url: string) => (url.endsWith('usage-summary') === (failed === 'summary')) ? new Response('service failed', { status: 500 }) : usageResponse(url))
    const result = await f.host.usage()
    expect(result[failed as 'summary' | 'storage']).toEqual({ status: 'error' })
    expect(result[failed === 'summary' ? 'storage' : 'summary'].status).toBe('ready')
  } finally { f.host.dispose() }
})

it('keeps valid statistics when storage payload validation fails', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    fake.sessions[0].fetch.mockImplementation(async (url: string) => url.endsWith('usage-summary') ? usageResponse(url) : new Response(JSON.stringify({ status_code: 200, data: [{ resource_type: 'knowledge_space_file', user_used: -2, effective: 1 }] })))
    expect(await f.host.usage()).toMatchObject({ summary: { status: 'ready', data: { totals: usageTotals } }, storage: { status: 'error' } })
  } finally { f.host.dispose() }
})

it('renews one cookie session for concurrent expired usage reads', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    const attempts = new Map<string, number>()
    fake.sessions[0].fetch.mockImplementation(async (url: string) => {
      const count = (attempts.get(url) ?? 0) + 1; attempts.set(url, count)
      return count === 1 ? new Response('expired', { status: 401 }) : usageResponse(url)
    })
    const result = await f.host.usage()
    expect(result.summary.status).toBe('ready'); expect(result.storage.status).toBe('ready')
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
    expect([...attempts.values()]).toEqual([2, 2])
  } finally { f.host.dispose() }
})

it('bounds authentication retries to one renewal per usage request', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    fake.sessions[0].fetch.mockImplementation(async () => new Response('expired', { status: 401 }))
    expect(await f.host.usage()).toEqual({ summary: { status: 'error' }, storage: { status: 'error' } })
    expect(fake.sessions[0].fetch).toHaveBeenCalledTimes(4)
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
  } finally { f.host.dispose() }
})

it('recovers a failed Chat session when the user requests usage again', async () => {
  const f = fixture()
  try {
    f.enterprise.webSession.mockRejectedValueOnce(new Error('offline'))
    f.host.present(f.owner, presentation); await flush()
    expect(f.host.snapshot().phase).toBe('error')
    expect(await f.host.usage()).toMatchObject({ summary: { status: 'ready', data: { totals: usageTotals } }, storage: { status: 'ready' } })
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
  } finally { f.host.dispose() }
})

it('discards delayed 401 responses after logout before renewing a session', async () => {
  const f = fixture()
  try {
    f.host.present(f.owner, presentation); await flush()
    const finishers: Array<(value: Response) => void> = []
    fake.sessions[0].fetch.mockImplementation(() => new Promise<Response>(resolve => finishers.push(resolve)))
    const pending = f.host.usage()
    const rejected = expect(pending).rejects.toThrow('identity changed')
    f.change({ connected: false, connectionKey: 'tenant-a' })
    finishers.forEach(finish => finish(new Response('expired', { status: 401 })))
    await rejected
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(1)
  } finally { f.host.dispose() }
})

it('keeps a ready workspace across a transient renewal and ignores publishes until the backoff', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    const loads = view.webContents.loadURL.mock.calls.length
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads)
    f.change({ connected: true, connectionKey: 'tenant-a' })
    f.host.present(f.owner, presentation)
    await elapse(1_599)
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
    await elapse(801)
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(3)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.sessions[0].cookies.set).toHaveBeenCalledTimes(2)
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(loads)
    const renewed = f.enterprise.webSession.mock.calls.length
    await elapse(36_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(renewed)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('spaces later renewal failures at 2s, 5s, 10s and then 30s until the platform returns', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValue(networkError())
    await elapse(270_000)
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
    for (const gap of [2_400, 6_000, 12_000, 36_000, 36_000]) {
      const before = f.enterprise.webSession.mock.calls.length
      await elapse(gap)
      expect(f.enterprise.webSession.mock.calls.length).toBe(before + 1)
      expect(f.host.snapshot().phase).toBe('ready')
      expect(fake.views[0].webContents.close).not.toHaveBeenCalled()
    }
    f.enterprise.webSession.mockImplementation(async () => ({ base: 'https://enterprise.example', cookie: 'renewed-cookie', cookieName: 'bs_credits_3007', connectionKey: 'tenant-a', expiresAt: Date.now() + 300_000 }))
    await elapse(36_000)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.views).toHaveLength(1)
    expect(fake.sessions[0].cookies.set).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'renewed-cookie' }))
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('reloads the workspace when a renewal lands after the document left it', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    const view = fake.views[0]
    await view.webContents.loadURL('https://enterprise.example/login')
    expect(f.host.snapshot().phase).toBe('loading')
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark')
    expect(view.webContents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('drops an open workspace immediately when renewal reports an identity failure', async () => {
  vi.useFakeTimers()
  try {
    for (const failure of [new Error('Enterprise account changed.'), Object.assign(new Error('Enterprise models are unavailable.'), { status: 409 })]) {
      const f = fixture()
      try {
        f.host.present(f.owner, presentation)
        await flush()
        const view = fake.views.at(-1)
        f.enterprise.webSession.mockRejectedValueOnce(failure)
        await elapse(270_000)
        expect(f.host.snapshot().phase).toBe('error')
        expect(view.webContents.close).toHaveBeenCalled()
        const calls = f.enterprise.webSession.mock.calls.length
        await elapse(10_000)
        expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
      } finally { f.host.dispose() }
    }
  } finally { vi.useRealTimers() }
})

it('cancels renewal backoff on manual reconnect, logout, account switch and dispose', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    f.host.retry()
    await flush()
    expect(f.host.snapshot().phase).toBe('ready')
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(3)

    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    const scheduled = f.enterprise.webSession.mock.calls.length
    f.change({ connected: false, connectionKey: 'tenant-a' })
    await elapse(3_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(scheduled)
  } finally { f.host.dispose(); vi.useRealTimers() }

  vi.useFakeTimers()
  const switched = fixture()
  try {
    switched.host.present(switched.owner, presentation)
    await flush()
    switched.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    switched.change({ connected: true, connectionKey: 'tenant-b' })
    await flush()
    const calls = switched.enterprise.webSession.mock.calls.length
    await elapse(2_400)
    expect(switched.enterprise.webSession.mock.calls.length).toBe(calls)
    expect(switched.enterprise.webSession).toHaveBeenLastCalledWith('tenant-b')
  } finally { switched.host.dispose(); vi.useRealTimers() }

  vi.useFakeTimers()
  const disposed = fixture()
  try {
    disposed.host.present(disposed.owner, presentation)
    await flush()
    disposed.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    const calls = disposed.enterprise.webSession.mock.calls.length
    disposed.host.dispose()
    await elapse(3_000)
    expect(disposed.enterprise.webSession.mock.calls.length).toBe(calls)
  } finally { vi.useRealTimers() }
})

it('retries the first connection in the background and then shows Chat', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('loading')
    expect(fake.views).toHaveLength(0)
    f.host.present(f.owner, presentation)
    f.change({ connected: true, connectionKey: 'tenant-a' })
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(1)
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(2)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('shows the error page when the first connection keeps failing', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.enterprise.webSession.mockRejectedValue(networkError())
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('loading')
    await elapse(2_400)
    await elapse(6_000)
    await elapse(12_000)
    expect(f.host.snapshot().phase).toBe('error')
    expect(f.enterprise.webSession).toHaveBeenCalledTimes(4)
    expect(f.owner.webContents.send).toHaveBeenCalledWith('enterprise-chat:changed', expect.objectContaining({ phase: 'error' }))
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('discards a half-initialized view and opens a new one on the next attempt', async () => {
  vi.useFakeTimers()
  const f = fixture()
  fake.loadFailures = 1
  try {
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('loading')
    expect(fake.views[0].webContents.close).toHaveBeenCalled()
    await elapse(2_400)
    expect(fake.views).toHaveLength(2)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.views[1].webContents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('treats an aborted document load as terminal', async () => {
  vi.useFakeTimers()
  const f = fixture()
  fake.loadFailures = 1
  fake.loadErrorCode = 'ERR_ABORTED'
  try {
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('error')
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(3_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
    expect(fake.views).toHaveLength(1)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('reloads the workspace after a ready document redirects to login', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    await view.webContents.loadURL('https://enterprise.example/login')
    expect(f.host.snapshot().phase).toBe('loading')
    expect(view.webContents.close).not.toHaveBeenCalled()
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(2_400)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls + 1)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark')
    expect(view.webContents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('stops after the workspace shell redirects to login again', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    const leave = () => view.webContents.loadURL('https://enterprise.example/login')
    await leave()
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    await leave()
    await elapse(6_000)
    expect(f.host.snapshot().phase).toBe('ready')
    await leave()
    await elapse(12_000)
    expect(f.host.snapshot().phase).toBe('ready')
    await leave()
    expect(f.host.snapshot().phase).toBe('error')
    expect(view.webContents.close).toHaveBeenCalled()
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(36_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('shows Reconnect only after a ready document stays off the workspace', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValue(networkError())
    const view = fake.views[0]
    await view.webContents.loadURL('https://enterprise.example/login')
    expect(f.host.snapshot().phase).toBe('loading')
    await elapse(2_400)
    await elapse(6_000)
    await elapse(12_000)
    expect(f.host.snapshot().phase).toBe('error')
    expect(view.webContents.close).toHaveBeenCalled()
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(36_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('reloads the workspace after an in-page leave', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const view = fake.views[0]
    const contents = view.webContents
    let current = contents.getURL()
    const loadURL = contents.loadURL
    contents.getURL = () => current
    contents.loadURL = vi.fn(async (next: string) => {
      current = next
      return loadURL.call(view, next)
    })
    current = 'https://enterprise.example/login'
    contents.emit('did-navigate-in-page', {}, current, true)
    expect(f.host.snapshot().phase).toBe('loading')
    expect(contents.close).not.toHaveBeenCalled()
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(contents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark')
    expect(contents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('keeps a first login redirect terminal before the workspace has loaded', async () => {
  vi.useFakeTimers()
  const f = fixture()
  fake.loadLanding = 'https://enterprise.example/login'
  try {
    f.host.present(f.owner, presentation)
    await flush()
    expect(f.host.snapshot().phase).toBe('error')
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(12_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('shows Reconnect when the platform stays down after Chat leaves the workspace', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValue(networkError())
    await elapse(270_000)
    const view = fake.views[0]
    await view.webContents.loadURL('https://enterprise.example/login')
    expect(f.host.snapshot().phase).toBe('loading')
    await elapse(2_400)
    await elapse(2_400)
    await elapse(6_000)
    await elapse(12_000)
    expect(f.host.snapshot().phase).toBe('error')
    expect(view.webContents.close).toHaveBeenCalled()
    expect(f.owner.webContents.send).toHaveBeenCalledWith('enterprise-chat:changed', expect.objectContaining({ phase: 'error' }))
    const calls = f.enterprise.webSession.mock.calls.length
    await elapse(36_000)
    expect(f.enterprise.webSession.mock.calls.length).toBe(calls)
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('reloads the workspace when a later off-workspace retry succeeds', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    f.host.present(f.owner, presentation)
    await flush()
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    await elapse(270_000)
    f.enterprise.webSession.mockRejectedValueOnce(networkError())
    const view = fake.views[0]
    await view.webContents.loadURL('https://enterprise.example/login')
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('loading')
    expect(view.webContents.close).not.toHaveBeenCalled()
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/?embed=dsh&dshTheme=dark')
    expect(view.webContents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

it('ignores render-process-gone emitted by closing the previous view', async () => {
  vi.useFakeTimers()
  const f = fixture()
  fake.loadFailures = 1
  fake.emitCloseAsGone = true
  try {
    f.host.present(f.owner, presentation)
    await flush()
    const closed = fake.views[0]
    await elapse(2_400)
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.views).toHaveLength(2)
    closed.webContents.emit('render-process-gone')
    expect(f.host.snapshot().phase).toBe('ready')
    expect(fake.views[1].webContents.close).not.toHaveBeenCalled()
  } finally { f.host.dispose(); vi.useRealTimers() }
})

// Cloud deletion uses the same authenticated endpoint as the web conversation list.
describe('cloud conversation deletion', () => {
  it.each([15, 20, 1, 5, 10])('deletes the selected flow type %s and returns the active view to new Chat', async flowType => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ chat_id: 'cloud-a', flow_id: 'app-a', flow_type: flowType }] })))
      await f.host.history(1)
      await f.host.open('cloud-a')
      const epoch = f.host.snapshot().epoch
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      expect(await f.host.remove('cloud-a', epoch)).toEqual({ epoch })
      expect(fake.sessions[0].fetch).toHaveBeenLastCalledWith('https://enterprise.example/api/v1/chat/cloud-a', expect.objectContaining({ method: 'DELETE', redirect: 'error', signal: expect.any(AbortSignal) }))
      expect(fake.views[0].webContents.loadURL).toHaveBeenLastCalledWith('https://enterprise.example/workspace/c/new?embed=dsh&dshTheme=dark')
      await expect(f.host.open('cloud-a')).rejects.toThrow('current Chat history')
      // A lagging/in-flight list response cannot restore a deleted row or its grant.
      expect((await f.host.history(1)).items).toEqual([])
      await expect(f.host.open('cloud-a')).rejects.toThrow('current Chat history')
    } finally { f.host.dispose() }
  })

  it('preserves another open conversation and rejects stale or forged deletion grants', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      const epoch = f.host.snapshot().epoch
      const fetch = fake.sessions[0].fetch
      fetch.mockClear()
      await expect(f.host.remove('cloud-a', -1)).rejects.toThrow()
      await expect(f.host.remove('unknown', epoch)).rejects.toThrow()
      await expect(f.host.remove('../cloud-a', epoch)).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(0)
      const loads = fake.views[0].webContents.loadURL.mock.calls.length
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      await f.host.remove('cloud-a', epoch)
      expect(fake.views[0].webContents.loadURL).toHaveBeenCalledTimes(loads)
    } finally { f.host.dispose() }
  })

  it.each([new Response('', { status: 403 }), new Response(JSON.stringify({ status_code: 500 })), new Response('invalid')])('keeps the row and navigation grant when deletion fails', async response => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      const epoch = f.host.snapshot().epoch
      fake.sessions[0].fetch.mockResolvedValueOnce(response)
      await expect(f.host.remove('cloud-a', epoch)).rejects.toThrow()
      expect((await f.host.history(1)).items).toHaveLength(1)
      await f.host.open('cloud-a')
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      await expect(f.host.remove('cloud-a', epoch)).resolves.toEqual({ epoch })
    } finally { f.host.dispose() }
  })

  it('discards a deletion response after logout', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      let finish: (response: Response) => void = () => {}
      fake.sessions[0].fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
      const pending = f.host.remove('cloud-a', f.host.snapshot().epoch)
      const rejected = expect(pending).rejects.toThrow('identity changed')
      f.change({ connected: false, connectionKey: 'tenant-a' })
      finish(new Response(JSON.stringify({ status_code: 200 })))
      await rejected
      expect(f.host.snapshot().connected).toBe(false)
    } finally { f.host.dispose() }
  })

  it('keeps the open workspace when navigation fails after a committed deletion', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      await f.host.open('cloud-a')
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      fake.views[0].webContents.executeJavaScript.mockRejectedValueOnce(new Error('navigation failed'))
      // Old contract: the committed deletion still resolved, then the failed navigation painted the reconnect page.
      // New contract: the document never left /workspace, so the session stays ready instead of becoming a dead error.
      await expect(f.host.remove('cloud-a', f.host.snapshot().epoch)).resolves.toBeDefined()
      expect(f.host.snapshot().phase).toBe('ready')
      expect(fake.views[0].webContents.close).not.toHaveBeenCalled()
    } finally { f.host.dispose() }
  })
})

// Rename uses BiSheng's own conversation rename endpoint under the history grant deletion uses.
describe('cloud conversation rename', () => {
  it('posts the trimmed name for a listed conversation and tells the open document', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      await f.host.open('cloud-a')
      const epoch = f.host.snapshot().epoch
      const fetch = fake.sessions[0].fetch
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      await expect(f.host.rename('cloud-a', '  季度复盘  ', epoch)).resolves.toEqual({ epoch })
      const [url, init] = fetch.mock.lastCall
      expect(url).toBe('https://enterprise.example/api/v1/chat/conversation/rename')
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, signal: expect.any(AbortSignal) })
      expect(JSON.parse(init.body)).toEqual({ conversationId: 'cloud-a', name: '季度复盘' })
      expect(fake.views[0].webContents.send).toHaveBeenCalledWith('enterprise-chat:conversation-renamed', { conversationId: 'cloud-a' })
      // Unlike deletion, rename keeps the open document and the conversation's navigation grant.
      expect(fake.views[0].webContents.loadURL).not.toHaveBeenLastCalledWith(expect.stringContaining('/workspace/c/new'))
      await expect(f.host.open('cloud-a')).resolves.toBeUndefined()
    } finally { f.host.dispose() }
  })

  it.each([
    ['a stale identity', 'cloud-a', 'Name', -1],
    ['an unlisted conversation', 'unknown', 'Name', undefined],
    ['a forged identity', '../cloud-a', 'Name', undefined],
    ['an empty name', 'cloud-a', '   ', undefined],
    ['a non-string name', 'cloud-a', 42, undefined],
    ['a control character', 'cloud-a', 'line\nbreak', undefined],
    ['a name beyond the column', 'cloud-a', '名'.repeat(256), undefined]
  ])('rejects %s before calling the server', async (_label, id, name, staleEpoch) => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      const fetch = fake.sessions[0].fetch
      fetch.mockClear()
      await expect(f.host.rename(id, name, staleEpoch ?? f.host.snapshot().epoch)).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(0)
      expect(fake.views[0].webContents.send).not.toHaveBeenCalledWith('enterprise-chat:conversation-renamed', expect.anything())
    } finally { f.host.dispose() }
  })

  it('accepts a name at the column limit counted in characters', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      const name = '😀'.repeat(255)
      await f.host.rename('cloud-a', name, f.host.snapshot().epoch)
      expect(JSON.parse(fake.sessions[0].fetch.mock.lastCall[1].body).name).toBe(name)
    } finally { f.host.dispose() }
  })

  it.each([new Response('', { status: 403 }), new Response(JSON.stringify({ status_code: 500 })), new Response('invalid')])('reports a failed rename without notifying the document', async response => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      const epoch = f.host.snapshot().epoch
      fake.sessions[0].fetch.mockResolvedValueOnce(response)
      await expect(f.host.rename('cloud-a', 'Name', epoch)).rejects.toThrow()
      expect(fake.views[0].webContents.send).not.toHaveBeenCalledWith('enterprise-chat:conversation-renamed', expect.anything())
      fake.sessions[0].fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200 })))
      await expect(f.host.rename('cloud-a', 'Name', epoch)).resolves.toEqual({ epoch })
    } finally { f.host.dispose() }
  })

  it('discards a rename response after logout', async () => {
    const f = fixture()
    try {
      f.host.present(f.owner, presentation)
      await flush()
      await f.host.history(1)
      let finish: (response: Response) => void = () => {}
      fake.sessions[0].fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
      const pending = f.host.rename('cloud-a', 'Name', f.host.snapshot().epoch)
      const rejected = expect(pending).rejects.toThrow('identity changed')
      f.change({ connected: false, connectionKey: 'tenant-a' })
      finish(new Response(JSON.stringify({ status_code: 200 })))
      await rejected
    } finally { f.host.dispose() }
  })
})

// The enterprise document reports which conversations it is still generating.
describe('cloud conversation activity', () => {
  async function ready() {
    const f = fixture()
    f.host.present(f.owner, presentation)
    await flush()
    const wc = fake.views[0].webContents
    await wc.loadURL('https://enterprise.example/workspace/c/cloud-a')
    const report = (input: unknown, frame: unknown = wc.mainFrame) => wc.emit('ipc-message', { senderFrame: frame }, 'enterprise-chat:running', input)
    return { f, wc, report }
  }

  it('publishes a sorted, unique list from the current main frame', async () => {
    const { f, report } = await ready()
    try {
      expect(f.host.snapshot().running).toBeUndefined()
      report({ ids: ['cloud-b', 'cloud-a', 'cloud-b'], path: '/workspace/c/cloud-a' })
      expect(f.host.snapshot().running).toEqual(['cloud-a', 'cloud-b'])
      expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.objectContaining({ running: ['cloud-a', 'cloud-b'] }))
      const sends = f.owner.webContents.send.mock.calls.length
      report({ ids: ['cloud-a', 'cloud-b'], path: '/workspace/c/cloud-a' })
      expect(f.owner.webContents.send.mock.calls.length).toBe(sends)
      report({ ids: [], path: '/workspace/c/cloud-a' })
      expect(f.host.snapshot().running).toBeUndefined()
    } finally { f.host.dispose() }
  })

  it.each([
    ['a subframe', { ids: ['cloud-x'], path: '/workspace/c/cloud-a' }, {}],
    ['another path', { ids: ['cloud-x'], path: '/workspace/c/other' }, undefined],
    ['a forged identity', { ids: ['../cloud-x'], path: '/workspace/c/cloud-a' }, undefined],
    ['a non-array', { ids: 'cloud-x', path: '/workspace/c/cloud-a' }, undefined],
    ['an oversized list', { ids: Array.from({ length: 101 }, (_, i) => `cloud-${i}`), path: '/workspace/c/cloud-a' }, undefined]
  ])('ignores a report from %s and keeps the previous list', async (_label, input, frame) => {
    const { f, report } = await ready()
    try {
      report({ ids: ['cloud-a'], path: '/workspace/c/cloud-a' })
      report(input, frame)
      expect(f.host.snapshot().running).toEqual(['cloud-a'])
    } finally { f.host.dispose() }
  })

  it('clears activity when the document is replaced or the account signs out', async () => {
    const { f, wc, report } = await ready()
    try {
      report({ ids: ['cloud-a'], path: '/workspace/c/cloud-a' })
      wc.emit('did-start-navigation', {}, wc.getURL(), true, true)
      expect(f.host.snapshot().running).toEqual(['cloud-a'])
      wc.emit('did-start-navigation', {}, wc.getURL(), false, true)
      expect(f.host.snapshot().running).toBeUndefined()
      expect(f.owner.webContents.send).toHaveBeenLastCalledWith('enterprise-chat:changed', expect.not.objectContaining({ running: expect.anything() }))
      report({ ids: ['cloud-a'], path: '/workspace/c/cloud-a' })
      f.change({ connected: false, connectionKey: 'tenant-a' })
      expect(f.host.snapshot().running).toBeUndefined()
    } finally { f.host.dispose() }
  })
})
