import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import YAML from 'yaml'
import { developmentAssets } from '../scripts/stage-development-assets.mjs'

const temporaryDirectories = []
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'development-release-'))
  temporaryDirectories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

it.each([
  ['arm64', ['bisheng-dev-mac-arm64.dmg', 'bisheng-dev-mac-arm64.zip']],
  ['x64', ['bisheng-dev-mac-x64.dmg', 'bisheng-dev-mac-x64.zip']],
  ['windows', ['bisheng-dev-windows-x64-setup.exe']]
])('requires the %s installers while allowing absent updater metadata', async (platform, names) => {
  const directory = await temporaryDirectory()
  await expect(developmentAssets(directory, platform)).rejects.toThrow()
  for (const name of names) await writeFile(path.join(directory, name), 'installer')
  expect(await developmentAssets(directory, platform)).toEqual(names.map(name => path.join(directory, name)))
  const metadata = platform === 'windows' ? 'latest.yml' : `bisheng-dev-mac-${platform}.zip.blockmap`
  await writeFile(path.join(directory, metadata), 'metadata')
  expect(await developmentAssets(directory, platform)).toContain(path.join(directory, metadata))
  await writeFile(path.join(directory, names[0]), '')
  await expect(developmentAssets(directory, platform)).rejects.toThrow('empty development installer')
})

it('forbids Actions artifact transfers in every workflow', async () => {
  const directory = path.resolve(import.meta.dirname, '../.github/workflows')
  for (const name of await readdir(directory)) {
    if (!/\.ya?ml$/.test(name)) continue
    const source = await readFile(path.join(directory, name), 'utf8')
    expect(source).not.toMatch(/actions\/(?:upload|download)-artifact@|gh\s+run\s+download|\/actions\/artifacts/)
  }
})

it.skipIf(process.platform === 'win32').each([
  ['development', 'refs/heads/main', 'dev-123-2'],
  ['signed', 'refs/heads/main', '1.0.3-test.1'],
  ['prerelease', 'refs/heads/main', '1.0.3-rc.1'],
  ['prerelease', 'refs/tags/v1.0.3', 'v1.0.3']
])('prepares the correct draft for %s at %s and rejects published releases', async (mode, ref, expectedTag) => {
  const directory = await temporaryDirectory()
  const workflow = YAML.parse(await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8'))
  const prepare = workflow.jobs['validate-dispatch'].steps.find(step => step.name === 'Prepare draft release for verified publication')
  const script = path.join(directory, 'prepare.sh')
  const calls = path.join(directory, 'calls.jsonl')
  await writeFile(script, prepare.run)
  await writeFile(path.join(directory, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n')
if (args[1] === 'view') {
  if (process.env.PUBLISHED === 'true') process.stdout.write('false\\n')
  else process.exitCode = 1
}
`, { mode: 0o755 })
  const env = {
    ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, CALLS: calls,
    MODE: mode, GITHUB_REF: ref, GITHUB_REF_NAME: ref.split('/').at(-1),
    SIGNED_VERSION: '1.0.3-test.1', PRERELEASE_TAG: '1.0.3-rc.1', DEV_RELEASE_TAG: 'dev-123-2',
    GITHUB_REPOSITORY: 'example/desktop', GITHUB_SHA: 'example-sha', GITHUB_RUN_ID: '123',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_STEP_SUMMARY: path.join(directory, 'summary'), PUBLISHED: 'false'
  }
  execFileSync('bash', [script], { env, stdio: 'pipe' })
  const invocations = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const create = invocations.find(args => args[1] === 'create')
  expect(create.slice(0, 3)).toEqual(['release', 'create', expectedTag])
  expect(create).toContain('--draft')
  expect(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain(expectedTag)
  expect(() => execFileSync('bash', [script], { env: { ...env, PUBLISHED: 'true' }, stdio: 'pipe' }))
    .toThrow()
})

it('stages every signed and prerelease target before Windows signing', async () => {
  const workflow = YAML.parse(await readFile(path.resolve(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8'))
  const jobs = workflow.jobs
  const evaluate = (expression, mode, target) => new Function('github', 'inputs', 'startsWith', `return (${expression})`)(
    { event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { mode, target }, (value, prefix) => value.startsWith(prefix)
  )
  for (const target of ['all', 'macos', 'windows']) {
    for (const mode of ['signed', 'prerelease', 'development']) {
      const prepare = jobs['validate-dispatch'].steps.find(step => step.name === 'Prepare draft release for verified publication')
      expect(evaluate(prepare.if, mode, target)).toBe(true)
      for (const [job, name] of [
        ['windows-x64', 'Stage unsigned Windows assets in draft release'],
        ['sign-windows', 'Download unsigned Windows assets from draft release'],
        ['sign-windows', 'Stage signed Windows assets in draft release'],
        ['macos-apple-silicon', 'Stage signed Apple Silicon assets in draft release'],
        ['macos-intel', 'Stage signed Intel assets in draft release']
      ]) {
        expect(evaluate(jobs[job].steps.find(step => step.name === name).if, mode, target)).toBe(mode !== 'development')
      }
    }
  }
})

it.skipIf(process.platform === 'win32')('uploads validated development files and propagates upload failures', async () => {
  const directory = await temporaryDirectory()
  const installer = path.join(directory, 'bisheng-dev-windows-x64-setup.exe')
  await writeFile(installer, 'installer')
  await writeFile(path.join(directory, 'gh'), `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)))
process.exitCode = Number(process.env.UPLOAD_EXIT)
`, { mode: 0o755 })
  const env = {
    ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    CALLS: path.join(directory, 'calls.json'), DEV_RELEASE_TAG: 'dev-123-2', GITHUB_REPOSITORY: 'example/desktop', UPLOAD_EXIT: '0'
  }
  const script = path.resolve(import.meta.dirname, '../scripts/stage-development-assets.mjs')
  execFileSync(process.execPath, [script, 'windows', directory], { env, stdio: 'pipe' })
  expect(JSON.parse(await readFile(env.CALLS, 'utf8'))).toEqual([
    'release', 'upload', 'dev-123-2', installer, '--clobber', '--repo', 'example/desktop'
  ])
  expect(() => execFileSync(process.execPath, [script, 'windows', directory], {
    env: { ...env, UPLOAD_EXIT: '1' }, stdio: 'pipe'
  })).toThrow()
})
