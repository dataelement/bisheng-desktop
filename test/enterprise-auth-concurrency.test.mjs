import { expect, it, vi } from 'vitest'
import { EnterpriseAuthTransport } from '../packages/dsh-desktop-enterprise/desktop/enterprise-auth'
import { startEnterpriseCredentialBroker } from '../packages/dsh-desktop-enterprise/desktop/credential-broker'

it.each(['complete', 'logout', 'revoke'])('keeps twelve plugin requests in flight and cleans up on %s', async mode => {
  const transport = new EnterpriseAuthTransport()
  const streams = [], audit = vi.fn()
  const service = {
    authState: () => ({ connected: true, sessionVersion: 'v1' }),
    authRequest: (plugin, input, signal) => transport.request(plugin, input, signal, {
      assertSession: version => { if (version !== 'v1') throw new Error('wrong session') },
      access: async () => ({ endpoint: 'https://enterprise.example.test/api/test', accessToken: 'fixture' }),
      fetch: async () => new Response(new ReadableStream({ start(controller) { streams.push(controller) } })),
      audit
    })
  }
  const broker = await startEnterpriseCredentialBroker(service)
  const request = (path, capability, body) => fetch(broker.url + path, {
    method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
  })
  try {
    const grantResponse = await request('/v1/auth/grant', broker.capability, { pluginId: 'fixture', instanceId: 'one' })
    const { capability } = await grantResponse.json()
    const responses = await Promise.all(Array.from({ length: 12 }, () => request('/v1/auth/request', capability, {
      path: '/api/test', sessionVersion: 'v1'
    })))
    expect(responses.map(response => response.status)).toEqual(Array(12).fill(200))
    expect(streams).toHaveLength(12)
    expect(audit).not.toHaveBeenCalled()
    const bodies = Promise.allSettled(responses.map(response => response.text()))
    if (mode === 'complete') {
      for (const stream of streams) { stream.enqueue(new TextEncoder().encode('ok')); stream.close() }
    } else if (mode === 'logout') transport.invalidate()
    else {
      const revoked = await request('/v1/auth/revoke', broker.capability, { capability })
      expect(revoked.status).toBe(200)
      await revoked.text()
    }
    const results = await bodies
    expect(results.every(result => result.status === (mode === 'complete' ? 'fulfilled' : 'rejected'))).toBe(true)
    await vi.waitFor(() => expect(audit).toHaveBeenCalledTimes(12))
    expect(transport.active.size).toBe(0)
  } finally {
    transport.invalidate()
    await broker.stop()
  }
})
