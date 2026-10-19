import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { applyEnterpriseMarket } from '../packages/dsh-desktop-enterprise/market.js'

const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'market-online-state-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const routes = new Map()
  const account = {
    connected: true, base: 'https://enterprise.example', tenant: { id: '2' }, user: { id: '20' },
    sessionExpiresAt: new Date(Date.now() + 300000).toISOString()
  }
  let available = true
  const market = applyEnterpriseMarket({
    connection: { fetch: { register: route => routes.set(route.path, route.fetch) } },
    effect: callback => cleanups.push(callback())
  }, {
    state: () => account,
    refreshState: async () => { if (!available) throw new Error('Enterprise broker unavailable') },
    marketRequest: async (path, body) => ({ status_code: 200, data: path.endsWith('/capabilities')
      ? { enabled: true, contract_version: 2, tenant_id: '2' }
      : { tenant_id: '2', user_id: '20', device_id: body.device_id, synced_at: Math.floor(Date.now() / 1000), policies: [] } })
  })
  const state = () => routes.get('/api/enterprise.market.state')(new Request('http://localhost/api/enterprise.market.state'))
  expect((await state()).status).toBe(200)
  expect(market.state().online).toBe(true)
  return { market, state, disconnectBroker: () => { available = false } }
}

it('clears market access when the state route cannot refresh enterprise identity', async () => {
  const { market, state, disconnectBroker } = await fixture()
  disconnectBroker()
  const response = await state()
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Enterprise broker unavailable' })
  expect(market.state()).toMatchObject({ online: false, installed: [] })
})

it('clears market access when background identity refresh fails', async () => {
  vi.useFakeTimers()
  const { market, disconnectBroker } = await fixture()
  disconnectBroker()
  await vi.advanceTimersByTimeAsync(60000)
  expect(market.state().online).toBe(false)
})
