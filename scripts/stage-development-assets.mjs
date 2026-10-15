import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLATFORM_FILES = {
  arm64: ['bisheng-dev-mac-arm64.dmg', 'bisheng-dev-mac-arm64.zip'],
  x64: ['bisheng-dev-mac-x64.dmg', 'bisheng-dev-mac-x64.zip'],
  windows: ['bisheng-dev-windows-x64-setup.exe']
}

export async function developmentAssets(directory, platform) {
  const required = PLATFORM_FILES[platform]
  assert(required, `Unknown development platform: ${platform}`)
  const files = []
  for (const name of required) {
    const file = path.join(directory, name)
    const info = await stat(file)
    assert(info.isFile() && info.size > 0, `Missing or empty development installer: ${name}`)
    files.push(file)
  }
  // Development builds disable publishing, so electron-builder may omit updater metadata.
  const optional = platform === 'windows'
    ? ['bisheng-dev-windows-x64-setup.exe.blockmap', 'latest.yml']
    : [`bisheng-dev-mac-${platform}.zip.blockmap`]
  for (const name of optional) {
    const file = path.join(directory, name)
    try {
      const info = await stat(file)
      assert(info.isFile() && info.size > 0, `Invalid development metadata: ${name}`)
      files.push(file)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return files
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [platform, directory = 'dist-dev'] = process.argv.slice(2)
  assert(process.env.DEV_RELEASE_TAG && process.env.GITHUB_REPOSITORY, 'Draft tag and repository are required')
  const files = await developmentAssets(directory, platform)
  execFileSync('gh', [
    'release', 'upload', process.env.DEV_RELEASE_TAG, ...files,
    '--clobber', '--repo', process.env.GITHUB_REPOSITORY
  ], { stdio: 'inherit' })
}
