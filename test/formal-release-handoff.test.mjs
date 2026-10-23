import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import YAML from 'yaml'

it('uses draft releases for formal and complete pre-release handoff before ModelScope publication', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
  const jobs = YAML.parse(source).jobs
  const step = (job, name) => jobs[job].steps.find(item => item.name === name)
  const formal = "startsWith(github.ref, 'refs/tags/v')"
  const staged = "inputs.mode == 'signed' || inputs.mode == 'prerelease'"

  expect(step('validate-dispatch', 'Prepare draft release for verified publication').if).toContain(formal)
  expect(step('validate-dispatch', 'Prepare draft release for verified publication').if).toContain("github.event_name == 'workflow_dispatch'")
  for (const [job, name] of [
    ['macos', 'Stage signed ${{ matrix.label }} assets in draft release'],
    ['windows-x64', 'Stage unsigned Windows assets in draft release'],
    ['sign-windows', 'Stage signed Windows assets in draft release']
  ]) {
    expect(step(job, name).if).toContain(formal)
    expect(step(job, name).if).toContain(staged)
    expect(step(job, name).run).toContain('gh release upload')
  }
  for (const job of Object.values(jobs)) {
    expect(job.steps.some(item => /actions\/(upload|download)-artifact@/.test(item.uses ?? ''))).toBe(false)
  }
  expect(step('sign-windows', 'Download unsigned Windows assets from draft release').if).toContain(staged)
  expect(step('sign-windows', 'Download unsigned Windows assets from draft release').run)
    .toContain('verify-release-staging.mjs')
  const names = jobs.publish.steps.map(item => item.name)
  expect(names.indexOf('Download verified platform assets from draft release'))
    .toBeLessThan(names.indexOf('Verify release assets before publication'))
  expect(names.indexOf('Verify release assets before publication'))
    .toBeLessThan(names.indexOf('Mirror formal release to ModelScope'))
  expect(names.indexOf('Verify public ModelScope update metadata'))
    .toBeLessThan(names.indexOf('Publish verified GitHub release'))
  const prereleaseNames = jobs['publish-prerelease'].steps.map(item => item.name)
  expect(prereleaseNames.indexOf('Download verified pre-release assets from draft release'))
    .toBeLessThan(prereleaseNames.indexOf('Verify release assets before publication'))
  expect(prereleaseNames.indexOf('Verify release assets before publication'))
    .toBeLessThan(prereleaseNames.indexOf('Mirror pre-release assets to ModelScope'))
  expect(prereleaseNames.indexOf('Verify public ModelScope pre-release metadata'))
    .toBeLessThan(prereleaseNames.indexOf('Publish verified GitHub pre-release'))
  expect(step('publish-prerelease', 'Mirror pre-release assets to ModelScope').run)
    .toContain('releases/prerelease/latest')
  const signedNames = jobs['publish-signed'].steps.map(item => item.name)
  expect(signedNames.indexOf('Download verified signed test assets from draft release'))
    .toBeLessThan(signedNames.indexOf('Mirror signed test assets to ModelScope'))
  expect(signedNames.indexOf('Mirror signed test assets to ModelScope'))
    .toBeLessThan(signedNames.indexOf('Verify public ModelScope signed test metadata'))
  expect(signedNames.indexOf('Verify public ModelScope signed test metadata'))
    .toBeLessThan(signedNames.indexOf('Record signed test downloads'))
  expect(step('publish-signed', 'Mirror signed test assets to ModelScope').run)
    .toContain('releases/test/{tag}')
  expect(step('publish-signed', 'Mirror signed test assets to ModelScope').run)
    .toContain('releases/test/latest')
  expect(step('publish-signed', 'Mirror signed test assets to ModelScope').run)
    .not.toContain('releases/prerelease/')
  expect(jobs['publish-signed'].steps.map(item => item.run ?? '').join('\n')).not.toContain('--draft=false')
  expect(jobs['publish-signed'].steps.map(item => item.run ?? '').join('\n')).not.toContain('--prerelease')
  for (const [job, name] of [
    ['publish', 'Publish verified GitHub release'],
    ['publish-prerelease', 'Publish verified GitHub pre-release']
  ]) {
    const run = step(job, name).run
    expect(run).toContain('node scripts/prune-github-release-assets.mjs')
    expect(run.indexOf('prune-github-release-assets.mjs')).toBeLessThan(run.indexOf('gh release edit'))
  }
})
