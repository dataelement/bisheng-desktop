import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createTrustedIpcRegistry } from '../src/main/trusted-ipc-registry'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fixture() {
  const handlers = new Map<string, Listener>()
  const ipc = {
    handle: vi.fn((channel: string, listener: Listener) => {
      if (handlers.has(channel)) throw new Error('already installed')
      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel) })
  }
  let window = { sender: {}, frame: {} }
  let destroyed = false
  const registry = createTrustedIpcRegistry(ipc, event => {
    if (destroyed || event.sender !== window.sender || event.senderFrame !== window.frame) throw new Error('untrusted')
  })
  const event = () => ({ sender: window.sender, senderFrame: window.frame } as IpcMainInvokeEvent)
  return { handlers, ipc, registry, event, replaceWindow: () => { window = { sender: {}, frame: {} } }, destroy: () => { destroyed = true } }
}

describe('trusted IPC registry', () => {
  it('checks the current sender and frame before invoking business logic', () => {
    const f = fixture()
    const business = vi.fn((_event: IpcMainInvokeEvent, value: unknown) => value)
    f.registry.register('extension:read', business)
    const invoke = f.handlers.get('extension:read') as Listener
    const old = f.event()
    expect(invoke(old, 'ok')).toBe('ok')
    expect(() => invoke({ ...old, sender: {} } as IpcMainInvokeEvent)).toThrow('untrusted')
    expect(() => invoke({ ...old, senderFrame: null })).toThrow('untrusted')
    f.replaceWindow()
    expect(() => invoke(old)).toThrow('untrusted')
    expect(invoke(f.event(), 'new')).toBe('new')
    f.destroy()
    expect(() => invoke(f.event())).toThrow('untrusted')
    expect(business).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid names and conflicts without replacing handlers', () => {
    const f = fixture()
    const handler = vi.fn()
    for (const name of ['', ' ', ' x ']) expect(() => f.registry.register(name, handler)).toThrow()
    f.registry.register('extension:read', handler)
    expect(() => f.registry.register('extension:read', vi.fn())).toThrow('already registered')
    expect(f.ipc.handle).toHaveBeenCalledTimes(1)
    f.handlers.get('extension:read')?.(f.event())
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rolls back failed registration without removing an existing external handler', () => {
    const f = fixture()
    const external = vi.fn()
    f.handlers.set('extension:read', external)
    expect(() => f.registry.register('extension:read', vi.fn())).toThrow('already installed')
    expect(f.ipc.removeHandler).not.toHaveBeenCalled()
    expect(f.handlers.get('extension:read')).toBe(external)
    f.handlers.delete('extension:read')
    expect(() => f.registry.register('extension:read', vi.fn())).not.toThrow()
  })

  it('disposes idempotently without removing a later generation', () => {
    const f = fixture()
    const first = f.registry.register('extension:read', vi.fn())
    first()
    const secondHandler = vi.fn()
    const second = f.registry.register('extension:read', secondHandler)
    first()
    f.handlers.get('extension:read')?.(f.event())
    expect(secondHandler).toHaveBeenCalledOnce()
    second()
    second()
    expect(f.ipc.removeHandler).toHaveBeenCalledTimes(2)
  })
})
