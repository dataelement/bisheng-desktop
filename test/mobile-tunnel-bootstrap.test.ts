import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Bridge behavior tests inject tunnel factories. Also guard the real Electron
// assembly so restoring URL mode cannot silently lose its cache and diagnostics.
describe('mobile URL tunnel bootstrap', () => {
  it('retains the original persistent cache, fallback override and logging options', () => {
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const assembly = source.slice(source.indexOf('mobileBridge = new LanMobileBridge({'))
      .split('\n  })', 1)[0]
    expect(assembly).toContain("cloudflaredCacheDir: join(app.getPath('userData'), 'bin')")
    expect(assembly).toContain("forceCloudflareFailure: process.env.DSH_TUNNEL_FORCE_PINGGY === '1'")
    expect(assembly).toContain('tunnelLog: (message) => console.warn(message)')
  })
})
