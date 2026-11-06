import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('wires about-info through the trusted registry and releases it on exit', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  expect(source).toContain('createTrustedIpcRegistry(ipcMain, assertTrustedMainWindowEvent)')
  expect(source).toContain("trustedIpc.register('desktop:about-info'")
  expect(source).toContain("app.once('will-quit', disposeAboutInfo)")
  expect(source).not.toContain("ipcMain.handle('desktop:about-info'")
})
