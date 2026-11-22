import { expect, it, vi } from 'vitest'
import { EnterpriseClient } from '../packages/dsh-desktop-enterprise/enterprise-client.js'
import { startEnterpriseCredentialBroker } from '../packages/dsh-desktop-enterprise/desktop/credential-broker'
import { withWorkMcp } from '../packages/dsh-desktop-enterprise/work-mcp.js'

it('queries enterprise tools through the actual authenticated Desktop MCP broker route', async () => {
  const workMcp = vi.fn(async ({ message }) => {
    if (message.method.startsWith('notifications/')) return null
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { tools: [{ name: 'bisheng_tool_1', description: 'Synthetic tool', inputSchema: { type: 'object' } }] }
    return { jsonrpc: '2.0', id: message.id, result }
  })
  const broker = await startEnterpriseCredentialBroker({ workMcp })
  try {
    const client = new EnterpriseClient({ getBroker: () => ({ origin: broker.url, capability: broker.capability }) })
    const result = await withWorkMcp((body, signal) => client.handleWorkCapabilities(body, signal),
      'synthetic-account', undefined, mcp => mcp.listTools())
    expect(result.tools.map(tool => tool.name)).toEqual(['bisheng_tool_1'])
    expect(workMcp.mock.calls.map(([body]) => body.message.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list'
    ])
    expect(workMcp.mock.calls.every(([body]) => body.connectionKey === 'synthetic-account')).toBe(true)
  } finally {
    await broker.stop()
  }
})
