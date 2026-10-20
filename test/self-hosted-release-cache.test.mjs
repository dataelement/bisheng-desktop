import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import YAML from 'yaml'

it('uses local npm downloads and bounds Node setup on persistent release workers', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
  const { jobs } = YAML.parse(source)
  const persistentJobs = Object.values(jobs).filter(job =>
    Array.isArray(job['runs-on']) && job['runs-on'].includes('self-hosted')
  )
  expect(persistentJobs).toHaveLength(1)
  for (const job of persistentJobs) {
    const setup = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))
    expect(setup).toBeDefined()
    expect(setup.with?.cache).toBeUndefined()
    expect(setup['timeout-minutes']).toBe(5)
  }
  const macSetup = jobs.macos.steps.find(step => step.if === "matrix.arch == 'arm64'" && step.uses?.startsWith('actions/setup-node@'))
  expect(macSetup).toBeDefined()
  expect(macSetup.with?.cache).toBeUndefined()
  expect(macSetup['timeout-minutes']).toBe(5)
  const hostedSetup = jobs['windows-x64'].steps.find(step => step.uses?.startsWith('actions/setup-node@'))
  expect(hostedSetup.with.cache).toBe('npm')
})
