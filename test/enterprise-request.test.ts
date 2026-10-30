import { describe, expect, it, vi } from 'vitest'
import { requestEnterpriseJson, requestEnterpriseStream } from '../src/main/enterprise/enterprise-request'

describe('enterprise stream conversation metadata', () => {
  it.each(['stream', 'json'])('preserves transport cause and request ID for %s requests', async (kind) => {
    const cause = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    const original = new TypeError('fetch failed', { cause })
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => { throw original })
    const pending = kind === 'stream'
      ? requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/chat/completions', { body: {}, accessToken: 'test-token' })
      : requestEnterpriseJson(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/models')
    await expect(pending).rejects.toMatchObject({
      code: 'network_error', cause: original,
      requestId: expect.any(String)
    })
    await expect(pending).rejects.toHaveProperty('requestId', new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('x-request-id'))
  })

  it.each(['/api/v1/dsh/chat/completions', '/api/v1/dsh/responses'])(
    'projects legacy attribution into the body for %s without changing model input', async (path) => {
      const messages = [{ role: 'user', content: 'hello' }]
      const body = { model: 'bisheng:42', stream: true, ...(path.endsWith('/responses') ? { input: messages } : { messages }) }
      const attribution = { 'x-dsh-conversation-id': 'session-1', 'x-dsh-request-purpose': 'chat' }
      const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
      await requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', path, {
        body, attribution, accessToken: 'test-access-token'
      })
      const init = fetchImpl.mock.calls[0]?.[1]
      expect(JSON.parse(String(init?.body))).toEqual({ ...body, audit_context: { conversation_id: 'session-1' } })
      expect(new Headers(init?.headers).get('x-dsh-conversation-id')).toBe('session-1')
      expect(body).not.toHaveProperty('audit_context')
    }
  )

  it('preserves body metadata and prefers its conversation ID over the header', async () => {
    const body = { model: 'bisheng:42', audit_context: { conversation_id: 'body-session', purpose: 'compaction' } }
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
    await requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/responses', {
      body, attribution: { 'x-dsh-conversation-id': 'header-session' }, accessToken: 'test-access-token'
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(body)
  })

  it('adds a missing conversation ID without dropping other audit metadata', async () => {
    const body = { model: 'bisheng:42', audit_context: { purpose: 'session-title' } }
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
    await requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/responses', {
      body, attribution: { 'x-dsh-conversation-id': 'session-2' }, accessToken: 'test-access-token'
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      ...body, audit_context: { purpose: 'session-title', conversation_id: 'session-2' }
    })
  })

  it('does not fabricate a conversation ID for requests without a session', async () => {
    const body = { model: 'bisheng:42', stream: true }
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
    await requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/responses', {
      body, attribution: { 'user-agent': 'test-harness' }, accessToken: 'test-access-token'
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(body)
  })

  it('keeps a stable ID across repeated calls and isolates different conversations', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
    for (const conversationId of ['session-1', 'session-1', 'session-2']) {
      await requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/responses', {
        body: { model: 'bisheng:42' }, attribution: { 'x-dsh-conversation-id': conversationId }, accessToken: 'test-access-token'
      })
    }
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).audit_context.conversation_id))
      .toEqual(['session-1', 'session-1', 'session-2'])
  })

  it.each([null, [], 'invalid'])('rejects malformed audit context %j before sending', async (auditContext) => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response())
    await expect(requestEnterpriseStream(fetchImpl, 'https://bisheng.example.com', '/api/v1/dsh/responses', {
      body: { model: 'bisheng:42', audit_context: auditContext },
      attribution: { 'x-dsh-conversation-id': 'session-1' }, accessToken: 'test-access-token'
    })).rejects.toThrow('audit context must be a JSON object')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
