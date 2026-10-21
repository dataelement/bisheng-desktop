// Isolated fixture only: exercise the production adapter and Electron validator.
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { parseConfig } from '../packages/dsh-desktop-enterprise/contract.js'

export async function verifyAuditSources(base, token) {
  const url = new URL(base)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Owned loopback fixture required')
  const health = await (await fetch(new URL('/health', url))).json()
  if (health.fixture !== true) throw new Error('Owned audit fixture required')
  const config = parseConfig(await (await fetch(new URL('/api/v1/dsh/config', url))).json())
  const fields = config.audit_context?.fields ?? []
  if (!fields.includes('message_sources')) throw new Error('Fixture must advertise source support')
  const { parseEnterpriseChatPayload } = await import('../src/main/enterprise/enterprise-chat.ts')
  const parent = 'e2e-audit-parent-' + randomUUID(), child = 'e2e-audit-child-' + randomUUID()
  const calls = []
  const adapter = new EnterpriseLlmAdapter({
    models: () => [{ id: 'bisheng:42', capabilities: { streaming: true, tools: true, vision: false } }],
    auditFields: () => fields,
    resolveAuditSession: id => id === child ? { session_origin: 'subagent', parent_conversation_id: parent } : { session_origin: 'main' },
    request: async request => {
      const parsed = parseEnterpriseChatPayload({ request }, fields)
      const response = await fetch(new URL('/api/v1/dsh/chat/completions', url), {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(parsed.request)
      })
      if (!response.ok) throw new Error('Synthetic model call failed')
      calls.push({ request_id: response.headers.get('x-request-id'), context: request.audit_context })
      return response
    }
  })
  for (const sessionId of [parent, child]) for (const purpose of [undefined, 'compaction']) {
    for await (const event of adapter.stream({ model: 'bisheng:42', sessionId, purpose, system: 'Synthetic system', messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic question' }] },
      { role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: ['not copied'] }, content: [{ type: 'text', text: 'Synthetic context' }] }
    ] })) void event
  }
  return { parent, child, calls }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyAuditSources(process.env.DSH_AUDIT_BASE, process.env.DSH_AUDIT_USER_TOKEN)
    process.stdout.write(JSON.stringify(result))
  } catch {
    process.stderr.write('Isolated audit source probe failed.\n')
    process.exitCode = 1
  }
}
