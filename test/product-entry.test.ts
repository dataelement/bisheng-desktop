import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { createTrustedIpcRegistry } from '../src/main/trusted-ipc-registry'
import { ENTERPRISE_IDENTITY } from '../src/main/product-identity'

it('keeps runtime/profile-plugin-command independent from src/main/enterprise', async () => {
  const source = await readFile('src/main/runtime/profile-plugin-command.ts', 'utf8')
  expect(source).not.toMatch(/from\s+['"]\.\.\/enterprise\//)
})

it('composes the enterprise starter and working IPC contribution into the product bootstrap', async () => {
  const loginLink = {
    enterpriseLoginFromArgv: vi.fn(),
    parseEnterpriseLoginLink: vi.fn(),
    registerEnterpriseLoginProtocol: vi.fn(),
    sameHarnessOrigin: vi.fn()
  }
  vi.doMock('../src/main/enterprise/login-link', () => loginLink)
  const enforce = vi.fn()
  const read = vi.fn()
  vi.doMock('../src/main/enterprise/startup-plugin-policy', () => ({ enforceCommunityPluginPolicy: enforce, readPersistedThirdPartyPolicy: read }))
  const migrate = vi.fn()
  vi.doMock('../src/main/enterprise/legacy-settings-migration', () => ({ migrateLegacyEnterpriseSettings: migrate }))
  const startEnterprise = vi.fn()
  const bootstrap = vi.fn()
  const createBootstrap = vi.fn((_product: unknown) => bootstrap)
  vi.doMock('../src/main/index', () => ({ createDesktopBootstrap: createBootstrap }))
  vi.doMock('../src/main/enterprise/static-extension-adapter', () => ({ startEnterpriseExtension: startEnterprise }))
  try {
    await import('../src/main/product-entry')
    expect(createBootstrap).toHaveBeenCalledOnce()
    expect(bootstrap).toHaveBeenCalledOnce()
    const product = createBootstrap.mock.calls[0]?.[0] as unknown as {
      startupPluginPolicy: { enforce: typeof enforce; read: typeof read }
      identity: typeof ENTERPRISE_IDENTITY
      harnessPatches: { normal: string; safe: string; market: string }
      profileMaintenance: (context: { dshHome: string; note: (line: string) => void }) => Promise<void>
      startEnterprise: typeof startEnterprise
      loginLink: { fromArgv: unknown; parse: unknown; registerProtocol: unknown; sameOrigin: unknown }
      registerChatIpc: (registry: ReturnType<typeof createTrustedIpcRegistry>, view: () => undefined, window: () => BrowserWindow | undefined) => () => void
      createChatDisposer: (ipc: () => void, view: () => void) => () => void
    }
    expect(product.identity).toBe(ENTERPRISE_IDENTITY)
    expect(product.harnessPatches).toEqual({
      normal: 'dsh-desktop.patch.yml',
      safe: 'dsh-desktop-safe.patch.yml',
      market: 'dsh-desktop-market.patch.yml'
    })
    expect(product.startupPluginPolicy).toEqual({ enforce, read })
    const note = vi.fn()
    migrate.mockResolvedValueOnce({ changed: true, removed: ['old'] })
    await product.profileMaintenance({ dshHome: '/profile', note })
    expect(migrate).toHaveBeenCalledWith('/profile')
    expect(note).toHaveBeenCalledWith('[enterprise] retired legacy settings: old')
    migrate.mockRejectedValueOnce(new Error('disk failure'))
    await expect(product.profileMaintenance({ dshHome: '/profile', note })).resolves.toBeUndefined()
    expect(note).toHaveBeenCalledWith('[enterprise] legacy settings migration failed: disk failure')
    expect(product.startEnterprise).toBe(startEnterprise)
    expect(product.loginLink).toEqual({
      fromArgv: loginLink.enterpriseLoginFromArgv,
      parse: loginLink.parseEnterpriseLoginLink,
      registerProtocol: loginLink.registerEnterpriseLoginProtocol,
      sameOrigin: loginLink.sameHarnessOrigin
    })
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc = {
      handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
        if (handlers.has(channel)) throw new Error('conflict')
        handlers.set(channel, handler)
      },
      removeHandler(channel: string) { handlers.delete(channel) }
    }
    const trusted = {} as IpcMainInvokeEvent
    const registry = createTrustedIpcRegistry(ipc, event => { if (event !== trusted) throw new Error('untrusted') })
    const external = vi.fn()
    handlers.set('enterprise-chat:usage', external)
    expect(() => product.registerChatIpc(registry, () => undefined, () => undefined)).toThrow('conflict')
    expect([...handlers.entries()]).toEqual([['enterprise-chat:usage', external]])
    handlers.delete('enterprise-chat:usage')
    const disposeIpc = product.registerChatIpc(registry, () => undefined, () => undefined)
    const state = handlers.get('enterprise-chat:state')
    expect(state?.(trusted)).toEqual({ phase: 'idle', connected: false })
    expect(() => state?.({} as IpcMainInvokeEvent)).toThrow('untrusted')
    const disposeView = vi.fn(() => expect(handlers.size).toBe(0))
    const dispose = product.createChatDisposer(disposeIpc, disposeView)
    dispose()
    dispose()
    expect(disposeView).toHaveBeenCalledOnce()
    expect(handlers.size).toBe(0)
  } finally {
    vi.doUnmock('../src/main/enterprise/startup-plugin-policy')
    vi.doUnmock('../src/main/enterprise/legacy-settings-migration')
    vi.doUnmock('../src/main/enterprise/login-link')
    vi.doUnmock('../src/main/index')
    vi.doUnmock('../src/main/enterprise/static-extension-adapter')
    vi.resetModules()
  }
})
