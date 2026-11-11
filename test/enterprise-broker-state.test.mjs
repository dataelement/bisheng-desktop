import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-desktop-enterprise/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  const readBrokerState = async () => {')
const block = source.slice(start, source.indexOf('  const marketRequest =', start))

it('does not clear work resources repeatedly while disconnected', async () => {
  const clear = vi.fn()
  const reset = vi.fn()
  let state = { connected: false }
  const create = vm.runInNewContext('(function(deps) { let account = { connected: false }; const { broker, brokerJson, market, workbenches, capabilityPolicy, workResources, workSkills, workCapabilities, ingestEnterpriseState, thirdPartyFlags, disabledState } = deps; ' + block + '; return readBrokerState })')
  const read = create({
    broker: {}, brokerJson: async () => state,
    market: { stop: vi.fn() }, workbenches: { stop: vi.fn() },
    capabilityPolicy: { reset, refresh: async () => {} },
    workResources: { clear }, workSkills: { clear }, workCapabilities: { clear },
    ingestEnterpriseState: () => {}, thirdPartyFlags: () => ({}), disabledState: () => ({ connected: false })
  })
  await read()
  await read()
  expect(clear).not.toHaveBeenCalled()
  state = { connected: true, connectionKey: 'a' }
  await read()
  expect(clear).toHaveBeenCalledTimes(3)
  state = { connected: false }
  await read()
  expect(clear).toHaveBeenCalledTimes(6)
  await read()
  expect(clear).toHaveBeenCalledTimes(6)
})
