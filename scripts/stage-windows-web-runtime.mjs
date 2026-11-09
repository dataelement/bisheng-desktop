// Assemble explicit Windows-native build inputs; never install or replace an output.
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkWebHarnessVersion } from './web-runtime-version.mjs'
import { addWebSidebarSwitcher } from './web-sidebar-slot.mjs'
import { applyWebPluginManagerPatch } from './web-plugin-manager.mjs'

async function requireFile(file) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.size === 0) throw new Error('Missing or empty file: ' + file)
}
async function manifest(dir, name) {
  const data = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  if (data.name !== name) throw new Error('Incorrect package identity: ' + dir)
  return data
}
async function checkTree(root) {
  const stat = await fs.lstat(root)
  if (stat.isSymbolicLink()) throw new Error('Links are not portable (including npm .bin links); materialize a trusted tree first: ' + root)
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(root)) await checkTree(path.join(root, name))
  } else if (!stat.isFile()) throw new Error('Unsupported file type: ' + root)
}
function overlaps(a, b) {
  const rel = path.relative(a, b)
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

/** Inputs must be built on Windows and materialized without junctions or symlinks. */
export async function stageWindowsWebRuntime({ modules, node, office, ppt, profile, output }) {
  const values = { modules, node, office, ppt, profile, output }
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(key + ' must be an absolute path')
  }
  for (const input of [modules, node, office, ppt, profile]) if ((await fs.lstat(input)).isSymbolicLink()) throw new Error('Links are not portable: ' + input)
  const sources = await Promise.all([modules, node, office, ppt, profile].map(p => fs.realpath(p)))
  const target = path.join(await fs.realpath(path.dirname(output)), path.basename(output))
  if (sources.some(source => overlaps(source, target) || overlaps(target, source))) throw new Error('Output must not overlap inputs')
  for (const source of sources) await checkTree(source)
  await checkWebHarnessVersion(modules)
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui']) await manifest(path.join(modules, name), name)
  const om = await manifest(office, 'dsh-desktop-office')
  if (!om.os?.includes('win32') || !om.cpu?.includes('x64') || om.main !== './web-index.js' || om.engines?.node !== '>=24') throw new Error('Office is not the Windows x64 Web build')
  const pm = await manifest(ppt, 'dsh-ppt-composer')
  if (pm.main !== 'lib/web-index.js') throw new Error('PPT is not the Web build')
  for (const file of ['web-index.js', 'web-cli.mjs', 'client.js', 'vendor/official.js', 'cordis.patch.yml', 'resources/templates/catalog.json', 'resources/primary-runtime/dependencies/python/python.exe']) await requireFile(path.join(office, file))
  for (const file of ['lib/web-index.js', 'lib/client.js', 'cordis.patch.yml', 'vendor/dsh-ppt/lib/index.js']) await requireFile(path.join(ppt, file))
  for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml']) await requireFile(path.join(profile, file))
  const profileManifest = JSON.parse(await fs.readFile(path.join(profile, 'package.json'), 'utf8'))
  const bundles = profileManifest.dsh?.profile?.bundles
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui', 'dsh-desktop-office', 'dsh-ppt-composer']) if (!Array.isArray(bundles) || !bundles.includes(name)) throw new Error('Missing profile bundle: ' + name)
  for (const name of ['dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui', 'dsh-desktop-office', 'dsh-ppt-composer']) if (Object.hasOwn(profileManifest.dependencies ?? {}, name)) throw new Error('Bundled plugin must not be a profile dependency: ' + name)
  await requireFile(node)
  await requireFile(path.join(modules, '@deepseek-ai/dsh/lib/bin.js'))
  // mkdir is exclusive: partial output remains for inspection after failure, never overwritten.
  await fs.mkdir(target)
  await fs.cp(modules, path.join(target, 'node_modules'), { recursive: true, filter: p => ![path.join(modules, 'dsh-desktop-office'), path.join(modules, 'dsh-ppt-composer')].includes(p) })
  await applyWebPluginManagerPatch(path.join(target, 'node_modules'))
  const sidebar = path.join(target, 'node_modules/@deepseek-ai/dsh-client-ui-sidebar')
  const sidebarManifest = await manifest(sidebar, '@deepseek-ai/dsh-client-ui-sidebar')
  if (sidebarManifest.version !== '0.2.2-alpha.3') throw new Error('Unsupported Web sidebar version: ' + sidebarManifest.version)
  const sidebarClient = path.join(sidebar, 'lib/client.js')
  await fs.writeFile(sidebarClient, addWebSidebarSwitcher(await fs.readFile(sidebarClient, 'utf8')))
  await fs.cp(office, path.join(target, 'node_modules/dsh-desktop-office'), { recursive: true })
  await fs.cp(ppt, path.join(target, 'node_modules/dsh-ppt-composer'), { recursive: true })
  await fs.mkdir(path.join(target, 'node'))
  await fs.copyFile(node, path.join(target, 'node/node.exe'))
  await fs.mkdir(path.join(target, 'profile'))
  // Never copy unrecognized Profile files such as credentials or session data.
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml']) await fs.copyFile(path.join(profile, name), path.join(target, 'profile', name))
  const launcherRoot = new URL('../build/web-runtime/', import.meta.url)
  for (const name of ['dsh-offline.mjs', 'dsh-offline.cmd', 'system-proxy.mjs', 'start.sh']) await fs.copyFile(new URL(name, launcherRoot), path.join(target, name))
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [modules, node, office, ppt, profile, output] = process.argv.slice(2)
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node.split('.')[0] !== '24') throw new Error('Build requires Windows x64 and Node 24')
  console.log('UNVERIFIED staging only; do not publish without Windows runtime and closure validation.')
  console.log(await stageWindowsWebRuntime({ modules, node, office, ppt, profile, output }))
}
