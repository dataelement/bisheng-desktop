import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

it('accepts only a trusted host frame and a boolean occlusion signal', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const start = source.indexOf("  ipcMain.handle('enterprise-cloud:host-occluded'")
  const end = source.indexOf("  ipcMain.handle('enterprise-cloud:bounds'", start)
  const handlers = new Map<string, (event: unknown, value: unknown) => void>()
  const setHostOccluded = vi.fn()
  const assertTrustedMainWindowEvent = vi.fn((event: { trusted?: boolean }) => { if (!event.trusted) throw new Error('Untrusted frame') })
  vm.runInNewContext(ts.transpile(source.slice(start, end)), {
    ipcMain: { handle: (name: string, handler: (event: unknown, value: unknown) => void) => handlers.set(name, handler) },
    assertTrustedMainWindowEvent,
    sameHarnessOrigin: (left: string, right: string) => left === right,
    runtime: { snapshot: () => ({ url: 'http://host.test' }) },
    cloudWorkbenchView: { setHostOccluded }
  })
  const handler = handlers.get('enterprise-cloud:host-occluded')
  if (!handler) throw new Error('Missing occlusion handler')
  const event = { trusted: true, sender: { getURL: () => 'http://host.test' } }
  handler(event, true); handler(event, false)
  expect(setHostOccluded.mock.calls).toEqual([[true], [false]])
  setHostOccluded.mockClear()
  expect(() => handler({ ...event, trusted: false }, true)).toThrow('Untrusted frame')
  expect(() => handler({ ...event, sender: { getURL: () => 'https://cloud.test' } }, true)).toThrow('Trusted workbench host')
  for (const value of [undefined, null, 1, 'true', {}]) expect(() => handler(event, value)).toThrow('Invalid cloud host visibility')
  expect(setHostOccluded).not.toHaveBeenCalled()
})
