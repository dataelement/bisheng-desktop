import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Private CI inventory. Names come from the same builder input used for packaging.
export function desktopArtifacts(config, { platform, arch, channel }) {
  if (!['release', 'development'].includes(channel) || !['mac', 'win'].includes(platform) ||
      !['arm64', 'x64'].includes(arch) || (platform === 'win' && arch !== 'x64')) {
    throw new Error('Unsupported desktop channel, platform or native architecture')
  }
  const directory = config.directories?.output
  const product = config.productName
  const portable = value => typeof value === 'string' && value.length > 0 &&
    !/[\\\r\n:]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.')
  if (!portable(directory) || !portable(product) || product.includes('/')) throw new Error('Unsafe builder output or product name')
  function expand(pattern, ext) {
    if (typeof pattern !== 'string') throw new Error('Missing explicit builder artifactName')
    const filename = pattern.replaceAll('${os}', platform).replaceAll('${arch}', arch).replaceAll('${ext}', ext)
    if (!portable(filename) || filename.includes('/') || filename.includes('${')) throw new Error('Unsupported builder artifactName')
    return posix.join(directory, filename)
  }
  if (platform === 'mac') {
    const app = posix.join(directory, arch === 'arm64' ? 'mac-arm64' : 'mac', product + '.app')
    const zip = expand(config.artifactName, 'zip')
    return {
      app, payload: posix.join(app, 'Contents/Resources/app.asar'),
      assets: [expand(config.artifactName, 'dmg'), zip, zip + '.blockmap',
        ...(channel === 'release' ? [posix.join(directory, 'latest-mac-' + arch + '.yml')] : [])]
    }
  }
  const app = posix.join(directory, 'win-unpacked', product + '.exe')
  const installer = expand(config.nsis?.artifactName, 'exe')
  return {
    app, payload: posix.join(directory, 'win-unpacked/resources/app.asar'),
    assets: [installer, installer + '.blockmap', ...(channel === 'release' ? [posix.join(directory, 'latest.yml')] : [])]
  }
}

export async function verifyDesktopArtifacts(root, inventory) {
  for (const filename of [inventory.app, inventory.payload, ...inventory.assets]) {
    const info = await stat(resolve(root, filename))
    const isAppDirectory = filename === inventory.app && filename.endsWith('.app')
    if (isAppDirectory ? !info.isDirectory() : !info.isFile() || info.size === 0) {
      throw new Error('Missing or empty desktop build output: ' + filename)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [channel, platform, arch, ...extra] = process.argv.slice(2)
  if (extra.length) throw new Error('Usage: desktop-artifacts.mjs <release|development> <mac|win> <arm64|x64>')
  const root = resolve(import.meta.dirname, '../..')
  const config = channel === 'development' ? require('../../electron-builder.dev.cjs') : require('../../package.json').build
  const inventory = desktopArtifacts(config, { channel, platform, arch })
  await verifyDesktopArtifacts(root, inventory)
  console.log(JSON.stringify(inventory, null, 2))
}
