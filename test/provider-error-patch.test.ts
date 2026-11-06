import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { patchPath } from './patch-path'

async function readPatch(packageName: string): Promise<string> {
  return readFile(patchPath(packageName), 'utf8')
}

describe('provider error classification patches', () => {
  it('distinguishes quota, authentication, and forbidden failures', async () => {
    const deepseekPatch = await readPatch('@deepseek-ai/dsh-llm-deepseek')
    const piAiPatch = await readPatch('@deepseek-ai/dsh-llm-pi-ai')

    expect(deepseekPatch).toContain('+\telse if (status === 401 || type === "authentication_error") code = "AUTH";')
    expect(deepseekPatch).toContain(
      '+\telse if (status === 403 || type === "permission_error") code = "FORBIDDEN";'
    )
    expect(deepseekPatch.indexOf('isQuotaExceededError(detail)')).toBeLessThan(
      deepseekPatch.lastIndexOf('status === 401')
    )
    expect(piAiPatch).toContain(
      '+\tif (/\\b401\\b/.test(message)) return "AUTH";'
    )
    expect(piAiPatch).toContain(
      '+\tif (/\\b403\\b/.test(message)) return "FORBIDDEN";'
    )
    expect(piAiPatch.indexOf('isQuotaExceededError(message)')).toBeLessThan(
      piAiPatch.lastIndexOf('\\b401\\b')
    )
  })

  it('surfaces quota and forbidden failures in both client surfaces', async () => {
    // Harness 0.2.1 already ships the quota and forbidden copy. The desktop
    // patch only has to keep the enterprise platform codes on top of that.
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

  it('localizes enterprise chat failures from the platform code and hides that badge', async () => {
    const patch = await readPatch('@deepseek-ai/dsh-client-ui-chat')
    for (const copy of [
      '模型服务调用失败，请稍后手动重试。',
      'The model request failed. Try again manually later.',
      '当前模型本月额度已用尽，请联系管理员调整额度，或等待下月重置。',
      'This model\'s monthly allowance is used up. Ask an administrator to adjust it, or wait for the monthly reset.',
      '额度服务暂不可用，请稍后重试。',
      'The allowance service is temporarily unavailable. Try again later.',
      '平台授权服务暂不可用，请稍后重试。',
      'The authorization service is temporarily unavailable. Try again later.',
      '当前模型服务尚未就绪，请确认账号已连接后再试。',
      'This model service is not ready. Confirm the account is connected, then try again.'
    ]) expect(patch).toContain(copy)
    expect(patch).toContain('case "upstream_error": return "message.failure.upstreamError";')
    expect(patch).toContain('case "monthly_token_limit_exceeded": return "message.failure.monthlyTokenLimit";')
    expect(patch).toContain('case "quota_unavailable": return "message.failure.quotaUnavailable";')
    expect(patch).toContain('case "NO_ADAPTER": return "message.failure.noAdapter";')
    expect(patch).toContain('if (platformKey) return t(platformKey);')
    expect(patch).toContain('code === "CONTEXT_WINDOW_EXCEEDED" && message === "Model context length exceeded"')
    expect(patch).toContain('if (bishengContextWindowFailure(message, code)) return t("message.failure.contextLength");')
    expect(patch).toContain('localizedFailureKey(node.message, node.code) === void 0 && !bishengContextWindowFailure(node.message, node.code) && node.code !== void 0')
    expect(patch).not.toContain('case "CONTEXT_WINDOW_EXCEEDED"')
    for (const code of [
      'internal_error',
      'user_disabled',
      'UNKNOWN_MODEL',
      'STREAM_CLOSED',
      'enterprise_models_unavailable'
    ]) expect(patch).toContain(`case "${code}":`)
    for (const copy of [
      '平台服务异常，请稍后重试或联系管理员。',
      'The platform service failed. Try again later or contact an administrator.',
      '当前账号不可用，请联系管理员。',
      'This account is unavailable. Contact your administrator.',
      '当前模型不在已授权列表中，请刷新模型列表后重选。',
      'This model is not in the authorized list. Refresh the model list and choose again.',
      '当前模型不支持工具调用，请关闭工具或更换模型。',
      'This model does not support tools. Turn tools off or switch models.'
    ]) expect(patch).toContain(copy)
  })

  it('localizes the same enterprise failures in the trajectory surface', async () => {
    const patch = await readPatch('@deepseek-ai/dsh-client-ui-trajectory')
    for (const copy of [
      '平台服务异常，请稍后重试或联系管理员。',
      'The platform service failed. Try again later or contact an administrator.',
      '当前账号不可用，请联系管理员。',
      'This account is unavailable. Contact your administrator.',
      '当前模型不在已授权列表中，请刷新模型列表后重选。',
      'This model is not in the authorized list. Refresh the model list and choose again.'
    ]) expect(patch).toContain(copy)
    expect(patch).toContain('function trajectoryFailureKey(message, code)')
    expect(patch).toContain('case "user_disabled": return "details.failure.userDisabled";')
    expect(patch).toContain('case "UNKNOWN_MODEL": return "details.failure.unknownModel";')
    expect(patch).toContain('const platformKey = trajectoryFailureKey(request.error, request.errorCode);')
  })

  it('recovers a provider terminal message that omits its content array', async () => {
    const patch = await readPatch('@deepseek-ai/dsh-llm-pi-ai')
    const additions = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n')
    const helper = additions.match(
      /function completeTerminalMessage\(message, completed\) \{[\s\S]*?^\}/m
    )?.[0]

    expect(helper).toBeDefined()
    const completeTerminalMessage = new Function(
      `${helper}; return completeTerminalMessage`
    )() as (
      message: Record<string, unknown>,
      completed: Map<number, Record<string, unknown>>
    ) => Record<string, unknown>
    const completed = new Map([
      [1, { type: 'text', text: 'second' }],
      [0, { type: 'reasoning', text: 'first' }]
    ])
    const malformed = { model: 'custom-model', stopReason: 'stop' }

    expect(completeTerminalMessage(malformed, completed)).toEqual({
      ...malformed,
      content: [
        { type: 'reasoning', text: 'first' },
        { type: 'text', text: 'second' }
      ]
    })
    const valid = { ...malformed, content: [] }
    expect(completeTerminalMessage(valid, completed)).toBe(valid)
    expect(patch).toContain(
      '+\t\t\tconst message = completeTerminalMessage(event.message, completed);'
    )
    expect(patch).toContain(
      '+\t\t\t\treplayState: toPiReplayState(message, requestedModel)'
    )
  })
})
