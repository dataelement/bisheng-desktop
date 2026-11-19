const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')

/**
 * electron-builder writes resources/app-update.yml only for an NSIS target.
 * The Windows release builds --dir first, then seals that directory with
 * --prepackaged, so neither step creates the file electron-updater reads.
 * afterPack still runs for --dir and the later installer packs the result as-is.
 */
function genericPublish(publish) {
  if (publish == null) return null
  const entry = Array.isArray(publish) ? publish[0] : publish
  if (!entry || entry.provider !== 'generic' || typeof entry.url !== 'string' || entry.url.length === 0) {
    throw new Error('Windows app-update.yml requires the first publish provider to be generic with a url')
  }
  return entry
}

function publisherNames(value) {
  const names = typeof value === 'string' ? [value] : value
  if (!Array.isArray(names) || names.length === 0 || names.some(name => typeof name !== 'string' || name.length === 0)) {
    throw new Error('Windows app-update.yml requires win.signtoolOptions.publisherName')
  }
  return names
}

function renderWindowsAppUpdateYaml({ url, publisherName, updaterCacheDirName }) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Windows app-update.yml requires a generic publish url')
  }
  if (typeof updaterCacheDirName !== 'string' || updaterCacheDirName.length === 0) {
    throw new Error('Windows app-update.yml requires updaterCacheDirName')
  }
  const lines = [
    'provider: generic',
    `url: ${JSON.stringify(url)}`,
    `updaterCacheDirName: ${JSON.stringify(updaterCacheDirName)}`,
    'publisherName:'
  ]
  for (const name of publisherNames(publisherName)) lines.push(`  - ${JSON.stringify(name)}`)
  return `${lines.join('\n')}\n`
}

async function writeWindowsAppUpdateConfig(context) {
  if (context.electronPlatformName !== 'win32') return null
  const publish = genericPublish(context.packager?.config?.publish)
  if (publish == null) return null
  const yaml = renderWindowsAppUpdateYaml({
    url: publish.url,
    publisherName: context.packager.config.win?.signtoolOptions?.publisherName,
    updaterCacheDirName: context.packager.appInfo?.updaterCacheDirName
  })
  const resourcesDir = path.join(context.appOutDir, 'resources')
  await mkdir(resourcesDir, { recursive: true })
  const file = path.join(resourcesDir, 'app-update.yml')
  await writeFile(file, yaml)
  return file
}

module.exports = { renderWindowsAppUpdateYaml, writeWindowsAppUpdateConfig }
