import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { bindStartupPluginPolicy } from '../src/main/startup-plugin-policy'

it('binds a fake policy without changing its decisions or failures', async () => {
  const note = vi.fn()
  const enforce = vi.fn(async (_home: string, log: (line: string) => void) => { log('enforced') })
  const read = vi.fn(async (_home: string) => ({ allowThirdPartyPlugins: false }))
  const bound = bindStartupPluginPolicy({ enforce, read }, '/test/home', note)
  await bound.enforceCommunityPluginPolicy()
  expect(enforce).toHaveBeenCalledWith('/test/home', note)
  expect(note).toHaveBeenCalledWith('enforced')
  expect(await bound.thirdPartyPluginsAllowed()).toBe(false)
  read.mockResolvedValueOnce({ allowThirdPartyPlugins: true })
  expect(await bound.thirdPartyPluginsAllowed()).toBe(true)
  expect(read).toHaveBeenCalledWith('/test/home')
  const failure = new Error('policy failed')
  enforce.mockRejectedValueOnce(failure)
  await expect(bound.enforceCommunityPluginPolicy()).rejects.toBe(failure)
  read.mockRejectedValueOnce(failure)
  await expect(bound.thirdPartyPluginsAllowed()).rejects.toBe(failure)
})

it('wires the bound product policy into normal startup maintenance', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  expect(source).toContain('...bindStartupPluginPolicy(desktopProduct.startupPluginPolicy, dshHome, (line) => runtime.note(line))')
  expect(source).not.toContain('readPersistedThirdPartyPolicy')
})
