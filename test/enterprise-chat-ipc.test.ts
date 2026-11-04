import { readFileSync } from 'node:fs'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { createEnterpriseChatDisposer, EnterpriseChatIpcRegistrationError, registerEnterpriseChatIpc } from '../src/main/enterprise/chat-ipc'
import type { EnterpriseChatIpcView } from '../src/main/enterprise/chat-ipc'
import { StaticExtensionLifecycle } from '../src/main/static-extension-lifecycle'
import { createTrustedIpcRegistry } from '../src/main/trusted-ipc-registry'
import { parseChatId, parseChatPage, parseChatPresentation } from '../src/shared/enterprise-chat-view'

it('logs only the cleanup phase and category on synchronous quit', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  expect(source).toContain("const category = error instanceof AggregateError ? 'aggregate' : 'error'")
  expect(source).toContain('console.warn(`[desktop] enterprise_chat_shutdown_failed phase=cleanup category=${category}`)')
  expect(source).not.toMatch(/console\.warn\([^\n]*enterprise_chat_shutdown_failed[^\n]*,\s*error/)
})

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
function fixture() {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle(channel: string, handler: Handler) { if (handlers.has(channel)) throw new Error('conflict'); handlers.set(channel, handler) },
    removeHandler(channel: string) { handlers.delete(channel) }
  }
  const sender = {}, frame = {}
  const event = { sender, senderFrame: frame } as IpcMainInvokeEvent
  const registry = createTrustedIpcRegistry(ipc, e => { if (e.sender !== sender || e.senderFrame !== frame) throw new Error('untrusted') })
  const window = {} as BrowserWindow
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get('enterprise-chat:' + channel)
    if (!handler) throw new Error('missing handler')
    return handler(event, ...args)
  }
  return { handlers, registry, window, invoke, event }
}

it('retains fallback behavior when enterprise startup failed', () => {
  const f = fixture()
  const dispose = registerEnterpriseChatIpc(f.registry, () => undefined, () => f.window)
  expect(f.invoke('state')).toEqual({ phase: 'idle', connected: false })
  expect(f.invoke('present', null)).toEqual({ phase: 'idle', connected: false })
  for (const name of ['retry', 'focus-settings', 'history', 'open', 'open-page']) expect(f.invoke(name)).toBeUndefined()
  expect(() => f.invoke('usage')).toThrow('Enterprise usage unavailable.')
  dispose(); dispose()
  expect(f.handlers.size).toBe(0)
})

it('validates sender before forwarding and retains view parameter validation', () => {
  const f = fixture()
  const view = {
    present: vi.fn((_window: BrowserWindow, input: unknown) => parseChatPresentation(input)),
    history: vi.fn((input: unknown) => Promise.resolve(parseChatPage(input))),
    open: vi.fn((input: unknown) => { parseChatId(input); return Promise.resolve() }),
    openPage: vi.fn((input: unknown) => { parseChatId(input); return Promise.resolve() }),
    snapshot: vi.fn(() => ({ phase: 'idle', connected: false })), retry: vi.fn(), focusSettings: vi.fn(), usage: vi.fn()
  } satisfies EnterpriseChatIpcView
  let owner: BrowserWindow | undefined
  registerEnterpriseChatIpc(f.registry, () => view, () => owner)
  expect(() => f.invoke('present', null)).toThrow('window unavailable')
  owner = f.window
  expect(() => f.invoke('present', null)).toThrow()
  const handler = f.handlers.get('enterprise-chat:state') as Handler
  expect(() => handler({ ...f.event, sender: {} } as IpcMainInvokeEvent)).toThrow('untrusted')
  expect(() => handler({ ...f.event, senderFrame: null })).toThrow('untrusted')
  for (const [channel, value] of [['history', -1], ['open', '../'], ['open-page', '../']] as const) {
    expect(() => f.invoke(channel, value)).toThrow()
  }
  f.invoke('retry'); f.invoke('focus-settings'); f.invoke('usage')
  expect(view.retry).toHaveBeenCalledOnce()
  expect(view.focusSettings).toHaveBeenCalledOnce()
  expect(view.usage).toHaveBeenCalledOnce()
})

it('rolls back only acquired channels on conflict and permits later registration', () => {
  const f = fixture()
  const external = vi.fn()
  f.handlers.set('enterprise-chat:usage', external)
  expect(() => registerEnterpriseChatIpc(f.registry, () => undefined, () => f.window)).toThrow('conflict')
  expect([...f.handlers.entries()]).toEqual([['enterprise-chat:usage', external]])
  f.handlers.delete('enterprise-chat:usage')
  const first = registerEnterpriseChatIpc(f.registry, () => undefined, () => f.window)
  first()
  const second = registerEnterpriseChatIpc(f.registry, () => undefined, () => f.window)
  first()
  expect(f.handlers.size).toBe(8)
  second()
  expect(f.handlers.size).toBe(0)
})

it('stops IPC before the view and service for repeated shutdown', async () => {
  const f = fixture()
  const lifecycle = new StaticExtensionLifecycle()
  const order: string[] = []
  await lifecycle.start([onDispose => {
    onDispose(() => { order.push('service') })
    onDispose(() => { expect(f.handlers.size).toBe(0); order.push('view') })
    onDispose(registerEnterpriseChatIpc(f.registry, () => undefined, () => f.window))
  }])
  await lifecycle.stop()
  await lifecycle.stop()
  expect(order).toEqual(['view', 'service'])
})


it('attempts both cleanup steps and retries failures only', () => {
  const ipc = vi.fn().mockImplementationOnce(() => { throw new Error('ipc') })
  const view = vi.fn().mockImplementationOnce(() => { throw new Error('view') })
  const dispose = createEnterpriseChatDisposer(ipc, view)
  expect(() => dispose()).toThrow(AggregateError)
  expect(ipc).toHaveBeenCalledOnce()
  expect(view).toHaveBeenCalledOnce()
  dispose(); dispose()
  expect(ipc).toHaveBeenCalledTimes(2)
  expect(view).toHaveBeenCalledTimes(2)
})

it('retries failed channel cleanup after attempting all channels', () => {
  const handlers = new Map<string, Handler>()
  let fail = true
  const registry = createTrustedIpcRegistry({
    handle(channel, handler) { handlers.set(channel, handler) },
    removeHandler(channel) {
      if (channel === 'enterprise-chat:history' && fail) { fail = false; throw new Error('remove failed') }
      handlers.delete(channel)
    }
  }, () => {})
  const dispose = registerEnterpriseChatIpc(registry, () => undefined, () => undefined)
  expect(() => dispose()).toThrow(AggregateError)
  expect([...handlers.keys()]).toEqual(['enterprise-chat:history'])
  dispose()
  expect(handlers.size).toBe(0)
})


it('retains the registration error when rollback also fails', () => {
  const conflict = new Error('conflict')
  const cleanup = new Error('cleanup')
  const registry = createTrustedIpcRegistry({
    handle(channel) { if (channel === 'enterprise-chat:state') throw conflict },
    removeHandler() { throw cleanup }
  }, () => {})
  try {
    registerEnterpriseChatIpc(registry, () => undefined, () => undefined)
    throw new Error('expected registration failure')
  } catch (error) {
    expect(error).toBeInstanceOf(EnterpriseChatIpcRegistrationError)
    const aggregate = error as EnterpriseChatIpcRegistrationError
    expect(aggregate.cause).toBe(conflict)
    expect(aggregate.errors[0]).toBe(conflict)
    expect(aggregate.errors[1]).toBeInstanceOf(AggregateError)
    expect((aggregate.errors[1] as AggregateError).errors).toContain(cleanup)
  }
})

it('retains failed registration cleanup in the host lifecycle until it succeeds', async () => {
  const handlers = new Map<string, Handler>()
  const external = vi.fn()
  handlers.set('enterprise-chat:state', external)
  const conflict = new Error('registration conflict')
  const cleanup = new Error('remove failed')
  let failures = 3
  const registry = createTrustedIpcRegistry({
    handle(channel, handler) {
      if (handlers.has(channel)) throw conflict
      handlers.set(channel, handler)
    },
    removeHandler(channel) {
      if (channel === 'enterprise-chat:present' && failures-- > 0) throw cleanup
      handlers.delete(channel)
    }
  }, () => {})
  const lifecycle = new StaticExtensionLifecycle()
  let registrationFailure: unknown
  await expect(lifecycle.start([onDispose => {
    try {
      onDispose(registerEnterpriseChatIpc(registry, () => undefined, () => undefined, onDispose))
    } catch (error) {
      registrationFailure = error
      throw error
    }
  }])).rejects.toBeInstanceOf(AggregateError)
  expect(registrationFailure).toBeInstanceOf(EnterpriseChatIpcRegistrationError)
  const failure = registrationFailure as EnterpriseChatIpcRegistrationError
  expect(failure.cause).toBe(conflict)
  expect((failure.errors[1] as AggregateError).errors).toContain(cleanup)
  expect([...handlers.keys()]).toEqual(['enterprise-chat:state', 'enterprise-chat:present'])
  await expect(lifecycle.stop()).rejects.toThrow('Extension cleanup failed')
  expect(handlers.get('enterprise-chat:state')).toBe(external)
  await lifecycle.stop()
  await lifecycle.stop()
  expect([...handlers.entries()]).toEqual([['enterprise-chat:state', external]])
  handlers.delete('enterprise-chat:state')
  const dispose = registerEnterpriseChatIpc(registry, () => undefined, () => undefined)
  expect(handlers.size).toBe(8)
  dispose()
  expect(handlers.size).toBe(0)
})
