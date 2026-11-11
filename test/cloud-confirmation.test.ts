import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const show = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ dialog: { showMessageBox: show } }))
import { confirmCloudEffect, assertCloudRendererRequest } from '../src/main/enterprise/cloud-confirmation'
const parent = { isDestroyed: () => false } as BrowserWindow
it('requires native confirmation and a separately checked schema acknowledgement', async () => {
  const effect = { operation: 'publish' as const, serverUrl: 'https://enterprise.test', schemaChange: true }
  show.mockResolvedValueOnce({ response: 0, checkboxChecked: true })
  expect(await confirmCloudEffect(effect, parent, true)).toBe(false)
  show.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  expect(await confirmCloudEffect(effect, parent, false)).toBe(false)
  show.mockResolvedValueOnce({ response: 1, checkboxChecked: true })
  expect(await confirmCloudEffect(effect, parent, true)).toBe(true)
  expect(show.mock.calls[0]?.[1]).toMatchObject({ defaultId: 0, cancelId: 0, checkboxChecked: false })
})
it('fails closed without a visible host and supports normal source confirmation', async () => {
  await expect(confirmCloudEffect({ operation: 'checkout', serverUrl: 'https://enterprise.test' }, undefined, true)).rejects.toThrow('Open Desktop')
  show.mockResolvedValueOnce({ response: 1 })
  expect(await confirmCloudEffect({ operation: 'checkout', serverUrl: 'https://enterprise.test' }, parent, false)).toBe(true)
})
it('limits renderer cloud requests to discovery and progress', () => {
  for (const operation of ['guide', 'list', 'limits', 'progress']) expect(() => assertCloudRendererRequest({ operation })).not.toThrow()
  for (const operation of ['launch', 'publish', 'checkout', 'create', 'project', undefined]) expect(() => assertCloudRendererRequest({ operation })).toThrow()
})
