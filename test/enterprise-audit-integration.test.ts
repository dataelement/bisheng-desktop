import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { apply as applyEnterprise } from '../packages/dsh-desktop-enterprise/index.js'
import { createMockEnterpriseServer } from '../scripts/mock-bisheng-enterprise.mjs'
import { startEnterpriseCredentialBroker } from '../src/main/enterprise/credential-broker'
import { createEnterpriseFetch } from '../src/main/enterprise/platform-fetch'
import { EnterpriseService } from '../src/main/enterprise/enterprise-service'
import { SecureEnterpriseCredentialVault, ENTERPRISE_VAULT_FILENAME } from '../src/main/enterprise/secure-credential-vault'

const cleanups: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  delete process.env.DSH_DESKTOP_ENTERPRISE_BROKER_URL
  delete process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY
  delete process.env.DSH_DESKTOP_ENTERPRISE_ALLOW_INSECURE_LOOPBACK
})

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Audit integration state did not become ready.')
}

async function login(service: EnterpriseService, origin: string) {
  const started = await service.startLogin(origin)
  const authId = new URL(started.authorizationUrl).searchParams.get('auth_id') ?? ''
  const html = await fetch(origin + '/__mock/authorize', {
    method: 'POST', body: new URLSearchParams({
      auth_id: authId, email: 'alice@demo.bisheng.local', password: 'WorkBuddy123!', decision: 'allow'
    })
  }).then((response) => response.text())
  const callback = /location\.replace\((".*?")\)/u.exec(html)?.[1]
  if (!callback) throw new Error('Mock authorization returned no callback.')
  await fetch(JSON.parse(callback) as string)
  await waitFor(() => service.snapshot().phase === 'connected')
}

function vaultAt(path: string) {
  return new SecureEnterpriseCredentialVault(path, {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
    encryptString: (plain) => Buffer.from(plain),
    decryptString: (encrypted) => Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength).toString()
  })
}

interface Adapter {
  stream(options: { model: string, sessionId?: string, purpose?: string, messages: Array<{ role: string, content: Array<{ type: string, text: string }> }> }): AsyncIterable<unknown>
}
interface Route { path: string, fetch(request: Request): Promise<Response> }

async function plugin(service: EnterpriseService) {
  const broker = await startEnterpriseCredentialBroker(service, { allowInsecureLoopback: true })
  cleanups.push(() => broker.stop())
  process.env.DSH_DESKTOP_ENTERPRISE_BROKER_URL = broker.url
  process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY = broker.capability
  process.env.DSH_DESKTOP_ENTERPRISE_ALLOW_INSECURE_LOOPBACK = '1'
  const routes: Route[] = []
  let adapter: Adapter | undefined
  applyEnterprise({
    provide() {},
    connection: { fetch: { register: (route: Route) => { routes.push(route); return () => undefined } } },
    llm: { registerAdapter: (_providers: string[], value: Adapter) => {
      adapter = value
      return Object.assign(() => undefined, { replace: () => undefined })
    } },
    effect: (callback: () => (() => unknown) | undefined) => {
      const dispose = callback()
      if (dispose) cleanups.push(dispose)
    }
  } as never)
  const update = async () => {
    const route = routes.find((candidate) => candidate.path === '/api/enterprise.state')
    if (!route) throw new Error('Enterprise state route not registered.')
    await route.fetch(new Request('http://127.0.0.1/api/enterprise.state'))
    await waitFor(() => adapter !== undefined)
  }
  await update()
  return {
    update,
    async call(sessionId?: string, purpose?: string) {
      if (!adapter) throw new Error('Adapter not registered.')
      for await (const event of adapter.stream({
        model: 'bisheng:42', sessionId, purpose,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic audit hello' }] }]
      })) void event
    }
  }
}

describe('audit context full desktop chain against synthetic mock', () => {
  it('negotiates fields, preserves persisted sessions after restart, and does not replay requests', async () => {
    const platform = createMockEnterpriseServer({ port: 0, auditContext: { fields: ['conversation_id', 'request_kind'] } })
    const origin = await platform.listen()
    cleanups.push(() => platform.close())
    const root = await mkdtemp(join(tmpdir(), 'dsh-model-audit-'))
    const credentialPath = join(root, ENTERPRISE_VAULT_FILENAME)
    let failConfig = false
    const fetchImpl = createEnterpriseFetch(async (input, init) => {
      if (failConfig && String(input).endsWith('/api/v1/dsh/config')) throw new Error('synthetic config outage')
      return fetch(input, init)
    })
    const service = new EnterpriseService({ vault: vaultAt(credentialPath), fetchImpl, allowInsecureLoopback: true })
    cleanups.push(() => service.stop())
    await login(service, origin)
    expect(service.snapshot().audit_context?.fields).toEqual(['conversation_id', 'request_kind'])
    const path = join(root, 'sessions')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root: path, compression: 'zstd' })
    const id = SessionId('persisted-audit-session')
    const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
    await handle.flush()
    await handle.close()
    await fiber.dispose()
    const first = await plugin(service)
    const initialConfigCount = platform.state.configRequests
    for (const purpose of [undefined, 'compaction', 'session-title', 'future-purpose']) await first.call(id, purpose)
    await first.call('fork-session')
    await first.call()
    expect(platform.state.configRequests).toBe(initialConfigCount)
    const requests = platform.state.chatRequests as Array<{ audit_context?: { conversation_id?: string, request_kind?: string } }>
    expect(requests.slice(0, 4).map((request) => request.audit_context?.conversation_id)).toEqual([id, id, id, id])
    expect(requests.slice(0, 4).map((request) => request.audit_context?.request_kind)).toEqual(['chat', 'compaction', 'session-title', undefined])
    expect(requests[4]?.audit_context?.conversation_id).toBe('fork-session')
    expect(requests[5]?.audit_context).toEqual({ request_kind: 'chat' })
    platform.state.auditContext = { fields: ['conversation_id'] }
    await service.refreshAuditCapability()
    await first.update()
    await first.call(id)
    expect(requests[6]?.audit_context).toEqual({ conversation_id: id })
    failConfig = true
    await service.refreshAuditCapability()
    expect(service.snapshot().modelsAvailable).toBe(true)
    await first.update()
    await first.call(id)
    expect(requests[7]?.audit_context).toBeUndefined()
    expect(requests).toHaveLength(8)
    await service.stop()
    failConfig = false
    platform.state.auditContext = { fields: ['conversation_id', 'request_kind'] }
    const restarted = new EnterpriseService({ vault: vaultAt(credentialPath), fetchImpl, allowInsecureLoopback: true })
    cleanups.push(() => restarted.stop())
    expect(restarted.snapshot()).not.toHaveProperty('audit_context')
    await restarted.restore()
    await waitFor(() => restarted.snapshot().modelsAvailable)
    const reopened = new Context()
    await reopened.plugin(SessionStore)
    const reader = await reopened.plugin(JsonlSessionPersistence, { root: path, compression: 'zstd' })
    cleanups.push(() => reader.dispose())
    const recovered = (await reopened.sessionPersistence.list())[0]?.header.id
    expect(recovered).toBe(id)
    const second = await plugin(restarted)
    await second.call(recovered)
    expect(requests[8]?.audit_context).toEqual({ conversation_id: id, request_kind: 'chat' })
    await restarted.logout()
    expect(restarted.snapshot()).not.toHaveProperty('audit_context')
  })
})
