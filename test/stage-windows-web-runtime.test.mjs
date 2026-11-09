import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stageWindowsWebRuntime } from '../scripts/stage-windows-web-runtime.mjs'
import { addWebSidebarSwitcher } from '../scripts/web-sidebar-slot.mjs'
import { pluginManagerAlpha3Source, pluginManagerAlpha3IndexTypes, pluginManagerAlpha3OptionsTypes } from './fixtures/plugin-manager-alpha3.mjs'

test('rejects an incompatible or already patched sidebar', () => {
  assert.throws(() => addWebSidebarSwitcher('changed upstream'), /slot anchor/)
  const fixture = '\t\t\t\t\tpanels.length > 0 && (0, react_jsx_runtime.jsxs)("nav", {\n\t\t\t\t\t"sidebar.panellist": {\n\t\t\t\t\t"aria-label": label,\n\t\t\t\t\t"aria-current": active ? "page" : void 0,'
  assert.throws(() => addWebSidebarSwitcher(addWebSidebarSwitcher(fixture)), /already declares/)
})

test('stages explicit complete inputs, refuses overwrite and incomplete packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-stage-'))
  try {
    const modules = path.join(root, 'modules'), office = path.join(root, 'office'), ppt = path.join(root, 'ppt'), profile = path.join(root, 'profile'), node = path.join(root, 'node.exe'), output = path.join(root, 'out')
    const write = async (base, file, data = 'fixture') => { const p = path.join(base, file); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, data) }
    const packageFile = (base, name, extra = {}) => write(base, 'package.json', JSON.stringify({ name, ...extra }))
    const names = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui']
    await packageFile(path.join(modules, '@deepseek-ai/dsh'), '@deepseek-ai/dsh', { version: '0.2.2-alpha.3' })
    await packageFile(path.join(modules, '@deepseek-ai/dsh-app-boot'), '@deepseek-ai/dsh-app-boot', { version: '0.2.2-alpha.3' })
    await write(modules, '@deepseek-ai/dsh/lib/bin.js')
    const manager = path.join(modules, '@deepseek-ai/dsh-plugin-manager')
    await packageFile(manager, '@deepseek-ai/dsh-plugin-manager', { version: '0.2.2-alpha.3' })
    await write(manager, 'lib/index.js', pluginManagerAlpha3Source)
    await write(manager, 'lib/types/index.d.ts', pluginManagerAlpha3IndexTypes)
    await write(manager, 'lib/types/types.d.ts', pluginManagerAlpha3OptionsTypes)
    for (const name of names) await packageFile(path.join(modules, name), name, name.startsWith('@deepseek-ai/') ? { version: '0.2.2-alpha.3' } : {})
    await packageFile(path.join(modules, '@deepseek-ai/dsh-client-ui-sidebar'), '@deepseek-ai/dsh-client-ui-sidebar', { version: '0.2.2-alpha.3' })
    await write(modules, '@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', '\t\t\t\t\tpanels.length > 0 && (0, react_jsx_runtime.jsxs)("nav", {\n\t\t\t\t\t"sidebar.panellist": {\n\t\t\t\t\t"aria-label": label,\n\t\t\t\t\t"aria-current": active ? "page" : void 0,')
    await packageFile(office, 'dsh-desktop-office', { main: './web-index.js', os: ['win32'], cpu: ['x64'], engines: { node: '>=24' } })
    for (const file of ['web-index.js', 'web-cli.mjs', 'client.js', 'vendor/official.js', 'cordis.patch.yml', 'resources/templates/catalog.json', 'resources/primary-runtime/dependencies/python/python.exe']) await write(office, file)
    await packageFile(ppt, 'dsh-ppt-composer', { main: 'lib/web-index.js' })
    for (const file of ['lib/web-index.js', 'lib/client.js', 'cordis.patch.yml', 'vendor/dsh-ppt/lib/index.js']) await write(ppt, file)
    await write(profile, 'package.json', JSON.stringify({ dsh: { profile: { bundles: [...names, 'dsh-desktop-office', 'dsh-ppt-composer'] } } }))
    await write(profile, 'cordis.yml'); await write(profile, 'cordis.patch.yml'); await fs.writeFile(node, 'fixture')
    const args = { modules, node, office, ppt, profile, output }
    assert.equal(await stageWindowsWebRuntime(args), path.join(await fs.realpath(root), 'out'))
    assert.match(await fs.readFile(path.join(output, 'dsh-offline.cmd'), 'utf8'), /dsh-offline.mjs/)
    assert.match(await fs.readFile(path.join(output, 'start.sh'), 'utf8'), /dsh-offline\.mjs.*web/)
    assert.match(await fs.readFile(path.join(output, 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'), 'utf8'), /renderSlot\("sidebar.quickSwitcher", \{ wide, startSession, usePanelInfo \}\)/)
    const stagedManager = path.join(output, 'node_modules/@deepseek-ai/dsh-plugin-manager')
    assert.match(await fs.readFile(path.join(stagedManager, 'lib/index.js'), 'utf8'), /verifiedInstallContract = 1;/)
    assert.match(await fs.readFile(path.join(stagedManager, 'lib/index.js'), 'utf8'), /profileBundlePackageBackend/)
    assert.match(await fs.readFile(path.join(stagedManager, 'lib/types/index.d.ts'), 'utf8'), /readonly verifiedInstallContract: 1;/)
    assert.match(await fs.readFile(path.join(stagedManager, 'lib/types/types.d.ts'), 'utf8'), /expectedVersion\?: string;/)
    assert.equal(await fs.readFile(path.join(manager, 'lib/index.js'), 'utf8'), pluginManagerAlpha3Source)
    assert.equal(await fs.readFile(path.join(manager, 'lib/types/index.d.ts'), 'utf8'), pluginManagerAlpha3IndexTypes)
    assert.equal(await fs.readFile(path.join(manager, 'lib/types/types.d.ts'), 'utf8'), pluginManagerAlpha3OptionsTypes)
    await assert.rejects(fs.access(path.join(output, 'data')))
    await fs.access(path.join(output, 'profile', 'package.json'))
    await assert.rejects(stageWindowsWebRuntime(args), /EEXIST/)
    await packageFile(manager, '@deepseek-ai/dsh-plugin-manager', { version: '0.2.1-rc.2' })
    const badManager = path.join(root, 'bad-manager')
    await assert.rejects(stageWindowsWebRuntime({ ...args, output: badManager }), /Expected @deepseek-ai\/dsh-plugin-manager@0.2.2-alpha.3/)
    await assert.rejects(fs.access(badManager))
    assert.equal(await fs.readFile(path.join(manager, 'lib/index.js'), 'utf8'), pluginManagerAlpha3Source)
    await packageFile(manager, '@deepseek-ai/dsh-plugin-manager', { version: '0.2.2-alpha.3' })
    await packageFile(path.join(modules, '@deepseek-ai/dsh-app-boot'), '@deepseek-ai/dsh-app-boot', { version: '0.2.1-rc.2' })
    await assert.rejects(stageWindowsWebRuntime({ ...args, output: path.join(root, 'bad') }), /Expected @deepseek-ai\/dsh-app-boot@0.2.2-alpha.3/)
    await packageFile(path.join(modules, '@deepseek-ai/dsh-app-boot'), '@deepseek-ai/dsh-app-boot', { version: '0.2.2-alpha.3' })
    await write(profile, 'package.json', JSON.stringify({ dependencies: { 'dsh-ppt-composer': '0.1.1-rc.2' }, dsh: { profile: { bundles: [...names, 'dsh-desktop-office', 'dsh-ppt-composer'] } } }))
    await assert.rejects(stageWindowsWebRuntime({ ...args, output: path.join(root, 'bad') }), /Bundled plugin must not be a profile dependency: dsh-ppt-composer/)
    await write(profile, 'package.json', JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [...names, 'dsh-desktop-office', 'dsh-ppt-composer'] } } }))
    await fs.writeFile(path.join(office, 'package.json'), JSON.stringify({ name: 'dsh-desktop-office', os: ['darwin'], cpu: ['x64'], main: './web-index.js', engines: { node: '>=24' } }))
    await assert.rejects(stageWindowsWebRuntime({ ...args, output: path.join(root, 'bad') }), /Windows x64 Web/)
    await fs.symlink(node, path.join(modules, 'external-link'))
    await assert.rejects(stageWindowsWebRuntime({ ...args, output: path.join(root, 'bad') }), /Links are not portable/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
