import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'vitest'
import vm from 'node:vm'

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
    assert.equal(config.on.push, undefined, 'branch pushes must not duplicate PR checks')
    if (name === 'build-web-runtime') assert.equal(config.on.pull_request, undefined)
    else assert.deepEqual(config.on.pull_request.branches, ['main', 'V1.3.1', 'codex/bisheng-unified'])
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
      assert.match(fetch.run, /ops\/ci\/upstream-baseline\.json/)
      assert.match(fetch.run, /git fetch --no-tags upstream "\$baseline_commit"/)
      assert.match(fetch.run, /git update-ref refs\/remotes\/upstream\/V0.14.1 "\$baseline_commit"/)
      assert.doesNotMatch(fetch.run, /git fetch[^\n]*upstream V0\.14\.1/)
      assert.doesNotMatch(fetch.run, /\|\||continue-on-error|upstream main/)
      const gate = job.steps.find(step => step.run === 'npm run verify:boundary')
      assert.equal(gate.env.UPSTREAM_BASE, 'upstream/V0.14.1')
      if (name === 'bisheng-ci') assert.equal(gate.if, "github.event_name == 'workflow_dispatch'")
      else assert.equal(gate.if, undefined)
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

function candidateTargets(event = 'pull_request', extended = false) {
  const expression = workflow('bisheng-ci').jobs['native-checks'].strategy.matrix.include.slice(3, -2).trim()
  return JSON.parse(JSON.stringify(vm.runInNewContext(expression, {
    github: { event_name: event }, inputs: { extended }, fromJSON: JSON.parse
  })))
}

test('daily PRs retain one native target; full platform checks require explicit manual selection', () => {
  assert.deepEqual(candidateTargets().map(target => target.platform + '/' + target.arch), ['darwin/arm64'])
  assert.deepEqual(candidateTargets('pull_request', true), candidateTargets())
  assert.deepEqual(candidateTargets('workflow_dispatch'), candidateTargets())
  assert.equal(workflow('bisheng-ci').on.workflow_dispatch.inputs.extended.default, false)
})

test('extended candidate checks retain all Desktop targets and ordinary Node tests', () => {
  const job = workflow('bisheng-ci').jobs['native-checks']
  const targets = candidateTargets('workflow_dispatch', true)
  assert.deepEqual(targets.map(target => target.platform + '/' + target.arch).sort(), ['darwin/arm64', 'darwin/x64', 'linux/x64', 'win32/x64'])
  const desktop = targets.filter(target => target.desktop)
  assert.deepEqual(desktop.map(target => target.platform + '/' + target.arch).sort(), ['darwin/arm64', 'darwin/x64', 'win32/x64'])
  const full = job.steps.find(step => step.run === 'npm test -- --maxWorkers=2')
  assert.equal(full.if, "github.event_name == 'workflow_dispatch' && inputs.extended && matrix.desktop")
  const core = job.steps.find(step => step.name === 'Run core business and CI regressions')
  assert.equal(core.if, "matrix.desktop && !(github.event_name == 'workflow_dispatch' && inputs.extended)")
  for (const suite of ['enterprise-auth-client', 'enterprise-apps-integration', 'enterprise-generation-lifecycle', 'enterprise-market', 'enterprise-proxy', 'enterprise-content-safety-runtime', 'enterprise-cloud-workbench-tools', 'workbench-client', 'enterprise-boundary-gate', 'enterprise-release-workflow']) {
    assert.ok(core.run.includes('test/' + suite + '.test.'), suite)
  }
  assert.ok(!core.run.includes(' --exclude'), 'core selection must not silently exclude failing cases')
  assert.ok(job.steps.some(step => step.run === 'npm run build' && step.if === 'matrix.desktop'))
  const linux = job.steps.find(step => step.name?.includes('Linux pure Web'))
  assert.ok(linux)
  assert.match(linux.run, /node node_modules\/vitest\/vitest.mjs run/)
  assert.doesNotMatch(linux.run, /npm test|office:prepare/)
  for (const name of ['Verify native Desktop loader', 'Build unsigned Desktop packages with mandatory afterPack gates', 'Verify Desktop package files']) {
    const step = job.steps.find(step => step.name === name)
    assert.equal(step.if, "github.event_name == 'workflow_dispatch' && inputs.extended && matrix.desktop")
  }
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


test('all candidate jobs disable checkout newline conversion before checkout', () => {
  for (const name of workflowNames) {
    for (const job of Object.values(workflow(name).jobs)) {
      const preparation = job.steps.findIndex(step => step.run === 'git config --global core.autocrlf false')
      const checkout = job.steps.findIndex(step => step.uses?.startsWith('actions/checkout@'))
      assert.ok(preparation >= 0 && preparation < checkout, name)
    }
  }
})


test('Windows uses its native shell while Linux executes the enterprise installer scripts', () => {
  const job = workflow('bisheng-ci').jobs['native-checks']
  assert.equal(job.defaults.run.shell, "${{ matrix.platform == 'win32' && 'pwsh' || 'bash' }}")
  assert.equal(job.steps.find(step => step.name === 'Fetch reviewed upstream baseline').shell, 'bash')
  const tar = job.steps.find(step => step.name === 'Verify native Windows tar')
  assert.equal(tar.if, "matrix.platform == 'win32'")
  assert.match(tar.run, /System32\/tar.exe/)
  assert.match(job.steps.find(step => step.name?.includes('Linux pure Web')).run, /test\/enterprise-linux-installer.test.mjs/)
})
