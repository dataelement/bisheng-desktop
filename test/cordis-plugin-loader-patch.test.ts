import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('Harness runtime resolution contract', () => {
  it('passes ctx.baseUrl into the new Harness runtime resolver', async () => {
    const loader = await readFile(path.join(projectRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js'), 'utf8')
    const boot = await readFile(path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), 'utf8')
    expect(loader).toContain('this.ctx.loader.internal.import(name, this.ctx.baseUrl, {})')
    expect(boot).toContain('async function createRuntimeResolution(options)')
  })
})
