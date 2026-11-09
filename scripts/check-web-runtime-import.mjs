import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Resolve from the actual profile, then import the plugin in a child process.
// Import executes plugin code and may have side effects; use only a trusted, isolated runtime.
// Inspect the resolved path: ancestor node_modules can mask an incomplete package.
export function checkProfileImport({ node = process.execPath, profile, specifier }) {
  const probe = `const [anchor, name] = process.argv.slice(1);
const resolved = import.meta.resolve(name, anchor);
console.log("Resolved: " + resolved);
await import(resolved);`
  // Node's --experimental-import-meta-resolve makes the parent anchor explicit.
  const anchor = pathToFileURL(join(resolve(profile), 'package.json')).href
  return spawnSync(node, ['--experimental-import-meta-resolve', '--input-type=module', '-e', probe, anchor, specifier], { encoding: 'utf8' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profile, specifier] = process.argv.slice(2)
  if (!profile || !specifier) {
    console.error('Usage: node check-web-runtime-import.mjs <profile-dir> <plugin-package>')
    process.exitCode = 2
  } else {
    const result = checkProfileImport({ profile, specifier })
    if (result.error) console.error(result.error.message)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.status !== 0) {
      console.error(`Profile import failed: ${specifier} (profile: ${resolve(profile)})`)
      process.exitCode = 1
    } else console.log(`Profile import succeeded: ${specifier}`)
  }
}
