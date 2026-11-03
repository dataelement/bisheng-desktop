import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('Desktop host plugin control in Plugins settings', () => {
  async function boot(marketComposed, account) {
    const registrations = []
    let client
    const source = readFileSync(new URL('../packages/dsh-desktop-market-installer/client.js', import.meta.url), 'utf8')
    runInNewContext(source, {
      window: {
        __ModuleLoader__: { load(entry) { client = entry.factory(createRequire(import.meta.url)) } },
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {},
        addEventListener() {},
        removeEventListener() {}
      },
      fetch: async () => ({ ok: true, json: async () => account }),
      __DSH_BOOT__: { entries: marketComposed ? [{ id: 'dshmarket' }] : [] },
      document: {
        visibilityState: 'visible',
        querySelector: () => ({}),
        addEventListener() {},
        removeEventListener() {}
      }
    })
    client.apply({
      effect(callback) { callback() },
      locale: { register() {}, bind: () => key => key },
      slots: {
        inject(_name, callback) { callback() },
        register(options) { registrations.push(options) }
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return registrations
  }

  it.each([false, true])('keeps the market entry hidden until the tenant allows it, composed: %s', async marketComposed => {
    const registrations = await boot(marketComposed, { connected: false })
    expect(registrations).toContainEqual(expect.objectContaining({ name: 'settings.plugins.tab', id: 'desktop-host-plugins' }))
    expect(registrations.some(entry => entry.id === 'desktop-market-management' || entry.id === 'desktop-market-installer')).toBe(false)
  })

  it('shows the composed market only after the tenant allows third-party plugins', async () => {
    const registrations = await boot(true, {
      connected: true,
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      allowThirdPartyPlugins: true
    })
    expect(registrations).toContainEqual(expect.objectContaining({ id: 'desktop-market-management' }))
  })
})
