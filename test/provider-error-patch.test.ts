import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('provider error classification copy', () => {

  it('surfaces quota and forbidden failures in both client surfaces', async () => {
    // Verify the quota and forbidden copy in the installed Harness clients.
    for (const [packageName, prefix] of [
      ['@deepseek-ai/dsh-client-ui-chat', 'message'],
      ['@deepseek-ai/dsh-client-ui-trajectory', 'details']
    ] as const) {
      const client = await readFile(
        new URL(`../node_modules/${packageName}/lib/client.js`, import.meta.url),
        'utf8'
      )

      expect(client).toContain(`"${prefix}.failure.quota"`)
      expect(client).toContain(`"${prefix}.failure.forbidden"`)
      expect(client).toContain('账户额度或余额不足')
      expect(client).toContain('模型服务商拒绝了本次请求')
      expect(client).toContain(
        "Your account has insufficient quota or balance. Add credits or check your provider's usage limits."
      )
      expect(client).toContain(
        'The model provider denied this request. Check your account permissions, region, or model access.'
      )
    }
  })
})
