import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { expect, it } from 'vitest'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { startEnterpriseCredentialBroker } from '../src/main/enterprise/credential-broker.ts'
import { EnterpriseService } from '../src/main/enterprise/enterprise-service.ts'
import { createEnterpriseFetch } from '../src/main/enterprise/platform-fetch.ts'
import { SecureEnterpriseCredentialVault } from '../src/main/enterprise/secure-credential-vault.ts'
import { createMockEnterpriseServer } from '../scripts/mock-bisheng-enterprise.mjs'

const backend = process.env.BISHENG_BACKEND_ROOT

it.skipIf(!backend)('crosses real Desktop HTTP broker, Bisheng schema/governance and SDK for both protocols', async () => {
  const child = spawn(join(backend, '.venv/bin/python'), ['-m', 'test.dsh.protocol_http_fixture'], {
    cwd: backend, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['ALL_PROXY', 'all_proxy', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(key)))
  })
  let errors = ''
  child.stderr.on('data', (data) => { errors += data })
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-protocol-'))
  const platform = createMockEnterpriseServer({ port: 0 })
  let service
  let broker
  try {
    const lines = createInterface({ input: child.stdout })
    const line = await Promise.race([once(lines, 'line').then(([line]) => line), once(child, 'exit').then(() => { throw new Error(errors) })])
    const origin = `http://127.0.0.1:${JSON.parse(line).port}`
    const mockOrigin = await platform.listen()
    const vault = new SecureEnterpriseCredentialVault(join(directory, 'vault.json'), {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
      encryptString: (text) => Buffer.from(text), decryptString: (data) => Buffer.from(data).toString()
    })
    const actualFetch = async (input, init) => {
      const url = new URL(input)
      if (['/api/v1/dsh/models', '/api/v1/dsh/chat/completions', '/api/v1/dsh/responses'].includes(url.pathname)) return fetch(`${origin}${url.pathname}`, init)
      return fetch(input, init)
    }
    service = new EnterpriseService({ vault, fetchImpl: createEnterpriseFetch(actualFetch), allowInsecureLoopback: true })
    await service.restore()
    broker = await startEnterpriseCredentialBroker(service, { allowInsecureLoopback: true })
    const login = await service.startLogin(mockOrigin)
    const authId = new URL(login.authorizationUrl).searchParams.get('auth_id')
    const html = await fetch(`${mockOrigin}/__mock/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ auth_id: authId, email: 'alice@demo.bisheng.local', password: 'WorkBuddy123!', decision: 'allow' }) }).then((reply) => reply.text())
    const callback = JSON.parse(/location\.replace\((".*?")\)/u.exec(html)[1])
    await fetch(callback, { headers: { connection: 'close' } })
    for (let attempt = 0; attempt < 400 && (service.snapshot().phase !== 'connected' || !service.snapshot().modelsAvailable); attempt++) await new Promise((resolve) => setTimeout(resolve, 25))
    const state = service.snapshot()
    expect(state).toMatchObject({ phase: 'connected', modelsAvailable: true })
    expect(state.models[0].capabilities.responses).toBe(true)
    const send = (path, body, signal, attribution, connectionKey) => fetch(`${broker.url}${path}`, { method: 'POST', signal, headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' }, body: JSON.stringify({ request: body, attribution, ...(connectionKey ? { connectionKey } : {}) }) })
    let native = false
    const adapter = new EnterpriseLlmAdapter({
      models: () => state.models.map((model) => ({ ...model, capabilities: { ...model.capabilities, responses: native } })),
      connectionKey: () => state.connectionKey,
      request: (body, signal, headers) => send('/v1/chat', body, signal, headers),
      requestResponses: (body, signal, headers, connectionKey) => send('/v1/responses', body, signal, headers, connectionKey)
    })
    for (const effort of [undefined, 'high']) {
      for (const protocol of [false, true]) {
        native = protocol
        const chunks = []
        for await (const chunk of adapter.stream({ provider: 'enterprise', model: state.models[0].id, sessionId: 'conv-1', ...(effort ? { reasoningEffort: effort } : {}), messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })) chunks.push(chunk)
        expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      }
    }
    const evidence = await fetch(`${origin}/__evidence`).then((reply) => reply.json())
    expect(evidence.requests.map((request) => request.path)).toEqual(['/v1/chat/completions', '/v1/responses', '/v1/chat/completions', '/v1/responses'])
    expect(evidence.requests.map((request) => request.body.reasoning_effort ?? request.body.reasoning.effort)).toEqual(['low', 'low', 'high', 'high'])
    expect(new Set(evidence.requests.map((request) => request.session_id)).size).toBe(1)
    expect(evidence.requests[0].session_id).toMatch(/^[a-f0-9]{64}$/)
    expect(evidence.events.filter((event) => event.status === 'SUCCEEDED')).toHaveLength(4)
  } finally {
    await broker?.stop()
    await service?.stop()
    await platform.close()
    const exit = once(child, 'exit')
    child.kill('SIGTERM')
    if (child.exitCode === null) await exit
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
