import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('../src/main/enterprise/enterprise-desktop')
  vi.doUnmock('../src/main/enterprise/chat-view')
  vi.doUnmock('../src/main/enterprise/login-link')
  vi.doUnmock('../src/main/enterprise/platform-fetch')
})

it('assembles options and forwards extension operations', async () => {
  const fetch = vi.fn()
  const safeStorage = {}
  const fetchImpl = vi.fn()
  const start = vi.fn()
  const createFetch = vi.fn((_fetch: (input: string) => void) => fetchImpl)
  const view = {}
  const createView = vi.fn(function () { return view })
  const desktop = {
    readThirdPartyPolicy: vi.fn().mockResolvedValue({ allowThirdPartyPlugins: true }),
    rotateCapability: vi.fn(),
    harnessEnvironment: vi.fn(() => ({ TEST: 'value' })),
    stop: vi.fn().mockResolvedValue(undefined)
  }
  start.mockResolvedValue(desktop)
  vi.doMock('electron', () => ({ net: { fetch }, safeStorage }))
  vi.doMock('../src/main/enterprise/enterprise-desktop', () => ({ startEnterpriseDesktop: start }))
  vi.doMock('../src/main/enterprise/chat-view', () => ({ EnterpriseChatView: createView }))
  vi.doMock('../src/main/enterprise/login-link', () => ({ allowInsecureEnterpriseLoopback: () => true }))
  vi.doMock('../src/main/enterprise/platform-fetch', () => ({ createElectronEnterpriseFetch: createFetch }))
  const { startEnterpriseExtension } = await import('../src/main/enterprise/static-extension-adapter')
  const context = { version: '1', userDataPath: '/test', activate: vi.fn(), note: vi.fn(), window: vi.fn() }
  const extension = await startEnterpriseExtension(context)
  expect(start).toHaveBeenCalledExactlyOnceWith({ desktopVersion: '1', userDataPath: '/test', activateDesktop: context.activate, note: context.note, safeStorage, fetchImpl, allowInsecureLoopback: true })
  const boundFetch = createFetch.mock.calls[0]?.[0]
  expect(boundFetch).toBeDefined()
  boundFetch?.('test')
  expect(fetch).toHaveBeenCalledWith('test')
  expect(extension.createView()).toBe(view)
  expect(createView).toHaveBeenCalledWith(desktop, context.note, context.window)
  expect(await extension.readThirdPartyPolicy()).toEqual({ allowThirdPartyPlugins: true })
  extension.rotateCapability()
  expect(extension.harnessEnvironment()).toEqual({ TEST: 'value' })
  await extension.stop()
  expect(desktop.rotateCapability).toHaveBeenCalledOnce()
  expect(desktop.stop).toHaveBeenCalledOnce()
})

it('keeps lifecycle active when update stops the service and shares cleanup', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const stop = vi.fn(() => gate)
  vi.doMock('electron', () => ({ net: { fetch: vi.fn() }, safeStorage: {} }))
  vi.doMock('../src/main/enterprise/enterprise-desktop', () => ({ startEnterpriseDesktop: vi.fn().mockResolvedValue({ stop }) }))
  vi.doMock('../src/main/enterprise/chat-view', () => ({ EnterpriseChatView: vi.fn() }))
  vi.doMock('../src/main/enterprise/login-link', () => ({ allowInsecureEnterpriseLoopback: () => false }))
  vi.doMock('../src/main/enterprise/platform-fetch', () => ({ createElectronEnterpriseFetch: vi.fn() }))
  const { startEnterpriseExtension } = await import('../src/main/enterprise/static-extension-adapter')
  const { StaticExtensionLifecycle } = await import('../src/main/static-extension-lifecycle')
  const extension = await startEnterpriseExtension({ version: '1', userDataPath: '/test', activate: async () => {}, note: () => {}, window: () => undefined })
  const lifecycle = new StaticExtensionLifecycle()
  await lifecycle.start([(dispose) => { dispose(() => extension.stop()) }])
  const updateStop = extension.stop()
  const sameStop = extension.stop()
  expect(sameStop).toBe(updateStop)
  release()
  await updateStop
  const continuation = vi.fn()
  expect(lifecycle.runIfNotStopped(continuation)).toBe(true)
  await lifecycle.stop()
  expect(continuation).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
})

it('propagates startup errors without creating a view', async () => {
  const error = new Error('startup failed')
  const createView = vi.fn()
  vi.doMock('electron', () => ({ net: { fetch: vi.fn() }, safeStorage: {} }))
  vi.doMock('../src/main/enterprise/enterprise-desktop', () => ({ startEnterpriseDesktop: vi.fn().mockRejectedValue(error) }))
  vi.doMock('../src/main/enterprise/chat-view', () => ({ EnterpriseChatView: createView }))
  vi.doMock('../src/main/enterprise/login-link', () => ({ allowInsecureEnterpriseLoopback: () => false }))
  vi.doMock('../src/main/enterprise/platform-fetch', () => ({ createElectronEnterpriseFetch: vi.fn() }))
  const { startEnterpriseExtension } = await import('../src/main/enterprise/static-extension-adapter')
  await expect(startEnterpriseExtension({ version: '1', userDataPath: '/test', activate: async () => {}, note: () => {}, window: () => undefined })).rejects.toBe(error)
  expect(createView).not.toHaveBeenCalled()
})
