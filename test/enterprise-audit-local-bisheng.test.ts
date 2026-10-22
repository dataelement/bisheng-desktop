import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyEnterprise } from '../packages/dsh-desktop-enterprise/index.js'
import { startEnterpriseCredentialBroker } from '../src/main/enterprise/credential-broker'
import { createEnterpriseFetch } from '../src/main/enterprise/platform-fetch'
import { EnterpriseService } from '../src/main/enterprise/enterprise-service'
import { SecureEnterpriseCredentialVault, ENTERPRISE_VAULT_FILENAME } from '../src/main/enterprise/secure-credential-vault'

// Opt-in, loopback-only integration. Never borrow a user's Desktop profile or credentials.
const enabled = process.env.DSH_AUDIT_LOCAL_FIXTURE === '1'
const cleanups: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  delete process.env.DSH_DESKTOP_ENTERPRISE_BROKER_URL
  delete process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY
  delete process.env.DSH_DESKTOP_ENTERPRISE_ALLOW_INSECURE_LOOPBACK
})

function setting(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing local synthetic fixture setting: ${name}`)
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object from local test service.')
  return value as Record<string, unknown>
}

function data(value: unknown): unknown {
  const object = record(value)
  return Object.hasOwn(object, 'data') ? object.data : object
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read()
    if (accept(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Local audit facts did not become queryable in the controlled drain window.')
}

interface Route { path: string, fetch(request: Request): Promise<Response> }
interface Message { role: string, content: Array<{ type: string, text: string }> }
interface Adapter {
  stream(options: { model: string, sessionId?: string, purpose?: string, messages: Message[] }): AsyncIterable<unknown>
}
interface ObservedRequest {
  request: Record<string, unknown>
  headerRequestId?: string
  responseBody?: Promise<string>
}

describe.skipIf(!enabled)('Desktop to local BiSheng actual audit implementation', () => {
  it('keeps five core calls plus two exact-ID probes and verifies ordered metadata/content through admin HTTP', async () => {
    const url = new URL(setting('DSH_AUDIT_LOCAL_BASE'))
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Local fixture BASE must be an explicit HTTP loopback origin.')
    }
    const base = url.origin
    const accessToken = setting('DSH_AUDIT_LOCAL_ACCESS_TOKEN')
    const adminToken = setting('DSH_AUDIT_LOCAL_ADMIN_TOKEN')
    const tenantId = setting('DSH_AUDIT_LOCAL_TENANT_ID')
    const userId = setting('DSH_AUDIT_LOCAL_USER_ID')
    const model = process.env.DSH_AUDIT_LOCAL_MODEL ?? 'bisheng:42'
    const directory = await mkdtemp(join(tmpdir(), 'dsh-local-bisheng-audit-'))
    const vault = new SecureEnterpriseCredentialVault(join(directory, ENTERPRISE_VAULT_FILENAME), {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
      encryptString: (plain) => Buffer.from(plain),
      decryptString: (encrypted) => Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength).toString()
    })
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await vault.replace(0, {
      base, token_type: 'Bearer', access_token: accessToken,
      access_expires_at: expires, refresh_token: 'synthetic-local-refresh-not-used',
      refresh_expires_at: expires, session_expires_at: expires, session_id: 'synthetic-local-login',
      user: { id: userId, username: 'synthetic-local-user' }, tenant: { id: tenantId, name: 'Synthetic local tenant' }
    })
    const observed: ObservedRequest[] = []
    let configReads = 0
    const service = new EnterpriseService({
      vault, allowInsecureLoopback: true,
      fetchImpl: createEnterpriseFetch(async (input, init) => {
        const endpoint = new URL(String(input))
        if (endpoint.origin !== base) throw new Error('Test request left the local fixture origin.')
        if (endpoint.pathname === '/api/v1/dsh/config') configReads += 1
        const call = endpoint.pathname === '/api/v1/dsh/chat/completions'
          ? { request: record(JSON.parse(String(init?.body))) } as ObservedRequest : undefined
        if (call) observed.push(call)
        const response = await fetch(input, init)
        if (call) {
          call.headerRequestId = response.headers.get('x-request-id') ?? undefined
          call.responseBody = response.clone().text()
        }
        return response
      })
    })
    cleanups.push(() => service.stop())
    await service.restore()
    await eventually(async () => service.snapshot(), (state) => state.modelsAvailable)
    expect(service.snapshot().audit_context?.fields).toEqual(['conversation_id', 'request_kind'])
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
    const stateRoute = routes.find((route) => route.path === '/api/enterprise.state')
    if (!stateRoute) throw new Error('Actual enterprise plugin state route is absent.')
    await stateRoute.fetch(new Request('http://127.0.0.1/api/enterprise.state'))
    await eventually(async () => adapter !== undefined, Boolean)
    if (!adapter) throw new Error('Actual enterprise adapter registration is absent.')
    const negotiatedConfigReads = configReads
    const conversationId = `local-audit-${randomUUID()}`
    const first: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'local-audit-first-question' }] }]
    const second: Message[] = [
      ...first,
      { role: 'assistant', content: [{ type: 'text', text: 'local-audit-previous-answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'local-audit-second-question' }] }
    ]
    const scenarios = [
      { sessionId: conversationId, messages: first, kind: 'chat' },
      { sessionId: conversationId, messages: second, kind: 'chat' },
      { sessionId: conversationId, messages: second, purpose: 'compaction', kind: 'compaction' },
      { sessionId: conversationId, messages: first, purpose: 'session-title', kind: 'session-title' },
      { messages: first, kind: 'chat' },
      { sessionId: conversationId.toUpperCase(), messages: first, kind: 'chat' },
      { sessionId: conversationId + ' ', messages: first, kind: 'chat' }
    ]
    const outputDeltas: string[][] = []
    for (const [index, scenario] of scenarios.entries()) {
      const events: unknown[] = []
      for await (const event of adapter.stream({ model, ...scenario })) events.push(event)
      const finish = events.map(record).find((event) => event.type === 'finish')
      expect(finish).toBeDefined()
      expect(record(finish?.reason).kind).toBe('stop')
      const deltas = events.map(record).filter((event) => event.type === 'text-delta')
        .map((event) => String(event.text))
      expect(deltas.join('').length).toBeGreaterThan(0)
      outputDeltas.push(deltas)
      if (index === 4) expect(observed).toHaveLength(5)
    }
    expect(observed).toHaveLength(7)
    expect(configReads).toBe(negotiatedConfigReads)
    const admin = async (path: string, method = 'GET') => {
      const response = await fetch(base + '/api/v1/dsh/admin/model-audit' + path, {
        method, headers: { authorization: `Bearer ${adminToken}`, accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {})
      })
      return response
    }
    const ids: string[] = []
    for (let index = 0; index < observed.length; index += 1) {
      const call = observed[index]
      const scenario = scenarios[index]
      if (!call || !scenario) throw new Error('Missing expected synthetic call.')
      const text = await call.responseBody
      const completionId = text ? /"id"\s*:\s*"chatcmpl-([^"]+)"/u.exec(text)?.[1] : undefined
      const requestId = call.headerRequestId ?? completionId
      if (!requestId) throw new Error('Response exposes no usable request identifier.')
      if (completionId) expect(completionId).toBe(requestId)
      ids.push(requestId)
      expect(call.request.audit_context).toEqual({
        ...(scenario.sessionId ? { conversation_id: scenario.sessionId } : {}), request_kind: scenario.kind
      })
      expect(call.request.messages).toEqual(scenario.messages.map((message) => ({
        role: message.role, content: message.content.map((part) => part.text).join('')
      })))
      const detail = await eventually(async () => {
        const response = await admin(`/requests/${encodeURIComponent(requestId)}?tenant_id=${encodeURIComponent(tenantId)}`)
        if (response.status === 404) return undefined
        expect(response.ok).toBe(true)
        return record(data(await response.json()))
      }, (row) => row !== undefined && row.content_status === 'COMPLETE')
      if (!detail) throw new Error('Missing committed audit row.')
      expect(detail.request_id).toBe(requestId)
      expect(String(detail.user_id)).toBe(userId)
      expect(detail.conversation_id ?? undefined).toBe(scenario.sessionId)
      expect(detail.request_kind).toBe(scenario.kind)
      const bodyResponse = await admin(`/requests/${encodeURIComponent(requestId)}/body-access?tenant_id=${encodeURIComponent(tenantId)}`, 'POST')
      expect(bodyResponse.ok).toBe(true)
      expect(bodyResponse.headers.get('cache-control')).toContain('no-store')
      const body = await bodyResponse.text()
      const entries = body.trim().split('\n').map((line) => record(JSON.parse(line)))
      expect(entries[0]?.type).toBe('meta')
      expect(entries[0]?.request_id).toBe(requestId)
      expect(entries[0]?.content_state).toBe('COMPLETE')
      expect(entries.at(-1)?.type).toBe('end')
      expect(entries.at(-1)?.transfer_status).toBe('COMPLETED')
      expect(entries.at(-1)?.content_state).toBe('COMPLETE')
      const parts = entries.filter((entry) => entry.type === 'part')
      expect(parts.map((entry) => entry.seq)).toEqual(parts.map((_entry, index) => index))
      expect(entries.at(-1)?.last_seq).toBe(parts.length - 1)
      const inputFragments = entries.filter((entry) => entry.type === 'part' && entry.channel === 'input')
        .map((entry) => String(entry.fragment)).join('')
      expect(inputFragments).not.toContain('"audit_context"')
      let inputOffset = 0
      for (const message of scenario.messages) {
        for (const part of message.content) {
          const encoded = JSON.stringify(part.text).slice(1, -1)
          const found = inputFragments.indexOf(encoded, inputOffset)
          expect(found).toBeGreaterThanOrEqual(inputOffset)
          inputOffset = found + encoded.length
        }
      }
      const outputFragments = entries.filter((entry) => entry.type === 'part' && entry.channel === 'output')
        .map((entry) => String(entry.fragment)).join('')
      const deltas = outputDeltas[index]
      if (!deltas) throw new Error('Missing actual adapter output for audit comparison.')
      // Compare the small fixture's observed deltas in order; separate audit units need not be concatenated JSON strings.
      let offset = 0
      for (const delta of deltas) {
        const encoded = JSON.stringify(delta).slice(1, -1)
        const found = outputFragments.indexOf(encoded, offset)
        expect(found).toBeGreaterThanOrEqual(offset)
        offset = found + encoded.length
      }
    }
    expect(new Set(ids).size).toBe(7)
    const searchResponse = await admin('/requests?' + new URLSearchParams({
      tenant_id: tenantId, request_id: ids[1] ?? ''
    }))
    expect(searchResponse.ok).toBe(true)
    const searchPage = record(data(await searchResponse.json()))
    const searchRows = Array.isArray(searchPage.items) ? searchPage.items.map(record) : []
    expect(searchRows.map((row) => row.request_id)).toEqual([ids[1]])
    expect(JSON.stringify(searchPage)).not.toContain('local-audit-first-question')
    expect(JSON.stringify(searchPage)).not.toContain('local-audit-second-question')
    const timelineResponse = await admin('/conversations?' + new URLSearchParams({
      tenant_id: tenantId, user_id: userId, conversation_id: conversationId
    }))
    expect(timelineResponse.ok).toBe(true)
    const timeline = record(data(await timelineResponse.json()))
    const timelineRows = Array.isArray(timeline.items) ? timeline.items.map(record) : []
    expect(timelineRows.map((row) => row.request_id)).toEqual(ids.slice(0, 4))
    expect(timelineRows.map((row) => row.conversation_id)).toEqual(Array(4).fill(conversationId))
    const isolated: Array<{ conversation_id: string, request_id: string }> = []
    for (const index of [5, 6]) {
      const scenario = scenarios[index]
      const requestId = ids[index]
      if (!scenario?.sessionId || !requestId) throw new Error('Missing exact-ID probe.')
      const response = await admin('/conversations?' + new URLSearchParams({
        tenant_id: tenantId, user_id: userId, conversation_id: scenario.sessionId
      }))
      expect(response.ok).toBe(true)
      const page = record(data(await response.json()))
      const rows = Array.isArray(page.items) ? page.items.map(record) : []
      expect(rows.map((row) => row.request_id)).toEqual([requestId])
      expect(rows[0]?.conversation_id).toBe(scenario.sessionId)
      isolated.push({ conversation_id: scenario.sessionId, request_id: requestId })
    }
    expect(observed).toHaveLength(7)
    process.stdout.write('Controlled local BiSheng audit evidence: ' + JSON.stringify({
      fixture: 'actual-client-server-code-isolated-storage-synthetic-identity-model-usage',
      conversation_id: conversationId, core_request_ids: ids.slice(0, 5),
      exact_id_probes: isolated, core_model_posts: 5, exact_id_model_posts: 2, total_model_posts: observed.length,
      config_reads_during_model_calls: configReads - negotiatedConfigReads,
      associated_requests: timelineRows.length, content_status: 'COMPLETE', body_transfer: 'COMPLETED'
    }) + '\n')
  }, 60_000)
})
