import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'

const PI_AI_ONBOARDING_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'xai',
  'moonshotai-cn',
  'minimax-cn',
  'zai-coding-cn',
  'mistral',
  'groq',
  'together'
] as const

describe('bundled provider model catalogs', () => {
  it.each(PI_AI_ONBOARDING_PROVIDERS)('%s has a bundled model catalog', (provider) => {
    expect(getBuiltinModels(provider).length).toBeGreaterThan(0)
  })
})
