import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { patchPath } from './patch-path'

function clientRequire(id: string): unknown {
  if (id === '@deepseek-ai/cordis') return { Context: { filter: Symbol('filter') } }
  if (id === '@deepseek-ai/dsh-api-gateway/client') {
    return {
      RemoteSnapshotStream: class RemoteSnapshotStream {},
      RemoteJournalStream: class RemoteJournalStream {},
      RemoteStreamCarrierError: class RemoteStreamCarrierError extends Error {},
      isRemoteFailure: () => false
    }
  }
  if (id === '@deepseek-ai/dsh-client-store') {
    return {
      notifySubscribers(listeners: Set<() => void>) {
        for (const listener of listeners) listener()
      },
      createSnapshotStore: () => ({})
    }
  }
  throw new Error(`Unexpected dependency: ${id}`)
}

interface SessionListItem {
  sessionId: string
  running: boolean
}

interface SessionSnapshot {
  running: boolean
}

interface SessionHandle {
  getSnapshot(): SessionSnapshot
  acceptEventChange(change: unknown): void
  installWindow(entries: unknown[], hasMore: boolean): void
}

interface SessionManagerHandle {
  get(sessionId: string): SessionHandle
  handleSessionAdded(summary: {
    sessionId: string
    updatedAt: number
    running: boolean
    blank: boolean
  }): void
  handleSessionStatus(sessionId: string, running: boolean): void
  suspendRunning(): void
  getListSnapshot(): { items: SessionListItem[] }
}

async function loadSessionManager(): Promise<new (remote: unknown) => SessionManagerHandle> {
  const source = await readFile(
    path.resolve('node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js'),
    'utf8'
  )
  let loaded!: { SessionManager: new (remote: unknown) => SessionManagerHandle }
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(definition: { factory(require: NodeRequire): typeof loaded }) {
          loaded = definition.factory(clientRequire as NodeRequire)
        }
      }
    },
    console,
    queueMicrotask,
    setTimeout,
    clearTimeout
  })
  return loaded.SessionManager
}

function liveEntry(type: string, seq: number, data: unknown) {
  return {
    event: {
      type,
      seq,
      time: seq,
      data
    }
  }
}

function listRunning(manager: SessionManagerHandle, sessionId: string): boolean {
  const item = manager.getListSnapshot().items.find((entry) => entry.sessionId === sessionId)
  if (item === undefined) throw new Error(`missing session ${sessionId}`)
  return item.running
}

describe('live turn evidence after a dropped session status', () => {
  it('clears running when a live turn ends in error and restores it on the next turn', async () => {
    const SessionManager = await loadSessionManager()
    const manager = new SessionManager({})
    const sessionId = 'offline-turn'
    manager.handleSessionAdded({ sessionId, updatedAt: 1, running: true, blank: false })
    const session = manager.get(sessionId)
    expect(session.getSnapshot().running).toBe(true)
    expect(listRunning(manager, sessionId)).toBe(true)

    session.acceptEventChange({
      type: 'append',
      entry: liveEntry('turn/end', 2, {
        turn: 1,
        reason: { kind: 'error', error: { message: 'Enterprise Responses generation failed.' } }
      })
    })
    expect(session.getSnapshot().running).toBe(false)
    expect(listRunning(manager, sessionId)).toBe(false)

    session.acceptEventChange({
      type: 'append',
      entry: liveEntry('turn/start', 3, { turn: 2 })
    })
    expect(session.getSnapshot().running).toBe(true)
    expect(listRunning(manager, sessionId)).toBe(true)
  })

  it('leaves running unchanged for a completed turn, a missing reason, and replayed history', async () => {
    const SessionManager = await loadSessionManager()
    const manager = new SessionManager({})
    const sessionId = 'still-running'
    manager.handleSessionAdded({ sessionId, updatedAt: 1, running: true, blank: false })
    const session = manager.get(sessionId)

    session.acceptEventChange({
      type: 'append',
      entry: liveEntry('turn/end', 2, { turn: 1, reason: { kind: 'stop' } })
    })
    session.acceptEventChange({
      type: 'append',
      entry: liveEntry('turn/end', 3, { turn: 1 })
    })
    session.installWindow([
      liveEntry('turn/end', 1, {
        turn: 1,
        reason: { kind: 'error', error: { message: 'older failure' } }
      })
    ], false)

    expect(session.getSnapshot().running).toBe(true)
    expect(listRunning(manager, sessionId)).toBe(true)
  })

  it('clears running for every live session when the browser goes offline', async () => {
    const SessionManager = await loadSessionManager()
    const manager = new SessionManager({})
    manager.handleSessionAdded({ sessionId: 'active', updatedAt: 1, running: true, blank: false })
    manager.handleSessionAdded({ sessionId: 'idle', updatedAt: 1, running: false, blank: false })
    manager.handleSessionAdded({ sessionId: 'resident', updatedAt: 1, running: false, blank: false })
    const active = manager.get('active')
    const idle = manager.get('idle')
    manager.handleSessionStatus('resident', true)
    const resident = manager.get('resident')
    expect(resident.getSnapshot().running).toBe(true)

    manager.suspendRunning()

    expect(active.getSnapshot().running).toBe(false)
    expect(listRunning(manager, 'active')).toBe(false)
    expect(idle.getSnapshot().running).toBe(false)
    expect(listRunning(manager, 'idle')).toBe(false)
    expect(resident.getSnapshot().running).toBe(false)
    expect(listRunning(manager, 'resident')).toBe(false)
  })

  it('keeps the live evidence hook in the session-controller patch', async () => {
    const patch = await readFile(patchPath('@deepseek-ai/dsh-api-session-controller'), 'utf8')
    expect(patch).toContain('this.reportLiveRunningEvidence(event);')
    expect(patch).toContain('event?.type === "turn/end" && event.data?.reason?.kind === "error"')
    expect(patch).toContain('onRunningEvidence: (running) => {')
    expect(patch).toContain('this.handleSessionStatus(sessionId, running);')
    expect(patch).toContain('suspendRunning() {')
    expect(patch).toContain('connection.state?.getSnapshot() !== "disconnected"')
    expect(patch).toContain('sessions.suspendRunning();')
  })
})
