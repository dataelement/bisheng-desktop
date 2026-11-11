import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkWebHarnessVersion, WEB_HARNESS_VERSION } from './web-runtime-version.mjs'

/** Verify the already-replayed host contract; never modify an installed SDK. */
export async function assertWebPluginManagerContract(modules) {
  await checkWebHarnessVersion(modules)
  const directory = path.join(modules, '@deepseek-ai/dsh-plugin-manager')
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-plugin-manager' || manifest.version !== WEB_HARNESS_VERSION) throw new Error('Unsupported Plugin Manager package')
  const { PluginManager } = await import(pathToFileURL(path.join(directory, 'lib/index.js')).href)
  if (PluginManager?.prototype?.verifiedInstallContract !== 1 || PluginManager?.prototype?.managedBundleSourceContract !== 1) throw new Error('Missing replayed Plugin Manager contracts')
  return { version: manifest.version, changed: false }
}
