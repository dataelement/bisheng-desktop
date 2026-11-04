import type { BrowserWindow } from 'electron'
import type { createTrustedIpcRegistry } from '../trusted-ipc-registry'

export interface EnterpriseChatIpcView {
  present(window: BrowserWindow, input: unknown): unknown
  snapshot(): unknown
  retry(): void
  usage(): Promise<unknown>
  history(input: unknown): Promise<unknown>
  open(input: unknown): Promise<void>
  remove(id: unknown, epoch: unknown): Promise<{ epoch: number }>
  openPage(input: unknown): Promise<void>
  focusSettings(): void
}

export function createEnterpriseChatDisposer(disposeIpc: () => void, disposeView: () => void): () => void {
  let ipcPending = true
  let viewPending = true
  return () => {
    const errors: unknown[] = []
    if (ipcPending) {
      try { disposeIpc(); ipcPending = false } catch (error) { errors.push(error) }
    }
    if (viewPending) {
      try { disposeView(); viewPending = false } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Enterprise Chat cleanup failed')
  }
}

export class EnterpriseChatIpcRegistrationError extends AggregateError {
  constructor(registrationError: unknown, cleanupError: unknown, readonly dispose: () => void) {
    super([registrationError, cleanupError], 'Enterprise Chat IPC registration and cleanup failed', { cause: registrationError })
    this.name = 'EnterpriseChatIpcRegistrationError'
  }
}

export function registerEnterpriseChatIpc(
  registry: ReturnType<typeof createTrustedIpcRegistry>,
  view: () => EnterpriseChatIpcView | undefined,
  window: () => BrowserWindow | undefined,
  onFailedCleanup: (dispose: () => void) => void = () => {}
): () => void {
  const disposers: Array<() => void> = []
  const dispose = () => {
    const errors: unknown[] = []
    const failed: Array<() => void> = []
    while (disposers.length) {
      const item = disposers.pop()
      if (!item) continue
      try { item() } catch (error) { errors.push(error); failed.push(item) }
    }
    disposers.push(...failed.reverse())
    if (errors.length) throw new AggregateError(errors, 'Enterprise Chat IPC cleanup failed')
  }
  try {
    disposers.push(registry.register('enterprise-chat:focus-settings', () => { view()?.focusSettings() }))
    disposers.push(registry.register('enterprise-chat:present', (_event, input) => {
      const chat = view()
      if (!chat) return { phase: 'idle', connected: false }
      const owner = window()
      if (!owner) throw new Error('Enterprise Chat window unavailable.')
      return chat.present(owner, input) ?? { phase: 'idle', connected: false }
    }))
    disposers.push(registry.register('enterprise-chat:state', () => view()?.snapshot() ?? { phase: 'idle', connected: false }))
    disposers.push(registry.register('enterprise-chat:retry', () => { view()?.retry() }))
    disposers.push(registry.register('enterprise-chat:usage', () => {
      const chat = view()
      if (!chat) throw new Error('Enterprise usage unavailable.')
      return chat.usage()
    }))
    disposers.push(registry.register('enterprise-chat:history', (_event, page) => view()?.history(page)))
    disposers.push(registry.register('enterprise-chat:open-page', (_event, id) => view()?.openPage(id)))
    disposers.push(registry.register('enterprise-chat:open', (_event, id) => view()?.open(id)))
    disposers.push(registry.register('enterprise-chat:remove', (_event, id, epoch) => {
      const chat = view()
      if (!chat) throw new Error('Enterprise Chat unavailable.')
      return chat.remove(id, epoch)
    }))
  } catch (error) {
    try { dispose() } catch (cleanupError) {
      const failure = new EnterpriseChatIpcRegistrationError(error, cleanupError, dispose)
      try { onFailedCleanup(failure.dispose) } catch (handoffError) {
        throw new AggregateError([failure, handoffError], 'Enterprise Chat IPC cleanup handoff failed', { cause: failure })
      }
      throw failure
    }
    throw error
  }
  return dispose
}
