import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import YAML from 'yaml'

it('keeps only native Windows build and verification on a hosted worker', async () => {
  for (const workflow of ['release', 'backfill-archive']) {
    const source = await readFile(path.resolve(import.meta.dirname, `../.github/workflows/${workflow}.yml`), 'utf8')
    const { jobs } = YAML.parse(source)
    for (const [name, job] of Object.entries(jobs)) {
      expect(job['runs-on']).toEqual(name === 'windows-x64'
        ? 'windows-2022'
        : ['self-hosted', 'macOS', name === 'macos-intel' ? 'bisheng-intel' : 'ARM64'])
    }
  }
})

it('uses local npm downloads and bounds Node setup on persistent release workers', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
  const { jobs } = YAML.parse(source)
  const persistentJobs = Object.values(jobs).filter(job =>
    Array.isArray(job['runs-on']) && job['runs-on'].includes('self-hosted')
  )
  expect(persistentJobs).toHaveLength(8)
  for (const job of persistentJobs) {
    const setup = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))
    if (!setup) {
      expect(job).toBe(jobs['validate-dispatch'])
      continue
    }
    expect(setup.with.cache).toBeUndefined()
    expect(setup['timeout-minutes']).toBe(5)
    const install = job.steps.find(step => step.run?.startsWith('npm ci'))
    expect(install.run).toContain('--prefer-offline')
  }
  const hostedSetup = jobs['windows-x64'].steps.find(step => step.uses?.startsWith('actions/setup-node@'))
  expect(hostedSetup.with.cache).toBe('npm')
  expect(hostedSetup.with['cache-dependency-path']).toBe('package-lock.json')
})

it('restores Windows download caches before installing dependencies', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
  const job = YAML.parse(source).jobs['windows-x64']
  const cacheIndex = job.steps.findIndex(step => step.uses === 'actions/cache@v4')
  const installIndex = job.steps.findIndex(step => step.run?.startsWith('npm ci'))
  expect(cacheIndex).toBeGreaterThan(-1)
  expect(cacheIndex).toBeLessThan(installIndex)
  const cache = job.steps[cacheIndex].with
  expect(cache.path.trim().split('\n')).toEqual([
    '${{ env.ELECTRON_CACHE }}',
    '${{ env.ELECTRON_BUILDER_CACHE }}',
    '.build/office-downloads'
  ])
  const configureIndex = job.steps.findIndex(step => step.name === 'Configure Windows packaging cache')
  expect(configureIndex).toBeGreaterThan(-1)
  expect(configureIndex).toBeLessThan(cacheIndex)
  expect(job.steps[configureIndex].shell).toBe('pwsh')
  expect(job.steps[configureIndex].run).toContain('"ELECTRON_CACHE=$env:RUNNER_TEMP/electron-cache" >> $env:GITHUB_ENV')
  expect(job.steps[configureIndex].run).toContain('"ELECTRON_BUILDER_CACHE=$env:RUNNER_TEMP/electron-builder-cache" >> $env:GITHUB_ENV')
  expect(cache.key).toBe("windows-x64-packaging-v1-${{ hashFiles('package-lock.json', 'scripts/office-runtime/lock.json') }}")
  expect(job.steps[installIndex].run).toBe('npm ci --prefer-offline')
})
