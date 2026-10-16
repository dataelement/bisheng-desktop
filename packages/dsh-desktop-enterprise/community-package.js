import { gunzipSync } from 'node:zlib'
import { Parser } from 'tar'
import semver from 'semver'
import { evaluatePluginCompatibility, reportPluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { readBundleZip, safePath, sha256, MAX_ARCHIVE } from './offline-bundle.js'

const MAX_EXPANDED = 1024 * 1024 * 1024
const fail = message => { throw new Error(message) }

/** Select the package's public ESM entry using npm export conditions. */
export function packageEntry(pkg) {
  let entry = pkg.exports
  if (entry && typeof entry === 'object' && Object.hasOwn(entry, '.')) entry = entry['.']
  while (entry && typeof entry === 'object' && !Array.isArray(entry)) entry = entry.import ?? entry.node ?? entry.default ?? entry.require
  return typeof entry === 'string' ? entry : pkg.main || 'index.js'
}

/** Inspect npm archives before package installation, including every archive path. */
export async function readCommunityPackage(bytes, expected, target) {
  if (bytes.length > MAX_ARCHIVE) fail('Plugin archive exceeds 512 MiB.')
  if (sha256(bytes) !== expected.digest) fail('Plugin artifact checksum mismatch.')
  let files
  if (bytes.subarray(0, 2).toString() === 'PK') files = readBundleZip(bytes)
  else {
    const tar = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED + 50000 * 1024 })
    files = new Map()
    const folded = new Set()
    let expanded = 0
    await new Promise((resolve, reject) => {
      const parser = new Parser({ strict: true, maxMetaEntrySize: 1024 * 1024 })
      parser.on('error', reject)
      parser.on('end', resolve)
      parser.on('entry', entry => {
        try {
          const path = entry.path.replace(/\/$/u, '')
          if (!safePath(path) || folded.has(path.toLowerCase()) || !['File', 'Directory', 'OldFile'].includes(entry.type)) fail('Unsafe archive entry.')
          folded.add(path.toLowerCase())
          expanded += entry.size
          if (folded.size > 50000 || expanded > MAX_EXPANDED) fail('Expanded plugin archive exceeds limit.')
          const chunks = []
          entry.on('data', chunk => chunks.push(chunk))
          entry.on('end', () => {
            if (entry.type !== 'Directory') files.set(path, { data: Buffer.concat(chunks), executable: Boolean(entry.mode & 0o111) })
          })
          entry.resume()
        } catch (error) { entry.resume(); parser.abort(error); reject(error) }
      })
      parser.end(tar)
    })
  }
  const roots = [...files.keys()].filter(path => path === 'package.json' || /^[^/]+\/package\.json$/u.test(path))
  if (roots.length !== 1) fail('Archive must contain one plugin package.json.')
  const prefix = roots[0].slice(0, -'package.json'.length)
  if ([...files.keys()].some(path => !path.startsWith(prefix))) fail('Files must belong to the plugin package.')
  const metadata = files.get(roots[0]).data
  if (metadata.length > 1024 * 1024) fail('Package metadata exceeds 1 MiB.')
  const pkg = JSON.parse(metadata.toString('utf8'))
  if (pkg?.name !== expected.name || pkg.version !== expected.version || !semver.valid(pkg.version) ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(pkg.name) ||
      pkg.name.startsWith('@deepseek-ai/') || pkg.name.startsWith('dsh-desktop-') || pkg.name === 'dshmarket') fail('Invalid plugin package identity.')
  const [platform, architecture] = target.split('-')
  for (const [key, actual] of [['os', platform], ['cpu', architecture]]) {
    const values = pkg[key] ?? []
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) fail(`Invalid package ${key}.`)
    const positive = values.filter(value => !value.startsWith('!'))
    if (values.includes(`!${actual}`) || (positive.length && !positive.includes(actual) && !positive.includes('any'))) fail('Plugin does not support this platform.')
  }
  if (pkg.engines?.node && !semver.satisfies(process.versions.node, pkg.engines.node, { includePrerelease: true })) fail('Plugin requires a different Node runtime version.')
  const compatibility = evaluatePluginCompatibility(pkg)
  if (compatibility) reportPluginCompatibility(compatibility)
  const declaration = pkg.dsh?.bundle?.patch
  const entries = declaration === undefined ? [packageEntry(pkg)] : Array.isArray(declaration) ? declaration : [declaration]
  if (!entries.length) fail('Missing plugin entry.')
  for (const entry of entries) {
    const path = typeof entry === 'string' ? entry.replace(/^\.\//u, '') : ''
    if (!safePath(path) || !files.has(prefix + path)) fail('Plugin entry is missing or unsafe.')
  }
  const normalized = new Map([...files].map(([path, file]) => [path.slice(prefix.length), file]))
  return { pkg, files: normalized, manifest: { schema_version: 2, format: 'npm',
    plugin: { name: pkg.name, version: pkg.version, display_name: pkg.displayName || pkg.name,
      description: pkg.description || '', publisher: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || '',
      license: pkg.license || '', desktop_min: '', permissions: [], services: [] }, targets: { [target]: {} } } }
}
