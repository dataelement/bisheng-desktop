import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as deepseek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { buildModelCatalog } from '../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/catalog.js'
import { EnterpriseLlmAdapter } from '../packages/dsh-desktop-enterprise/openai.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const contexts = []
const official = 'deepseek-official'
const enterprise = 'bisheng-enterprise'
const officialModels = [
  { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }
]

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function fixture({ key, env = {}, credentialService = true, config = {} } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: env }]))
  const resolve = vi.fn(async () => key === undefined ? undefined : { value: key, source: 'store' })
  if (credentialService) ctx.provide('credentials', { resolve })
  const settings = { models: officialModels, ...config }
  await ctx.plugin(LlmRuntime)
  const provider = await ctx.plugin(deepseek, settings)
  ctx.llm.registerAdapter([enterprise], new EnterpriseLlmAdapter({
    providerName: () => 'Default Tenant',
    models: () => [
      { id: 'bisheng:1', display_name: '阿里云百炼 / deepseek-v4-pro', capabilities: { vision: false } },
      { id: 'bisheng:2', display_name: 'volces / deepseek-v4-1-flash-260910', capabilities: { vision: false } }
    ]
  }))
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: enterprise, model: 'bisheng:1' })
  })
  return {
    ctx, resolve,
    catalog: () => buildModelCatalog(ctx),
    setKey(value) { key = value },
    setSettings(value) { provider.update({ ...settings, ...value }) }
  }
}

describe('DeepSeek catalog credential availability', () => {
  it('publishes the enterprise models when the official credential is absent', async () => {
    const app = await fixture()
    const catalog = await app.catalog()
    expect(catalog.groups.map(group => group.id)).toEqual([enterprise])
    expect(catalog.groups[0].models.map(model => model.name)).toEqual([
      '阿里云百炼 / deepseek-v4-pro', 'volces / deepseek-v4-1-flash-260910'
    ])
    expect(catalog.failures).toEqual([])
    expect(app.ctx.llm.listConfigurableProviders().map(provider => provider.provider)).toContain(official)
  })

  it('updates the same live adapter after storing and removing the key', async () => {
    const app = await fixture()
    expect(await app.ctx.llm.listModels(official)).toEqual([])
    app.setKey('test-key')
    expect((await app.ctx.llm.listModels(official)).map(model => model.id)).toEqual(officialModels.map(model => model.id))
    app.setKey(undefined)
    expect(await app.ctx.llm.listModels(official)).toEqual([])
    expect((await app.catalog()).groups.map(group => group.id)).toEqual([enterprise])
  })

  it.each(['', ' \n\t ', 'test-密钥'])('publishes an empty catalog for an unusable credential %j', async key => {
    const app = await fixture({ key })
    expect(await app.ctx.llm.listModels(official)).toEqual([])
    expect((await app.catalog()).failures).toEqual([])
  })

  it('resolves the configured credential reference and follows settings updates', async () => {
    const app = await fixture({ key: 'test-key', config: { apiKeyEnv: 'TEAM_DEEPSEEK_KEY' } })
    await app.catalog()
    expect(app.resolve).toHaveBeenLastCalledWith('TEAM_DEEPSEEK_KEY')
    app.setSettings({ apiKeyEnv: 'OTHER_DEEPSEEK_KEY', models: [{ id: 'custom', name: 'Custom model' }] })
    await vi.waitFor(async () => {
      expect((await app.ctx.llm.listModels(official)).map(model => model.id)).toEqual(['custom'])
    })
    expect(app.resolve).toHaveBeenLastCalledWith('OTHER_DEEPSEEK_KEY')
  })

  it.each([{}, { DEEPSEEK_API_KEY: 'test-environment-key' }])('uses the launch environment when it owns credential resolution: %j', async env => {
    const app = await fixture({ env, credentialService: false })
    expect((await app.ctx.llm.listModels(official)).length).toBe(env.DEEPSEEK_API_KEY ? 2 : 0)
  })

  it('uses the credential service result when that service owns resolution', async () => {
    const app = await fixture({ env: { DEEPSEEK_API_KEY: 'test-environment-key' } })
    expect(await app.ctx.llm.listModels(official)).toEqual([])
  })

  it('reports credential-store failures while preserving the enterprise catalog', async () => {
    const app = await fixture()
    app.resolve.mockRejectedValue(new Error('Credential store unavailable'))
    const catalog = await app.catalog()
    expect(catalog.groups.map(group => group.id)).toEqual([enterprise])
    expect(catalog.failures).toEqual([{ id: official, name: 'DeepSeek', message: 'Credential store unavailable' }])
  })
})
