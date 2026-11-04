import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('preload product composition', () => {
  it('statically includes the enterprise bridge only in the product entry', async () => {
    const options = { bundle: true, platform: 'node' as const, format: 'cjs' as const, external: ['electron'], write: false as const, metafile: true as const }
    const product = await build({ ...options, entryPoints: ['src/preload/product-entry.ts'] })
    const publicBuild = await build({ ...options, stdin: { contents: "import { initializeDesktopPreload } from './src/preload/index'; initializeDesktopPreload(() => () => {})", resolveDir: process.cwd(), loader: 'ts' } })
    expect(Object.keys(product.metafile.inputs)).toContain('src/preload/enterprise-bridge.ts')
    expect(Object.keys(publicBuild.metafile.inputs)).not.toContain('src/preload/enterprise-bridge.ts')
    expect(product.outputFiles[0]?.text).toContain('enterprise:login-link')
    expect(publicBuild.outputFiles[0]?.text).not.toContain('enterprise:login-link')
    for (const result of [product, publicBuild]) {
      const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path))
      expect([...new Set(imports)]).toEqual(['electron'])
    }
  })

  it('keeps product initialization and exposure at their original assembly positions', () => {
    const source = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
    expect(source.indexOf('setupDesktopNotificationBridge()')).toBeLessThan(source.indexOf('initializeProductBridge()'))
    expect(source.indexOf('initializeProductBridge()')).toBeLessThan(source.indexOf("'__DSH_DIRECTORY_PICKER__'"))
    expect(source.indexOf('exposeProductBridges()')).toBeLessThan(source.indexOf("'dshDesktop',"))
    expect(source.indexOf('exposeProductBridges()')).toBeGreaterThan(source.indexOf("window.addEventListener('pagehide'"))
  })
})
