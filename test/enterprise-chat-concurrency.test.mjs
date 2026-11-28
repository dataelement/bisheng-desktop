import { expect, it, vi } from 'vitest'
import { EnterpriseService } from '../packages/dsh-desktop-enterprise/desktop/enterprise-service'

function fixture() {
  const service = new EnterpriseService({ vault: { available: true } })
  service.session = { base: 'https://enterprise.example.test', access_token: 'synthetic-token' }
  service.modelsAvailable = true
  service.models = [{ id: 'bisheng:1', capabilities: { responses: true } }]
  const chat = signal => service.proxyChat({ request: {
    model: 'bisheng:1', messages: [], stream: true, stream_options: { include_usage: true }
  } }, {}, signal)
  const responses = signal => service.proxyResponses({
    connectionKey: service.connectionKey(),
    request: {
      model: 'bisheng:1', input: [{ type: 'message', role: 'user', content: [] }],
      stream: true, store: false, include: ['reasoning.encrypted_content']
    }
  }, {}, signal)
  return { service, chat, responses }
}

it('admits more than eight simultaneous Chat and Responses requests and releases controllers', async () => {
  const { service, chat, responses } = fixture()
  let release
  const pending = new Promise(resolve => { release = resolve })
  // Hold the transport open so every request is genuinely in flight together.
  service.runChat = vi.fn(() => pending)
  const requests = Array.from({ length: 16 }, (_, index) =>
    (index % 2 ? responses : chat)(new AbortController().signal))
  const settled = Promise.allSettled(requests)
  try {
    expect(service.runChat).toHaveBeenCalledTimes(16)
    expect(service.chatControllers.size).toBe(16)
  } finally {
    release()
    const results = await settled
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
    expect(service.chatControllers.size).toBe(0)
  }
})

it('still cleans up controllers when a model transport fails', async () => {
  const { service, chat } = fixture()
  service.runChat = vi.fn(async () => { throw new Error('synthetic transport failure') })
  await expect(chat(new AbortController().signal)).rejects.toThrow('synthetic transport failure')
  expect(service.chatControllers.size).toBe(0)
})
