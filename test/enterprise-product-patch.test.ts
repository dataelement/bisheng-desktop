import { describe, expect, it } from 'vitest'
import { buildDesktopProductPatch, writeDesktopProductPatch } from '../src/main/shell/product-patch'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('enterprise product patch injection', () => {
  it('includes dsh-desktop-enterprise in desktop product patch', () => {
    const patch = buildDesktopProductPatch({ dshDesktopHostPlugins: ['dsh-desktop-enterprise'] })
    expect(patch).toContain('dsh-desktop-enterprise')
    expect(patch).toContain('dsh-desktop-client-ui')
    expect(patch).toContain('dsh-desktop-workbenches')
  })

  it('writes desktop-product.patch.yml with enterprise plugin row', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bisheng-patch-test-'))
    try {
      const filePath = await writeDesktopProductPatch(dir, 'desktop', { dshDesktopHostPlugins: ['dsh-desktop-enterprise'] })
      const content = await readFile(filePath, 'utf-8')
      expect(content).toContain('- id: dsh-desktop-enterprise')
      expect(content).toContain('name: dsh-desktop-enterprise')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

