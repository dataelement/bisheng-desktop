import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

const require = createRequire(import.meta.url)
const { parsePatchFile } = require('patch-package/dist/patch/parse') as {
  parsePatchFile: (file: string) => unknown
}

describe('patch hunk counts', () => {
  it('keeps every maintained source patch structurally parseable', async () => {
    const patchesDir = path.join(projectRoot, 'patches')
    const names = (await readdir(patchesDir)).filter((name) => name.endsWith('.patch'))
    expect(names.length).toBeGreaterThan(0)

    const errors: string[] = []
    for (const name of names) {
      const content = await readFile(path.join(patchesDir, name), 'utf8')
      try {
        parsePatchFile(content)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${name}: ${message}`)
      }
    }

    expect(errors).toEqual([])
  })
})
