import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { test, onTestFinished } from 'vitest'
import { parseOptions, sha256, run } from '../ops/ci/build-web-portable.mjs'
import { registeredBootstrap, verifyWebPortable } from '../ops/ci/verify-web-portable.mjs'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'CI 离线 (fixture) '))
  onTestFinished(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}

test('requires all explicit absolute directories and rejects duplicates, unknown and malformed options', () => {
  const names = ['node', 'modules', 'office', 'ppt', 'output']
  const args = names.flatMap(name => ['--' + name + '-directory', path.resolve(name)])
  assert.equal(parseOptions(args)['node-directory'], path.resolve('node'))
  for (const invalid of [[], args.slice(0, -2), [...args, '--node-directory', path.resolve('other')],
    [...args, '--unknown', path.resolve('other')], ['--node-directory', 'relative'],
    ['node-directory', path.resolve('node')], ['--node-directory']]) {
    assert.throws(() => parseOptions(invalid), /required|Expected/)
  }
})

test('hashes actual bytes and child failures do not forward credentials', async () => {
  const root = await fixture()
  const file = path.join(root, 'bytes')
  await fs.writeFile(file, 'abc')
  assert.equal(await sha256(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.throws(() => run(process.execPath, ['-e', 'console.error("token=fixture-private");process.exit(7)']), error => {
    assert.match(error.message, /exit 7/)
    assert.doesNotMatch(error.message, /fixture-private/)
    return true
  })
})

test('requires executed bootstrap registration rather than matching text', () => {
  assert.equal(registeredBootstrap('// @deepseek-ai/dsh-client-modules'), false)
  assert.equal(registeredBootstrap('window.__ModuleLoader__.load({id:"other"})'), false)
  assert.equal(registeredBootstrap('window.__ModuleLoader__.load({id:"@deepseek-ai/dsh-client-modules"})'), true)
  assert.throws(() => registeredBootstrap('throw new Error("broken bootstrap")'), /broken bootstrap/)
})

async function runtimeFixture({ brokenImport = false, bootstrap = true } = {}) {
  const root = await fixture()
  await fs.mkdir(path.join(root, 'node'))
  if (process.platform === 'win32') await fs.copyFile(process.execPath, path.join(root, 'node/node.exe'))
  else await fs.symlink(process.execPath, path.join(root, 'node/node.exe'))
  const names = ['dsh-desktop-office', 'dsh-ppt-composer', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui']
  for (const name of names) {
    const directory = path.join(root, 'node_modules', name)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.js' }))
    await fs.writeFile(path.join(directory, 'index.js'), brokenImport && name === names[0] ? 'throw new Error("missing Office native runtime")' : 'export default {}')
  }
  await fs.writeFile(path.join(root, 'dsh-offline.mjs'), `import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
const root = path.dirname(fileURLToPath(import.meta.url));
const profile = path.join(root, 'data/profiles/web');
await fs.mkdir(profile, {recursive:true});
await fs.writeFile(path.join(profile,'package.json'), JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
await fs.writeFile(path.join(profile,'cordis.patch.yml'), 'name: dsh-desktop-office\\nname: dsh-ppt-composer');
if (process.argv.includes('--version')) { console.log('fixture'); process.exit(0); }
const server = http.createServer((req,res)=>{
  if (req.url.includes('token=')) {res.writeHead(302, {'Set-Cookie':'session=fixture; HttpOnly','Location':'/'});res.end();return;}
  if (req.headers.cookie !== 'session=fixture') {res.writeHead(401);res.end();return;}
  if (req.url.includes('client.js')) {res.setHeader('content-type','text/javascript');res.end(` + JSON.stringify(bootstrap ? 'window.__ModuleLoader__.load({id:"@deepseek-ai/dsh-client-modules"})' : '// bootstrap absent') + `);return;}
  res.setHeader('content-type','text/html');res.end('<script src="/@deepseek-ai/dsh-client-modules/client.js"></script>');
});
server.listen(0,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=fixture'));
`)
  return root
}

test('extract probe uses product Node, isolated Profile, authenticated HTML and executed bootstrap', async () => {
  const result = await verifyWebPortable(await runtimeFixture())
  assert.equal(result.authenticatedHtml, true)
  assert.equal(result.pluginImports, true)
  assert.equal(result.bootstrapRegistration, true)
  assert.equal(result.browserUiAcceptance, false)
})

test('missing Office runtime fails import before readiness is accepted', async () => {
  await assert.rejects(verifyWebPortable(await runtimeFixture({ brokenImport: true })), /Bundled Node probe failed/)
})

test('unregistered bootstrap rejects an otherwise healthy server and stops its process', async () => {
  await assert.rejects(verifyWebPortable(await runtimeFixture({ bootstrap: false })), /Bootstrap did not execute/)
})
