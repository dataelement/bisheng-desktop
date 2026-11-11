import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { parse } = require('yaml')
const workflowNames = ['verify-boundary', 'build-web-runtime', 'bisheng-ci']
function workflow(name) {
  return parse(readFileSync(new URL('../.github/workflows/' + name + '.yml', import.meta.url), 'utf8'))
}

test('candidate workflows cannot acquire publication permissions, secrets or tag publication triggers', () => {
  for (const name of workflowNames) {
    const config = workflow(name)
    assert.deepEqual(config.permissions, { contents: 'read' }, name)
    assert.deepEqual(config.on.push.branches, ['main', 'codex/bisheng-unified'])
    assert.equal(config.on.push.tags, undefined)
    assert.deepEqual(config.on.pull_request.branches, ['main', 'codex/bisheng-unified'])
    assert.ok(Object.hasOwn(config.on, 'workflow_dispatch'))
    for (const job of Object.values(config.jobs)) {
      assert.equal(job.permissions, undefined)
      for (const step of job.steps) {
        assert.doesNotMatch(JSON.stringify(step), /secrets\.|gh release|action-gh-release|MODELSCOPE|FEISHU|configure-rollout|contents:write/i)
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
      }
    }
  }
})

test('boundary preparation fails closed and uses one explicit reviewed upstream', () => {
  for (const name of workflowNames) {
    for (const job of Object.values(workflow(name).jobs)) {
      const fetch = job.steps.find(step => step.run?.includes('git fetch'))
      assert.ok(fetch, name)
      assert.match(fetch.run, /bisheng-adaptor:refs\/remotes\/upstream\/bisheng-adaptor/)
      assert.doesNotMatch(fetch.run, /\|\||continue-on-error|upstream main/)
      const gate = job.steps.find(step => step.run === 'npm run verify:boundary')
      assert.equal(gate.env.UPSTREAM_BASE, 'upstream/bisheng-adaptor')
    }
  }
})

test('portable build consumes platform choice and uploads only verified Actions artifacts', () => {
  const config = workflow('build-web-runtime')
  assert.deepEqual(config.on.workflow_dispatch.inputs.target_platform.options, ['windows-x64', 'all'])
  const job = config.jobs['build-windows']
  assert.match(job.if, /inputs.target_platform == 'windows-x64'/)
  assert.match(job.if, /inputs.target_platform == 'all'/)
  const assembly = job.steps.find(step => step.run?.includes('ops/ci/build-web-portable.mjs'))
  assert.ok(assembly)
  assert.match(assembly.run, /--node-directory/)
  for (const input of ['modules', 'office', 'ppt', 'output']) assert.match(assembly.run, new RegExp('--' + input + '-directory'))
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
  assert.ok(job.steps.indexOf(assembly) < job.steps.indexOf(upload))
  assert.equal(upload.with['if-no-files-found'], 'error')
  assert.match(upload.with.path, /\.zip\.verification\.json/)
  assert.doesNotMatch(JSON.stringify(config), /Downloads|offline-base|pnpm@latest|node-v22/)
})

test('native candidate checks retain all Desktop targets and ordinary Node tests', () => {
  const job = workflow('bisheng-ci').jobs['native-checks']
  const desktop = job.strategy.matrix.include.filter(target => target.desktop)
  assert.deepEqual(desktop.map(target => target.platform + '/' + target.arch).sort(), ['darwin/arm64', 'darwin/x64', 'win32/x64'])
  assert.ok(job.steps.some(step => step.run === 'npm test -- --maxWorkers=2' && step.if === 'matrix.desktop'))
  assert.ok(job.steps.some(step => step.run === 'npm run build' && step.if === 'matrix.desktop'))
  const linux = job.steps.find(step => step.name?.includes('Linux pure Web'))
  assert.ok(linux)
  assert.match(linux.run, /node node_modules\/vitest\/vitest.mjs run/)
  assert.doesNotMatch(linux.run, /npm test|office:prepare/)
  assert.ok(job.steps.some(step => step.run?.includes('scripts/verify/verify-target.mjs')))
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts
  for (const target of desktop) {
    const command = scripts[target['package-script']]
    assert.match(command, /--publish never/)
    assert.match(command, /electron-builder.dev.cjs/)
    assert.match(command, /verify-target.mjs/)
  }
  assert.ok(job.steps.some(step => step.run?.includes('ops/ci/desktop-artifacts.mjs development')))
  assert.ok(job.steps.every(step => !step.uses?.startsWith('actions/upload-artifact@')))
})
