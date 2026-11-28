import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const workflows = ['verify-boundary', 'bisheng-ci', 'build-web-runtime', 'release']
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

it.each(workflows)('%s fetches the reviewed commit even when the remote branch advances', name => {
  const temporary = mkdtempSync(join(tmpdir(), 'enterprise-ci-baseline-'))
  try {
    const remote = join(temporary, 'upstream'), client = join(temporary, 'client')
    mkdirSync(remote); mkdirSync(client)
    git(remote, 'init', '-b', 'V0.14.1')
    git(remote, 'config', 'user.name', 'Fixture'); git(remote, 'config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(remote, 'core.txt'), 'reviewed')
    git(remote, 'add', '.'); git(remote, 'commit', '-m', 'reviewed')
    const reviewed = git(remote, 'rev-parse', 'HEAD')
    writeFileSync(join(remote, 'core.txt'), 'new upstream change')
    git(remote, 'commit', '-am', 'advance branch')
    git(client, 'init')
    mkdirSync(join(client, 'ops/ci'), { recursive: true })
    writeFileSync(join(client, 'ops/ci/upstream-baseline.json'), JSON.stringify({ commit: reviewed }))
    const workflow = readFileSync(resolve(`.github/workflows/${name}.yml`), 'utf8')
    const match = workflow.match(/          git remote add upstream[^\n]+\n(?:          [^\n]+\n)+/)
    expect(match).not.toBeNull()
    const block = match[0].replace(/^          /gm, '').replace('https://github.com/dataelement/dsh-desktop.git', "'" + remote.replaceAll("'", "'\\''") + "'")
    execFileSync('bash', ['-e', '-c', block], { cwd: client, stdio: 'pipe' })
    expect(git(client, 'rev-parse', 'upstream/V0.14.1')).toBe(reviewed)
    expect(git(client, 'show', 'upstream/V0.14.1:core.txt')).toBe('reviewed')
    expect(git(remote, 'rev-parse', 'HEAD')).not.toBe(reviewed)
    writeFileSync(join(client, 'ops/ci/upstream-baseline.json'), JSON.stringify({ commit: 'invalid' }))
    git(client, 'remote', 'remove', 'upstream')
    expect(() => execFileSync('bash', ['-e', '-c', block], { cwd: client, stdio: 'pipe' })).toThrow()
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})
