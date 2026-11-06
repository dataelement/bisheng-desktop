import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-desktop-market-installer/client.js', import.meta.url), 'utf8')
const start = source.indexOf('      let disposeMarket')
const end = source.indexOf("      }, 'dsh-desktop-market-installer: plugin market entry')", start)

it('updates the market entry on account events and expiry, not on an interval', async () => {
  vi.useFakeTimers()
  try {
    const window = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    let account = { connected: false }
    let registration, unregister = vi.fn()
    const fetch = vi.fn(async () => ({ json: async () => account }))
    const ctx = { slots: { inject: (_name, callback) => callback(), register: config => { registration = config.id; return () => { registration = undefined; unregister() } } } }
    const bind = vm.runInNewContext('(function() {' + source.slice(start, end) + '})', {
      window, document, fetch, ctx, Date, marketAlreadyComposed: () => false,
      t: key => key, MarketManagementTab: () => {}, MarketInstallerSection: () => {}
    })
    const dispose = bind()
    await vi.advanceTimersByTimeAsync(0)
    expect(registration).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    account = { connected: true, allowThirdPartyPlugins: true, sessionExpiresAt: new Date(Date.now() + 1000).toISOString() }
    window.dispatchEvent(new Event('dsh-desktop:enterprise-account-changed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(registration).toBe('desktop-market-installer')
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(unregister).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1001)
    expect(registration).toBeUndefined()
    dispose()
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event('focus'))
    expect(fetch).toHaveBeenCalledTimes(4)
  } finally { vi.useRealTimers() }
})
