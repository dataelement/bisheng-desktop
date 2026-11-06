import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

// Opt in to the already built target checker and generated Web package. This suite
// only reads those artifacts; it does not prepare packages, install, or grant exemptions.
const harnessRoot = process.env.DSH_PPT_HARNESS_ROOT
const projectRoot = fileURLToPath(new URL('../', import.meta.url))

async function manifest(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

describe.skipIf(!harnessRoot)('generated Web PPT compatibility against the target Harness checker', () => {
  let evaluate
  let generated
  let core
  let adapter

  beforeAll(async () => {
    const target = path.resolve(harnessRoot)
    const checker = await import(pathToFileURL(path.join(target, 'packages/boot/app-boot/lib/types/plugin-compatibility.js')).href)
    evaluate = checker.evaluatePluginCompatibility
    generated = await manifest(path.join(projectRoot, '.build/ppt-web/dsh-ppt-composer/package.json'))
    core = await manifest(path.join(projectRoot, 'packages/ppt-runtime/core/package.json'))
    adapter = await manifest(path.join(projectRoot, 'packages/ppt-runtime/adapter/package.json'))
  })

  it('accepts runtime 0.2.2-alpha.3 through the existing peer ranges without an exemption or engines override', () => {
    expect(generated.engines).not.toHaveProperty('dsh')
    expect(generated.peerDependencies).toEqual({
      ...core.peerDependencies,
      ...adapter.peerDependencies,
      '@deepseek-ai/dsh-scope': core.peerDependencies['@deepseek-ai/dsh-agent']
    })
    expect(generated.dependencies['@deepseek-ai/schemastery']).toBe(core.dependencies['@deepseek-ai/schemastery'])
    expect(evaluate(generated, {}, '0.2.2-alpha.3')).toBeUndefined()
  })

  it('reports an out-of-range 0.3.0-alpha.1 runtime as incompatible without an exemption', () => {
    const issue = evaluate(generated, {}, '0.3.0-alpha.1')
    const dshPeers = Object.fromEntries(Object.entries(generated.peerDependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')))
    expect(Object.keys(dshPeers).length).toBeGreaterThan(0)
    expect(issue).toEqual({
      name: generated.name,
      version: generated.version,
      runtimeVersion: '0.3.0-alpha.1',
      requirements: dshPeers,
      exempted: false
    })
  })
})
