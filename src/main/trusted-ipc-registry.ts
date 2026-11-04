import type { IpcMainInvokeEvent } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

interface IpcMainLike {
  handle(channel: string, listener: Handler): void
  removeHandler(channel: string): void
}

export function createTrustedIpcRegistry(
  ipc: IpcMainLike,
  assertTrustedEvent: (event: IpcMainInvokeEvent) => void
) {
  const owners = new Map<string, symbol>()

  return {
    register(channel: string, handler: Handler): () => void {
      if (typeof channel !== 'string' || !channel.trim() || channel !== channel.trim()) {
        throw new Error('IPC channel must be a non-empty name.')
      }
      if (owners.has(channel)) throw new Error(`IPC channel already registered: ${channel}`)
      const owner = Symbol(channel)
      owners.set(channel, owner)
      try {
        ipc.handle(channel, (event, ...args) => {
          assertTrustedEvent(event)
          return handler(event, ...args)
        })
      } catch (error) {
        owners.delete(channel)
        throw error
      }
      return () => {
        if (owners.get(channel) !== owner) return
        ipc.removeHandler(channel)
        owners.delete(channel)
      }
    }
  }
}
