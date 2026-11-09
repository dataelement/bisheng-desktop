import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { Config, apply } from '@deepseek-ai/dsh-client-ui-settings-models'

const require = createRequire(import.meta.url)
const webPatch = require.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml')
const profilePatch = fileURLToPath(new URL('../build/web-runtime/cordis.patch.yml', import.meta.url))

function findEntry(entries, id) {
  for (const entry of entries) {
    if (entry.id === id) return entry
    if (entry.group && Array.isArray(entry.config)) {
      const found = findEntry(entry.config, id)
      if (found) return found
    }
  }
}

function publish(config) {
  let handler
  apply({ on(name, fn) { expect(name).toBe('webserver/index-inject'); handler = fn } }, Config(config))
  const table = []
  handler(table)
  return table.find(entry => entry.name === '__DSH_MODELS_ONBOARDING__')
}

describe('web runtime model onboarding profile', () => {
  it('composes the actual upstream web plugin and publishes only the onboarding option', () => {
    const upstream = loadOverlayPatches('test', webPatch)
    const profile = loadOverlayPatches('test', profilePatch)
    const warnings = []
    const entries = composeEntries([upstream, profile], warning => warnings.push(warning))
    const models = findEntry(entries, 'ui-settings-models')
    expect(models?.name).toBe('@deepseek-ai/dsh-client-ui-settings-models')
    expect(models?.disabled).not.toBe(true)
    expect(models?.config).toEqual({ credentialOnboarding: false })
    expect(findEntry(entries, 'ui-brand-official')?.disabled).toBe(true)
    expect(warnings.filter(warning => warning.includes('ui-settings-models'))).toEqual([])
    expect(publish(models.config)).toEqual({ kind: 'global', name: '__DSH_MODELS_ONBOARDING__', value: { credentialOnboarding: false } })
    expect(publish({}).value).toEqual({ credentialOnboarding: true })
  })
})
