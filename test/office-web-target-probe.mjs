/** Opt-in real target-host service/authoring probe. Never writes a real Profile; an optional installed Kit root is read-only. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const target = process.env.DSH_OFFICE_HARNESS_ROOT
if (!target) throw new Error('Set DSH_OFFICE_HARNESS_ROOT to a built target checkout')
const project = process.cwd()
const packageRoot = path.resolve(process.env.DSH_OFFICE_WEB_PACKAGE ?? '.build/office-web/dsh-desktop-office')
const anchors = ['bundle/web-app', 'client/ui-conversation', 'deliverables/tool-present', 'test-support/tool-testkit', 'test-support/agent-loop-testkit', 'core/tools', 'skill/skill', 'sandbox/sandbox-local', 'subprocess/subprocess-local', 'session/working-directory']
const requires = anchors.map(folder => createRequire(path.join(target, 'packages', folder, 'package.json')))
function resolveHost(specifier) {
  for (const require of requires) { try { return require.resolve(specifier) } catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error } }
  throw new Error('Missing real target host peer: ' + specifier)
}
let resolving = false
registerHooks({ resolve(specifier, context, next) {
  if (!resolving && specifier.startsWith('@deepseek-ai/') && (context.parentURL?.startsWith(pathToFileURL(packageRoot + path.sep).href) || context.parentURL?.startsWith(pathToFileURL(path.join(project, '.build/ppt-web/dsh-ppt-composer') + path.sep).href))) {
    resolving = true
    let resolved
    try { resolved = resolveHost(specifier) } finally { resolving = false }
    return next(pathToFileURL(resolved).href, context)
  }
  return next(specifier, context)
} })
const host = specifier => {
  resolving = true
  let file
  try { file = resolveHost(specifier) } finally { resolving = false }
  return import(pathToFileURL(file).href)
}
const { Context } = await host('@deepseek-ai/cordis')
const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await host('@deepseek-ai/dsh-agent-loop-testkit')
const { default: Skills } = await host('@deepseek-ai/dsh-skill')
const { default: FsLocal } = await host('@deepseek-ai/dsh-fs-local')
const { default: WorkingDirectory } = await host('@deepseek-ai/dsh-working-directory')
const { default: Subprocess } = await host('@deepseek-ai/dsh-subprocess-local')
const { default: Sandbox } = await host('@deepseek-ai/dsh-sandbox-local')
const { default: SandboxPolicy } = await host('@deepseek-ai/dsh-sandbox-policy')
// Match an installed plugin's host peer links, including native CLI subprocess resolution.
const pluginManifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
await fs.mkdir(path.join(packageRoot, 'node_modules/@deepseek-ai'), { recursive: true })
for (const name of Object.keys({ ...pluginManifest.peerDependencies, '@deepseek-ai/libreoffice-kit': '0.1.5' })) {
  resolving = true
  let manifestPath
  try { manifestPath = name === '@deepseek-ai/libreoffice-kit' && process.env.DSH_OFFICE_KIT_ROOT
    ? path.join(path.resolve(process.env.DSH_OFFICE_KIT_ROOT), 'package.json') : resolveHost(name + '/package.json') } finally { resolving = false }
  const link = path.join(packageRoot, 'node_modules', name)
  await fs.rm(link, { recursive: true, force: true })
  await fs.symlink(path.dirname(manifestPath), link, 'dir')
}
const office = await import(pathToFileURL(path.join(packageRoot, 'web-index.js')).href)
const { createWebOfficeModes } = await import(pathToFileURL(path.join(packageRoot, 'lib/web-modes.js')).href)
const root = path.resolve('.build/office-web-target-receipt')
await fs.mkdir(root, { recursive: true })
const cwd = await fs.mkdtemp(path.join(root, 'workspace-'))
const ctx = new Context()
const kitEntry = await fs.realpath(path.join(packageRoot, 'node_modules/@deepseek-ai/libreoffice-kit/lib/index.js'))
const { createHash } = await import('node:crypto')
const receipt = { target, packageRoot, cwd, nativeKit: { entry: kitEntry, sha256: createHash('sha256').update(await fs.readFile(kitEntry)).digest('hex') }, tests: [] }
try {
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeRuntimeContext: false } })
  await ctx.plugin(Skills)
  await ctx.plugin(FsLocal, { cwd })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(Subprocess)
  await ctx.plugin(Sandbox)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: cwd })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create('office-target', {}, { cwd })
  const other = await harness.create('office-unselected', {}, { cwd })
  const fiber = ctx.plugin(office, { root: path.join(cwd, 'mode-state') }); await fiber
  assert(ctx.tools.get('office_template'))
  const lateAgent = await harness.create('office-created-after-plugin', {}, { cwd })
  assert(ctx.tools.get('load_workspace_dependencies', lateAgent))
  receipt.tests.push('existing-and-new-agent-runtime-tools-before-first-step')
  const modes = createWebOfficeModes(path.join(cwd, 'mode-state'), () => undefined)
  await modes.select(agent.session.id, 'word')
  const library = JSON.parse(await fs.readFile(path.join(packageRoot, 'resources/templates/catalog.json'), 'utf8'))
  const word = library.find(item => item.id === 'government-notice')
  await modes.selectTemplate(agent.session.id, { id: word.id, mode: word.mode, revision: word.revision })
  // Invoke the real middleware chain with real agent.ctx scope identity; no LLM request.
  await ctx.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert(ctx.tools.get('load_workspace_dependencies', other))
  assert(!ctx.tools.get('load_workspace_dependencies'))
  const abort = new AbortController()
  const exec = { agent, signal: abort.signal, call: { id: 'office-probe', name: 'office_template', arguments: {} } }
  const execute = async (name, args) => ctx.tools.get(name, agent).execute(args, exec)
  const dependencies = await execute('load_workspace_dependencies', {})
  receipt.dependencies = dependencies
  assert(path.isAbsolute(dependencies.python))
  receipt.tests.push('real-target-load-workspace-dependencies')
  const prepared = await execute('office_template', { template_id: word.id })
  receipt.preparedWord = prepared
  const paragraphs = prepared.editable_paragraphs
  assert(paragraphs.length)
  const output = path.join(cwd, 'office-target.docx')
  const written = await execute('office_template_write', { output_path: output, replacements: paragraphs.map(item => ({ id: item.id, text: item.text.replaceAll('关于', '关于') })) })
  assert.equal(written.path, output)
  receipt.word = written
  receipt.tests.push('native-word-template-write-and-layout-validation')
  const Present = await host('@deepseek-ai/dsh-tool-present')
  const { executeToolFixture } = await host('@deepseek-ai/dsh-tool-testkit')
  await ctx.plugin(Present, { maxFiles: 4 })
  agent.session.append('turn/start', { turn: 1 })
  const delivery = await executeToolFixture(ctx, { agent, signal: abort.signal, callId: 'office-present-probe', name: 'present', arguments: { files: [{ path: output }] } })
  assert.equal(delivery.isError, false, JSON.stringify(delivery))
  receipt.delivery = agent.session.snapshotEvents().find(event => event.type === 'deliverables/presented')
  assert(receipt.delivery)
  receipt.tests.push('real-present-pipeline-layout-guard-and-durable-delivery')
  await modes.select(agent.session.id, 'excel')
  const excel = library.find(item => item.mode === 'excel')
  await modes.selectTemplate(agent.session.id, { id: excel.id, mode: excel.mode, revision: excel.revision })
  const workbook = await execute('office_template', { template_id: excel.id })
  receipt.excel = workbook
  const workbookPath = path.resolve(cwd, workbook.files.find(item => item.workspace_path.endsWith('.xlsx')).workspace_path)
  const { stdout } = await promisify(execFile)(dependencies.python, ['-I', '-B', '-c', 'import openpyxl,sys,json; w=openpyxl.load_workbook(sys.argv[1]); w.worksheets[0]["A1"]="Office Web target probe"; w.create_sheet("Probe")["A1"]="=2+3"; w.save(sys.argv[1]); print(json.dumps(w.sheetnames))', workbookPath])
  receipt.excelSheets = JSON.parse(stdout)
  const cli = path.join(packageRoot, 'web-cli.mjs')
  const node = process.execPath
  const pdf = path.join(cwd, 'word.pdf')
  await promisify(execFile)(node, [cli, 'convert', '--input', output, '--output', pdf], { timeout: 120000 })
  const recalculated = path.join(cwd, 'recalculated.xlsx')
  await promisify(execFile)(node, [cli, 'recalculate', '--input', workbookPath, '--output', recalculated], { timeout: 120000 })
  const check = await promisify(execFile)(dependencies.python, ['-I', '-B', '-c', 'import openpyxl,sys; assert openpyxl.load_workbook(sys.argv[1],data_only=True)["Probe"]["A1"].value==5; print("formula-cache-5")', recalculated])
  receipt.formulaCache = check.stdout.trim()
  const preview = path.join(cwd, 'excel-preview')
  await promisify(execFile)(node, [cli, 'render', '--input', recalculated, '--output-dir', preview, '--sheet', receipt.excelSheets[0], '--range', 'A1:P20'], { timeout: 120000 })
  receipt.tests.push('bundled-python-openpyxl-edit', 'native-node-cli-docx-pdf', 'native-node-cli-excel-recalc', 'native-node-cli-excel-render')
  receipt.pdf = pdf; receipt.preview = preview
  await fiber.dispose()
  assert.equal(ctx.tools.get('load_workspace_dependencies', agent), undefined)
  assert.equal(ctx.tools.get('office_template'), undefined)
  receipt.tests.push('plugin-disposal-restores-agent-tool-state')
  const upstream = await import(pathToFileURL(path.join(packageRoot, 'vendor/official.js')).href)
  const stockConfig = { assetRoot: path.join(packageRoot, 'resources/office-skills'), node, cli }
  const stockRuntime = { source: path.join(packageRoot, 'resources/primary-runtime') }
  const options = { cwd, scope: agent, signal: abort.signal }
  const stockDeps = ctx.plugin(upstream.workspaceDependencies, stockRuntime); await stockDeps
  const stockSkills = ctx.plugin(upstream.officeSkills, stockConfig); await stockSkills
  assert.equal((await ctx.skills.get('office-render', options)).provider, 'dsh-office')
  let web = ctx.plugin(office, { root: path.join(cwd, 'mode-state') }); await web
  assert.equal((await ctx.skills.get('office-render', options)).provider, 'office-web-official')
  assert.notEqual(ctx.tools.get('load_workspace_dependencies', agent), ctx.tools.get('load_workspace_dependencies'))
  await web.dispose()
  assert.equal((await ctx.skills.get('office-render', options)).provider, 'dsh-office')
  assert.equal(ctx.tools.get('load_workspace_dependencies', agent), ctx.tools.get('load_workspace_dependencies'))
  await stockDeps.dispose(); await stockSkills.dispose()
  web = ctx.plugin(office, { root: path.join(cwd, 'mode-state') }); await web
  const lateStockDeps = ctx.plugin(upstream.workspaceDependencies, stockRuntime); await lateStockDeps
  const lateStockSkills = ctx.plugin(upstream.officeSkills, stockConfig); await lateStockSkills
  assert.equal((await ctx.skills.get('office-render', options)).provider, 'office-web-official')
  await lateStockDeps.dispose(); await lateStockSkills.dispose()
  assert(ctx.tools.get('load_workspace_dependencies', agent))
  assert.equal((await ctx.skills.get('office-render', options)).provider, 'office-web-official')
  await web.dispose()
  assert(!ctx.tools.get('load_workspace_dependencies', agent))
  receipt.tests.push('stock-first-web-disposal-restores-stock', 'web-first-stock-disposal-retains-web')
  // Real PPT service and store; boundary connection is unused by these method-level lifecycle checks.
  ctx.provide('connection', { rpc: { handle() {} } })
  const ppt = await import(pathToFileURL(path.join(project, '.build/ppt-web/dsh-ppt-composer/vendor/dsh-ppt/lib/index.js')).href)
  let pptFiber = ctx.plugin(ppt, { root: path.join(cwd, 'ppt-store') }); await pptFiber
  const bridge = createWebOfficeModes(path.join(cwd, 'bridge-state'), () => ctx.get('officeModes'))
  await bridge.select(agent.id, 'word')
  await bridge.selectTemplate(agent.id, { id: word.id, mode: word.mode, revision: word.revision })
  // External PPT RPC-style mutation happens after Office's most recent read.
  await ctx.get('officeModes').select(agent.id, 'excel')
  await pptFiber.dispose()
  assert.equal((await bridge.state(agent.id)).documentMode, 'excel')
  await bridge.select(agent.id, 'word')
  pptFiber = ctx.plugin(ppt, { root: path.join(cwd, 'ppt-store') }); await pptFiber
  assert.equal((await bridge.state(agent.id)).documentMode, 'word')
  await ctx.get('officeModes').select(agent.id, null)
  await pptFiber.dispose()
  assert.equal((await bridge.state(agent.id)).documentMode, undefined)
  receipt.tests.push('real-ppt-external-write-removal-handoff', 'real-ppt-reactivation-preserves-latest-choice')
  // Check the existing PPT skill policy at a real AgentLoop first-request boundary.
  const skillTool = await host('@deepseek-ai/dsh-tool-skill')
  await ctx.plugin(skillTool)
  const policySkills = ctx.plugin(upstream.officeSkills, stockConfig); await policySkills
  const { installWebModePolicy } = await import(pathToFileURL(path.join(project, '.build/ppt-web/dsh-ppt-composer/vendor/dsh-ppt/lib/web-mode-policy.js')).href)
  let pptActive = true
  const stopPolicy = installWebModePolicy(ctx, { state: async () => pptActive ? { presentationMode: 'ppt' } : {} })
  const { LlmAdapter, createUserMessage } = await host('@deepseek-ai/dsh-llm')
  const requests = []
  class ProbeAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async * stream(options) {
      requests.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'policy-probe-ok' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['office-probe'], new ProbeAdapter())
  const policyAgent = await harness.create('office-policy-first-step', { provider: 'office-probe', model: 'probe' }, { cwd })
  const send = async () => {
    const idle = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('AgentLoop probe did not settle')) }, 10000)
      const off = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === policyAgent && status === 'idle') { clearTimeout(timer); off(); resolve() }
      })
    })
    policyAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect current skill catalog' }], source: { kind: 'user' } }))
    await idle
  }
  await send()
  assert.equal(requests.length, 1)
  const catalog = request => request.messages.filter(message => message.source?.kind === 'skill-catalog').flatMap(message => message.source.entries.map(item => item.name))
  const firstCatalog = catalog(requests[0])
  assert(!firstCatalog.includes('office-pptx'))
  assert.equal((await ctx.skills.get('office-pptx', { cwd, scope: policyAgent, signal: abort.signal })).invocation.modelInvocable, false)
  pptActive = false
  await send()
  assert.equal(requests.length, 2)
  assert.equal((await ctx.skills.get('office-pptx', { cwd, scope: policyAgent, signal: abort.signal })).invocation.modelInvocable, true)
  receipt.policyFirstStep = { firstCatalog, secondCatalog: catalog(requests[1]), tools: requests[0].tools?.map(tool => tool.name) }
  await fs.writeFile(path.join(root, 'policy-first-step-requests.json'), JSON.stringify(requests, null, 2))
  stopPolicy(); await policySkills.dispose()
  receipt.tests.push('real-agent-loop-ppt-first-step-catalog-and-mode-exit')
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
} finally { await ctx.fiber.dispose() }
