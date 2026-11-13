import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { LanMobileBridge } from '../src/main/mobile/lan-mobile-bridge'
import { startMobileAccessClient } from '../src/main/mobile/mobile-access-client'
import {
  MOBILE_ATTACH_PATH,
  MOBILE_BIND_PATH,
  MOBILE_UNBIND_PATH,
  REMOTE_CHANNEL_HEADER,
  REMOTE_CHANNEL_TOKEN_HEADER,
  REMOTE_TENANT_HEADER,
  REMOTE_USER_HEADER
} from '../src/main/mobile/mobile-access-protocol'
import {
  createFileMobileAccessStore,
  mobileAccessStorePath,
  parseMobileAccessRecord
} from '../src/main/mobile/mobile-access-store'

const bridges: LanMobileBridge[] = []
const clients: Array<{ stop(): Promise<void> }> = []
const servers: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()))
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('mobile access record', () => {
  it('keeps a partial file usable when fields are missing or invalid', () => {
    expect(parseMobileAccessRecord(null)).toEqual({})
    expect(parseMobileAccessRecord({ desktopId: 'short', displayName: '  办公室  ' })).toEqual({
      displayName: '办公室'
    })
    expect(parseMobileAccessRecord({
      desktopId: 'a'.repeat(32),
      attachSecret: 'b'.repeat(32),
      extra: true
    })).toEqual({
      desktopId: 'a'.repeat(32),
      attachSecret: 'b'.repeat(32)
    })
  })
})

describe('remote channel', () => {
  it('rejects a loopback call that is not the access channel and a mismatched account', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => undefined,
      port: 0,
      currentAccount: () => ({ userId: 'user-1', tenantId: 'tenant-1' })
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const port = snapshot.port!

    const lan = await fetch(`http://127.0.0.1:${port}/api/v1/status`)
    expect(lan.status).not.toBe(200)

    const wrongToken = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
      method: 'POST',
      headers: {
        [REMOTE_CHANNEL_HEADER]: 'remote',
        [REMOTE_CHANNEL_TOKEN_HEADER]: 'nope',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ method: 'session.list', payload: {} })
    })
    expect(wrongToken.status).toBe(401)

    const mismatch = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
      method: 'POST',
      headers: remoteHeaders(bridge, 'user-2', 'tenant-1'),
      body: JSON.stringify({ method: 'session.list', payload: {} })
    })
    expect(mismatch.status).toBe(401)
    expect(await mismatch.json()).toMatchObject({ error: 'account_switched' })

    const status = await fetch(`http://127.0.0.1:${port}/api/v1/status`, {
      headers: remoteHeaders(bridge, 'user-1', 'tenant-1')
    })
    expect(status.status).toBe(200)

    const denied = await fetch(`http://127.0.0.1:${port}/api/v1/rpc`, {
      method: 'POST',
      headers: remoteHeaders(bridge, 'user-1', 'tenant-1'),
      body: JSON.stringify({ method: 'plugin.install', payload: {} })
    })
    expect(denied.status).toBe(403)
  })

  it('loads workspaces for the signed-in app without a browser session', async () => {
    const harness = createServer((_request, response) => {
      response.statusCode = 404
      response.end()
    })
    const mux = new WebSocketServer({ noServer: true })
    harness.on('upgrade', (request, socket, head) => {
      const path = request.url?.split('?', 1)[0]
      if (path !== '/api/remote.mux') {
        socket.destroy()
        return
      }
      mux.handleUpgrade(request, socket, head, (client) => {
        client.send(JSON.stringify({
          type: 'item',
          streamId: 'mobile-workspaces',
          value: {
            type: 'baseline',
            value: {
              items: [
                { workspaceId: 'w1', title: 'harness', sessionIds: [] },
                { workspaceId: 'w2', title: '默认工作区', sessionIds: [] }
              ],
              archivedSessionIds: []
            }
          }
        }))
      })
    })
    await new Promise<void>((resolve) => harness.listen(0, '127.0.0.1', resolve))
    const address = harness.address()
    if (!address || typeof address === 'string') throw new Error('harness failed')
    const bridge = new LanMobileBridge({
      harnessUrl: () => `http://127.0.0.1:${address.port}`,
      port: 0,
      currentAccount: () => ({ userId: 'user-1', tenantId: 'tenant-1' })
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const response = await Promise.race([
      fetch(`http://127.0.0.1:${snapshot.port}/api/v1/rpc`, {
        method: 'POST',
        headers: remoteHeaders(bridge, 'user-1', 'tenant-1'),
        body: JSON.stringify({ method: 'workspace.list', payload: {} })
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('workspace.list did not answer')), 8_000)
      })
    ])
    expect(response.status).toBe(200)
    const body = await response.json() as { ok?: boolean, error?: string, value?: { items?: unknown[] } }
    expect(body.ok, JSON.stringify(body)).toBe(true)
    expect(body.value?.items).toHaveLength(2)
    for (const client of mux.clients) client.terminate()
    await bridge.stop()
    await new Promise<void>((resolve) => mux.close(() => resolve()))
    await new Promise<void>((resolve) => harness.close(() => resolve()))
  })

  it('does not start a third-party tunnel when remote mode is requested', async () => {
    let started = false
    const bridge = new LanMobileBridge({
      harnessUrl: () => undefined,
      port: 0,
      createCloudflareTunnel: async () => {
        started = true
        throw new Error('cloudflared should not start')
      },
      createPinggyTunnel: async () => {
        started = true
        throw new Error('pinggy should not start')
      }
    })
    bridges.push(bridge)
    await bridge.start()
    const snapshot = await bridge.toggleTunnel(true)
    expect(started).toBe(false)
    expect(snapshot.tunnelActive).toBe(false)
    expect(snapshot.tunnelProvider).toBeUndefined()
  })
})

describe('mobile access client', () => {
  it('binds and forwards only while the same account stays signed in', async () => {
    const origin = await startAccessStub()
    const bridge = new LanMobileBridge({
      harnessUrl: () => undefined,
      port: 0,
      currentAccount: () => ({ userId: 'user-1', tenantId: 'tenant-1' })
    })
    bridges.push(bridge)
    await bridge.start()
    const directory = mkdtempSync(join(tmpdir(), 'mobile-access-'))
    let account = {
      base: origin.base,
      accessToken: 'desktop-token',
      userId: 'user-1',
      tenantId: 'tenant-1'
    }
    const client = startMobileAccessClient({
      account: () => account,
      bridge: {
        port: () => bridge.listeningPort(),
        channelToken: () => bridge.remoteChannelToken()
      },
      store: createFileMobileAccessStore(mobileAccessStorePath(directory)),
      displayName: () => '测试电脑',
      fetchImpl: fetch
    })
    clients.push(client)

    const forwarded = await origin.nextRequest()
    expect(forwarded.authorization).toBe('Bearer desktop-token')
    expect(forwarded.userId).toBe('user-1')
    expect(forwarded.tenantId).toBe('tenant-1')
    expect(forwarded.status).toBe(200)

    account = { base: origin.base, accessToken: 'desktop-token', userId: 'user-2', tenantId: 'tenant-1' }
    await origin.nextUnbind()
  })

  it('stays disconnected when the BiSheng origin has no access path', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => undefined,
      port: 0
    })
    bridges.push(bridge)
    await bridge.start()
    const directory = mkdtempSync(join(tmpdir(), 'mobile-access-'))
    const notes: string[] = []
    const client = startMobileAccessClient({
      account: () => ({
        base: 'http://127.0.0.1:9',
        accessToken: 'desktop-token',
        userId: 'user-1',
        tenantId: 'tenant-1'
      }),
      bridge: {
        port: () => bridge.listeningPort(),
        channelToken: () => bridge.remoteChannelToken()
      },
      store: createFileMobileAccessStore(mobileAccessStorePath(directory)),
      displayName: () => undefined,
      fetchImpl: fetch,
      note: (message) => notes.push(message)
    })
    clients.push(client)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(notes.some((message) => message.includes('bind_failed') || message.includes('bind_unavailable'))).toBe(true)
    expect(notes.join('\n')).not.toContain('desktop-token')
  })
})

function remoteHeaders(bridge: LanMobileBridge, userId: string, tenantId: string): Record<string, string> {
  return {
    [REMOTE_CHANNEL_HEADER]: 'remote',
    [REMOTE_CHANNEL_TOKEN_HEADER]: bridge.remoteChannelToken(),
    [REMOTE_USER_HEADER]: userId,
    [REMOTE_TENANT_HEADER]: tenantId,
    'content-type': 'application/json'
  }
}

function startAccessStub(): Promise<{
  base: string
  nextRequest(): Promise<{ authorization?: string, userId?: string, tenantId?: string, status: number }>
  nextUnbind(): Promise<void>
  close(): Promise<void>
}> {
  const requests: Array<(value: { authorization?: string, userId?: string, tenantId?: string, status: number }) => void> = []
  const unbinds: Array<() => void> = []
  let authorization: string | undefined
  let socket: WebSocket | undefined
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === MOBILE_BIND_PATH) {
      authorization = request.headers.authorization
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
      return
    }
    if (request.method === 'POST' && url.pathname === MOBILE_UNBIND_PATH) {
      response.writeHead(200)
      response.end()
      unbinds.splice(0).forEach((resolve) => resolve())
      return
    }
    response.writeHead(404)
    response.end()
  })
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, incoming, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== MOBILE_ATTACH_PATH) {
      incoming.destroy()
      return
    }
    sockets.handleUpgrade(request, incoming, head, (connected) => {
      socket = connected
      connected.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as { type?: string, status?: number }
        if (frame.type === 'attach') {
          connected.send(JSON.stringify({ type: 'attached' }))
          connected.send(JSON.stringify({
            type: 'request',
            id: 'req-1',
            method: 'GET',
            path: '/api/v1/status',
            headers: {
              [REMOTE_USER_HEADER]: 'user-1',
              [REMOTE_TENANT_HEADER]: 'tenant-1'
            }
          }))
          return
        }
        if (frame.type !== 'response') return
        const pending = requests.shift()
        pending?.({
          authorization,
          userId: 'user-1',
          tenantId: 'tenant-1',
          status: frame.status ?? 0
        })
      })
    })
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('stub failed'))
        return
      }
      const stub = {
        base: `http://127.0.0.1:${address.port}`,
        nextRequest: () => new Promise<{ authorization?: string, userId?: string, tenantId?: string, status: number }>((done) => {
          requests.push(done)
        }),
        nextUnbind: () => new Promise<void>((done) => {
          unbinds.push(done)
        }),
        close: () => new Promise<void>((done) => {
          socket?.close()
          sockets.close()
          server.close(() => done())
        })
      }
      servers.push(stub)
      resolve(stub)
    })
  })
}
