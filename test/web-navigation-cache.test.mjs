// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const source = await readFile('packages/dsh-desktop-client-ui/client.js', 'utf8')
const start = source.indexOf('    function getNavStorageKey(')
const end = source.indexOf('    /** Cloud rows use', start)
if (start < 0 || end < 0) throw new Error('Navigation controller not found')
const create = new Function('createSessionDeletion', `${source.slice(start, end)}; return createChatNavigation`)(() => ({ reset() {}, dispose() {} }))
let account, fetchState, fetchBrand, dispose
const nav = { entries: [{ id: 'knowledge', label: 'Knowledge', path: '/knowledge' }] }
const key = 'dsh:enterprise-navigation:https://example.test:tenant:user'

beforeEach(() => {
  localStorage.clear()
  delete window.dshEnterpriseChat
  account = { connected: true, revision: 1, connectionKey: 'connection-a', base: 'https://example.test', tenant: { id: 'tenant' }, user: { id: 'user' } }
  fetchState = vi.fn(async () => ({ ok: true, json: async () => account }))
  fetchBrand = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }))
  vi.stubGlobal('fetch', vi.fn(async url => url === '/api/enterprise.state' ? fetchState() : url === '/api/v1/workstation/config' ? fetchBrand() : { ok: true, json: async () => ({ items: [], hasMore: false }) }))
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.getElementById('dsh-nav-prewarm')?.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function mount() {
  const controller = create({ layout: { selectPanel() {}, panelInfo: { getSnapshot: () => ({}), subscribe: () => () => {} } } })
  dispose = controller.start()
  await vi.waitFor(() => expect(controller.snapshot().connected).toBe(true))
  return controller
}

function reportNavigation() {
  window.dispatchEvent(new MessageEvent('message', { data: { channel: 'enterprise-chat:navigation', navigation: nav } }))
}

it('keeps navigation during revision updates and failed state reads', async () => {
  const controller = await mount()
  reportNavigation()
  expect(controller.snapshot().navigation).toEqual(nav)
  account = { ...account, revision: 2 }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().epoch).toBe(2))
  expect(controller.snapshot().navigation).toEqual(nav)
  expect(localStorage.getItem(key)).toContain('Knowledge')
  fetchState.mockRejectedValueOnce(new Error('temporary failure'))
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(fetchState).toHaveBeenCalledTimes(3))
  expect(controller.snapshot().connected).toBe(true)
  expect(controller.snapshot().navigation).toEqual(nav)
  expect(localStorage.getItem(key)).toContain('Knowledge')
  fetchState.mockResolvedValueOnce({ ok: false, status: 503 })
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(fetchState).toHaveBeenCalledTimes(4))
  expect(controller.snapshot().navigation).toEqual(nav)
  account = { ...account, navigation: { entries: [] } }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(fetchState).toHaveBeenCalledTimes(5))
  expect(controller.snapshot().navigation).toEqual(nav)
})

it('restores only the signed-in account cache and clears it on logout', async () => {
  localStorage.setItem(key, JSON.stringify(nav))
  localStorage.setItem('dsh:enterprise-navigation', JSON.stringify({ entries: [{ id: 'other', label: 'Other account' }] }))
  const controller = await mount()
  expect(controller.snapshot().navigation).toEqual(nav)
  account = { connected: false }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().connected).toBe(false))
  expect(controller.snapshot().navigation).toBeUndefined()
  expect(localStorage.getItem(key)).toBeNull()
  reportNavigation()
  expect(controller.snapshot().navigation).toBeUndefined()
})

it('does not carry navigation into a different account', async () => {
  const controller = await mount()
  reportNavigation()
  account = { ...account, connectionKey: 'connection-b', user: { id: 'another-user' } }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().connectionKey).toBe('connection-b'))
  expect(controller.snapshot().navigation).toBeUndefined()
  expect(localStorage.getItem(key)).toBeNull()
})

it('keeps backend welcome and menu branding across navigation reports and account refreshes', async () => {
  fetchBrand.mockResolvedValue({ ok: true, json: async () => ({ data: {
    homeMenuDisplayName: 'Team Home', welcomeMessage: 'Welcome to the team',
    sidebarIcon: { enabled: false, image: '/api/v1/files/disabled-logo' },
    assistantIcon: { enabled: true, image: '/api/v1/files/assistant' }
  } }) })
  const controller = await mount()
  await vi.waitFor(() => expect(controller.snapshot().navigation?.branding?.welcomeMessage).toBe('Welcome to the team'))
  expect(controller.snapshot().sidebarBrand.image).toBeUndefined()
  reportNavigation()
  expect(controller.snapshot().navigation.entries).toEqual(nav.entries)
  expect(controller.snapshot().navigation.homeLabel).toBe('Team Home')
  expect(controller.snapshot().navigation.branding.assistantIcon.image).toBe(window.location.origin + '/api/v1/files/assistant')
  account = { ...account, revision: 2, navigation: { ...nav, branding: { welcomeMessage: 'Cached message' } } }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().epoch).toBe(2))
  expect(controller.snapshot().navigation.branding.welcomeMessage).toBe('Welcome to the team')
  account = { connected: false }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().connected).toBe(false))
  expect(controller.snapshot().workstationBranding).toBeUndefined()
  expect(controller.snapshot().navigation).toBeUndefined()
})

it('loads sidebar name and icon, retains them on a temporary failure, and clears them on logout', async () => {
  fetchBrand.mockResolvedValue({ ok: true, json: async () => ({ data: { homeMenuDisplayName: ' Team Space ', sidebarIcon: { enabled: true, image: '/api/v1/files/logo' } } }) })
  const controller = await mount()
  await vi.waitFor(() => expect(controller.snapshot().sidebarBrand?.name).toBe('Team Space'))
  expect(controller.snapshot().sidebarBrand.image).toBe(`${window.location.origin}/api/v1/files/logo`)
  fetchBrand.mockRejectedValueOnce(new Error('temporary failure'))
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(fetchBrand).toHaveBeenCalledTimes(2))
  expect(controller.snapshot().sidebarBrand.name).toBe('Team Space')
  account = { connected: false }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().connected).toBe(false))
  expect(controller.snapshot().sidebarBrand).toBeUndefined()
})

it('ignores a late branding response from the previous account', async () => {
  let resolveFirst
  fetchBrand.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
  fetchBrand.mockResolvedValue({ ok: true, json: async () => ({ data: { homeMenuDisplayName: 'New account' } }) })
  const controller = await mount()
  await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
  account = { ...account, connectionKey: 'connection-b', user: { id: 'another-user' } }
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().sidebarBrand?.name).toBe('New account'))
  resolveFirst({ ok: true, json: async () => ({ data: { homeMenuDisplayName: 'Old account' } }) })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(controller.snapshot().sidebarBrand.name).toBe('New account')
})

it('falls back when branding configuration is absent or the image URL is invalid', async () => {
  fetchBrand.mockResolvedValue({ ok: true, json: async () => ({ data: null }) })
  const controller = await mount()
  await vi.waitFor(() => expect(controller.snapshot().sidebarBrand).toEqual({ name: '', image: undefined }))
  fetchBrand.mockResolvedValue({ ok: true, json: async () => ({ data: { homeMenuDisplayName: 'Team', sidebarIcon: { image: 'javascript:alert(1)' } } }) })
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(controller.snapshot().sidebarBrand?.name).toBe('Team'))
  expect(controller.snapshot().sidebarBrand.image).toBeUndefined()
})
