import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'
import { desktopArtifacts, verifyDesktopArtifacts } from '../ops/ci/desktop-artifacts.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const manifest = require('../package.json')
const development = require('../electron-builder.dev.cjs')
const document = parseDocument(await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8'), { uniqueKeys: true })
if (document.errors.length) throw document.errors[0]
const workflow = document.toJS()
const jobs = workflow.jobs
const named = (job, name) => jobs[job].steps.find(step => step.name === name)
const uploads = job => jobs[job].steps.filter(step => step.uses === 'actions/upload-artifact@v4')

// Evaluate the actual YAML expressions, with only the GitHub functions used here.
// No duplicated release predicates: changing a workflow guard changes the tested behavior.
function context(overrides = {}) {
  return {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/codex/bisheng-unified' },
    inputs: { mode: 'development', target: 'all', version: '', source_run_id: '', checks: 'extended' },
    needs: Object.fromEntries(Object.keys(jobs).map(name => [name, { result: 'success' }])),
    matrix: { arch: 'arm64' }, ...overrides
  }
}
function evaluate(expression, ctx) {
  if (expression === undefined) return true
  const source = expression.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '')
    .replace(/needs\.([a-zA-Z0-9_-]+)\./g, (_, name) => 'needs[' + JSON.stringify(name) + '].')
    .replaceAll('\\', '\\\\')
  return vm.runInNewContext('(' + source + ')', {
    ...ctx, startsWith: (value, prefix) => value.startsWith(prefix), always: () => true, success: () => true
  }, { timeout: 100 })
}
function enabledJobs(ctx) {
  return Object.entries(jobs).filter(([, job]) => evaluate(job.if, ctx)).map(([name]) => name)
}
function interpolate(value, ctx) {
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression, ctx)))
}

describe('private desktop release YAML contracts', () => {
  it('keeps native targets, main PRs, locked Node and least privilege', () => {
    expect(workflow.on.pull_request.branches).toEqual(['main'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(jobs.macos.strategy.matrix.include.map(row => [row.arch, row.runner])).toEqual([
      ['arm64', 'macos-15'], ['x64', 'macos-15-intel']
    ])
    expect(jobs['windows-x64']['runs-on']).toBe('windows-2022')
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (step.uses === 'actions/setup-node@v4') expect(step.with['node-version']).toBe('24.15.0')
      }
      if (job.permissions?.contents === 'write') expect(['publish', 'publish-prerelease']).toContain(name)
    }
    expect(jobs.publish.permissions).toEqual({ actions: 'read', contents: 'write' })
    expect(jobs['publish-prerelease'].permissions).toEqual({ contents: 'write' })
  })

  it('development and PR events select artifacts only, even after successful build dependencies', () => {
    for (const branch of ['main', 'codex/bisheng-unified']) {
      for (const target of ['all', 'macos', 'windows']) {
        const ctx = context()
        ctx.github.ref = 'refs/heads/' + branch
        ctx.inputs.target = target
        expect(enabledJobs(ctx).sort()).toEqual(['validate-dispatch',
          ...(target !== 'windows' ? ['macos'] : []), ...(target !== 'macos' ? ['windows-x64'] : [])].sort())
        for (const job of ['macos', 'windows-x64']) {
          const active = jobs[job].steps.filter(step => evaluate(step.if, ctx))
          expect(active.flatMap(step => Object.keys(step.env ?? {}))).not.toContain('CSC_LINK')
          expect(active.map(step => step.run ?? '').join('\n')).not.toMatch(/gh release|api\.upload|configure-rollout|signed_test_build|confirm_popup_release/)
          expect(uploads(job).filter(step => evaluate(step.if, ctx)).some(step => step.with.name.endsWith('-dev'))).toBe(true)
        }
      }
    }
    expect(enabledJobs(context({ github: { event_name: 'pull_request', ref: 'refs/pull/1/merge' }, inputs: {} }))).toEqual(['validate-dispatch', 'windows-x64'])
  })

  it('retains release, signing, source reuse and human approval gates', () => {
    const tag = context({ github: { event_name: 'push', ref: 'refs/tags/v1.2.3' }, inputs: { mode: '', version: '' } })
    expect(enabledJobs(tag)).toEqual(['validate-dispatch', 'macos', 'windows-x64', 'sign-windows', 'publish'])
    for (const dependency of ['macos', 'sign-windows', 'validate-dispatch']) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        const failed = structuredClone(tag)
        failed.needs[dependency].result = result
        expect(evaluate(jobs.publish.if, failed)).toBe(false)
      }
    }
    const recovery = context()
    Object.assign(recovery.inputs, { mode: 'publish', version: 'v1.2.3', source_run_id: '123' })
    expect(enabledJobs(recovery)).toEqual(['validate-dispatch', 'publish'])
    const steps = jobs.publish.steps.map(step => step.name)
    const review = steps.indexOf('Wait for Feishu release confirmation')
    expect(review).toBeGreaterThan(steps.indexOf('Verify release assets before publication'))
    for (const name of ['Inject approved popup notes into update feeds', 'Create or update release', 'Mirror release assets to ModelScope']) {
      expect(steps.indexOf(name)).toBeGreaterThan(review)
    }
    expect(named('publish', 'Recheck immutable source after human approval').if).toBe("inputs.mode == 'publish'")
    expect(named('sign-windows', 'Remove local signing files').if).toBe('always()')
    const prefix = manifest.build.artifactName.split('-' + '$' + '{os}')[0]
    for (const job of ['publish', 'publish-prerelease']) {
      expect(named(job, 'Verify release assets before publication').run).toContain('--artifact-prefix ' + prefix)
    }
    const signing = named('sign-windows', 'Sign Windows installer with SafeNet UKey')
    expect(signing.env.JSIGN_NAME).toBe(manifest.build.productName)
    expect(signing.env.JSIGN_URL).toBe('https://www.dshdesktop.com')
    const upload = named('publish-signed-test', 'Upload test installers, verify downloads, and send Feishu notification')
    expect(upload.run).toContain('--artifact-prefix ' + prefix + ' --product-name ' + manifest.build.productName)
    const signed = context()
    signed.inputs.mode = 'signed'
    expect(enabledJobs(signed)).toContain('publish-signed-test')
    expect(enabledJobs(signed)).not.toContain('publish')
    const prerelease = context()
    Object.assign(prerelease.inputs, { mode: 'prerelease', version: '1.2.3-rc.1' })
    expect(enabledJobs(prerelease)).toContain('publish-prerelease')
    prerelease.inputs.target = 'windows'
    expect(enabledJobs(prerelease)).not.toContain('publish-prerelease')
  })

  it('matches every uploaded platform file to real builder metadata', () => {
    for (const [channel, config] of [['release', manifest.build], ['development', development]]) {
      for (const [platform, job, arches] of [['mac', 'macos', ['arm64', 'x64']], ['win', 'windows-x64', ['x64']]]) {
        for (const arch of arches) {
          const inventory = desktopArtifacts(config, { platform, arch, channel })
          const upload = uploads(job).find(step => platform === 'mac'
            ? step.with.name === (channel === 'release' ? '${{ matrix.artifact }}' : '${{ matrix.artifact }}-dev')
            : step.with.name === (channel === 'release' ? 'windows-x64-unsigned' : 'windows-x64-dev'))
          const paths = interpolate(upload.with.path, context({ matrix: { arch } })).trim().split('\n')
          expect(paths).toEqual([...inventory.assets.slice(0, platform === 'win' && channel === 'release' ? 1 : undefined),
            ...(platform === 'win' && channel === 'release' ? ['dist/win-unpacked.tar.gz', ...inventory.assets.slice(1)] : [])])
          expect(upload.with['if-no-files-found']).toBe('error')
          const verification = named(job, 'Verify all desktop build outputs')
          const ctx = context({ matrix: { arch } })
          ctx.inputs.mode = channel === 'release' ? 'signed' : 'development'
          expect(interpolate(verification.env.BUILD_CHANNEL, ctx)).toBe(channel)
          expect(interpolate(verification.run, ctx)).toBe('node ops/ci/desktop-artifacts.mjs "$BUILD_CHANNEL" ' + platform + ' ' + arch)
          expect(jobs[job].steps.indexOf(verification)).toBeLessThan(jobs[job].steps.indexOf(upload))
        }
      }
    }
    const smoke = named('windows-x64', 'Smoke test packaged Windows Harness')
    for (const [mode, config, channel] of [['development', development, 'development'], ['signed', manifest.build, 'release']]) {
      const ctx = context()
      ctx.inputs.mode = mode
      expect(interpolate(smoke.env.SMOKE_EXE, ctx).replaceAll('\\', '/')).toBe(desktopArtifacts(config, { platform: 'win', arch: 'x64', channel }).app)
      expect(interpolate(smoke.env.SMOKE_USERDATA, ctx)).toBe(channel === 'release' ? manifest.dshDesktopIdentity.userDataDirectory : manifest.dshDesktopIdentity.developmentUserDataDirectory)
    }
    expect(named('macos', 'Verify signed and notarized ${{ matrix.label }} app').run).toContain('/' + manifest.build.productName + '.app')
    const archive = uploads('windows-x64').find(step => step.with.name === 'windows-x64-dev-unpacked')
    expect(archive.with.path).toBe('dist-dev/win-unpacked.tar.gz')
    expect(evaluate(archive.if, context())).toBe(true)
    const standard = context()
    standard.inputs.checks = 'standard'
    expect(evaluate(archive.if, standard)).toBe(false)
  })

  it('runs the dispatch shell guard against valid and rejected input combinations', () => {
    const guard = named('validate-dispatch', 'Validate workflow_dispatch inputs').run
    function check(patch) {
      return spawnSync('bash', ['-c', guard], { encoding: 'utf8', env: {
        PATH: process.env.PATH, MODE: 'development', TARGET: 'all', VERSION: '', SOURCE_RUN_ID: '', CHECKS: 'extended', ...patch
      } })
    }
    for (const target of ['all', 'windows', 'macos']) expect(check({ TARGET: target }).status).toBe(0)
    for (const invalid of [
      { VERSION: '1.2.3' }, { SOURCE_RUN_ID: '12' }, { MODE: 'unknown' }, { TARGET: 'linux' }, { CHECKS: 'off' },
      { MODE: 'publish' }, { MODE: 'publish', VERSION: 'v1.2.3', SOURCE_RUN_ID: '12', TARGET: 'macos' },
      { MODE: 'signed', VERSION: 'v1.2.3' }, { MODE: 'resign', VERSION: '1.2.3', SOURCE_RUN_ID: '12' }
    ]) expect(check(invalid).status, JSON.stringify(invalid)).not.toBe(0)
    expect(check({ MODE: 'publish', VERSION: 'v1.2.3', SOURCE_RUN_ID: '12' }).status).toBe(0)
    expect(check({ MODE: 'resign', VERSION: '1.2.3', SOURCE_RUN_ID: '12', TARGET: 'windows' }).status).toBe(0)
  })

  it('keeps verify-target before native packaging and prevents packaging on target failure', async () => {
    const work = await mkdtemp(path.join(tmpdir(), 'desktop-command-'))
    try {
      for (const executable of ['node', 'npx']) {
        await writeFile(path.join(work, executable), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\ncase "$1" in scripts/verify/verify-target.mjs) exit "$TARGET_EXIT";; esac\n', { mode: 0o755 })
      }
      for (const job of ['macos', 'windows-x64']) {
        const commands = jobs[job].steps.filter(step => step.run?.startsWith('node scripts/verify/verify-target.mjs'))
        expect(commands).toHaveLength(2)
        for (const step of commands) {
          const command = interpolate(step.run, context())
          expect(command).toMatch(/verify-target\.mjs (darwin arm64|win32 x64) && /)
          expect(command).toContain('--publish never')
          for (const result of ['1', '0']) {
            const calls = path.join(work, 'calls')
            await writeFile(calls, '')
            const run = spawnSync('bash', ['-c', command], { env: { PATH: work + path.delimiter + process.env.PATH, CALLS: calls, TARGET_EXIT: result } })
            expect(run.status).toBe(Number(result))
            expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(result === '1' ? 1 : 2)
          }
        }
      }
    } finally { await rm(work, { recursive: true, force: true }) }
  })
})

it('publishes the private product to the repository served by its update gateway', async () => {
  const config = await readFile(path.join(root, 'ops/nginx/work-updates.conf'), 'utf8')
  const match = /modelscope[.]cn\/models\/([^/]+\/[^/]+)\/resolve\/master\/releases\/latest/.exec(config)
  expect(match).not.toBeNull()
  const destinations = Object.values(jobs).flatMap(job => job.steps ?? []).map(step => step.env?.MODELSCOPE_REPO_ID).filter(Boolean)
  expect(destinations).toHaveLength(3)
  for (const destination of destinations) expect(destination).toBe(match[1])
})

describe('metadata-derived desktop output verification', () => {
  it('accepts a complete product fixture and rejects a missing or empty individual asset', async () => {
    const previousNoAsar = process.noAsar
    process.noAsar = true // Harness may execute Vitest under Electron; fixtures are ordinary files.
    const directory = await mkdtemp(path.join(tmpdir(), 'desktop-inventory-'))
    const inventory = desktopArtifacts(development, { platform: 'mac', arch: 'arm64', channel: 'development' })
    try {
      await mkdir(path.join(directory, inventory.app), { recursive: true })
      for (const name of [inventory.payload, ...inventory.assets]) {
        await mkdir(path.dirname(path.join(directory, name)), { recursive: true })
        await writeFile(path.join(directory, name), 'fixture')
      }
      await expect(verifyDesktopArtifacts(directory, inventory)).resolves.toBeUndefined()
      for (const name of inventory.assets) {
        await writeFile(path.join(directory, name), '')
        await expect(verifyDesktopArtifacts(directory, inventory)).rejects.toThrow('empty')
        await rm(path.join(directory, name))
        await expect(verifyDesktopArtifacts(directory, inventory)).rejects.toThrow()
        await writeFile(path.join(directory, name), 'fixture')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
      process.noAsar = previousNoAsar
    }
  })

  it('derives alternate product names and fails closed on unsupported paths and targets', () => {
    const config = { ...development, productName: 'Example Dev', artifactName: 'example-${os}-${arch}.${ext}' }
    expect(desktopArtifacts(config, { channel: 'development', platform: 'mac', arch: 'x64' })).toMatchObject({
      app: 'dist-dev/mac/Example Dev.app', assets: ['dist-dev/example-mac-x64.dmg', 'dist-dev/example-mac-x64.zip', 'dist-dev/example-mac-x64.zip.blockmap']
    })
    for (const patch of [{ directories: { output: '../escape' } }, { productName: '../escape' }, { artifactName: '../escape.${ext}' }, { artifactName: '${version}.zip' }]) {
      expect(() => desktopArtifacts({ ...config, ...patch }, { channel: 'development', platform: 'mac', arch: 'arm64' })).toThrow()
    }
    expect(() => desktopArtifacts(config, { channel: 'development', platform: 'win', arch: 'arm64' })).toThrow()
  })
})
