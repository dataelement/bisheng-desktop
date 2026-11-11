import * as fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

export function runBundled(node, args, root) {
  const result = spawnSync(node, args, { cwd: root, encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, DSH_HOME: path.join(root, 'data'), DSH_WEB_RUNTIME: '1', DSH_TELEMETRY_DISABLED: '1' },
    maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Bundled Node probe failed (exit ' + result.status + ')', { cause: result.error })
  return result.stdout
}

export function registeredBootstrap(source) {
  const registrations = []
  runInNewContext(source, { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } }, { timeout: 10_000 })
  return registrations.some(registration => registration?.id === '@deepseek-ai/dsh-client-modules')
}

async function stopTree(child, closed) {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      const stopped = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { encoding: 'utf8', timeout: 15_000 })
      if (stopped.status !== 0 && child.exitCode === null && child.signalCode === null) throw new Error('Could not stop isolated Windows runtime process tree')
    } else child.kill('SIGTERM')
  }
  await Promise.race([closed, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Runtime process tree did not exit')), 15_000)
    timer.unref()
  })])
}

export async function verifyWebPortable(root) {
  const node = path.join(root, 'node', 'node.exe')
  // --version initializes a real isolated Profile using the shipped launcher.
  runBundled(node, [path.join(root, 'dsh-offline.mjs'), '--version'], root)
  const profile = path.join(root, 'data', 'profiles', 'web')
  const probe = path.join(root, 'ci-import-probe.mjs')
  await fs.writeFile(probe, `const root = new URL('./', import.meta.url);
for (const name of ['dsh-desktop-office', 'dsh-ppt-composer', 'dsh-desktop-enterprise', 'dsh-desktop-workbenches', 'dsh-desktop-client-ui']) {
  const resolved = import.meta.resolve(name);
  if (!resolved.startsWith(root.href)) throw new Error('Import escaped portable tree: ' + name);
  await import(resolved);
}`)
  runBundled(node, [probe], root)
  await fs.unlink(probe)
  const child = spawn(node, [path.join(root, 'dsh-offline.mjs'), '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: root, env: { ...process.env, DSH_HOME: path.join(root, 'data'), DSH_WEB_RUNTIME: '1',
      DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  const closed = new Promise(resolve => child.once('close', resolve))
  let text = ''
  let failure
  child.on('error', error => { failure = error })
  const append = bytes => { text = (text + bytes.toString()).slice(-128_000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  try {
    const deadline = Date.now() + 120_000
    let url
    while (Date.now() < deadline && child.exitCode === null && !failure) {
      const match = /dsh web:\s*(https?:\/\/\S+)/u.exec(text)
      if (match) { url = new URL(match[1]); break }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!url || !url.searchParams.get('token')) throw new Error('Offline launcher did not provide an authenticated ready URL')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Runtime readiness URL is not loopback')
    const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    if (!cookie) throw new Error('Offline runtime token exchange failed')
    const response = await fetch(new URL('/', url), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Authenticated HTML response failed')
    const html = await response.text()
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)].map(match => match[1])
    const bootstrap = scripts.find(src => src.includes('@deepseek-ai/dsh-client-modules/client.js'))
    if (!bootstrap) throw new Error('HTML does not reference the module bootstrap')
    const scriptUrl = new URL(bootstrap, url)
    if (scriptUrl.origin !== url.origin) throw new Error('Bootstrap escaped local runtime')
    const script = await fetch(scriptUrl, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) })
    if (!script.ok || !registeredBootstrap(await script.text())) throw new Error('Bootstrap did not execute its module registration')
    // Confirm all bundled Profile declarations survived launcher initialization.
    const manifest = JSON.parse(await fs.readFile(path.join(profile, 'package.json'), 'utf8'))
    if (JSON.stringify(manifest.dsh?.profile?.bundles) !== JSON.stringify(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])) throw new Error('Unexpected initialized core bundle composition')
    const patch = await fs.readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')
    for (const name of ['dsh-desktop-office', 'dsh-ppt-composer']) if (!patch.includes('name: ' + name) && !patch.includes("name: '" + name + "'")) throw new Error('Missing initialized product plugin: ' + name)
    return { platform: 'win32', arch: 'x64', archiveExtracted: true, unicodeSpacePath: true,
      pluginImports: true, offlineLauncher: true, authenticatedHtml: true, bootstrapRegistration: true,
      browserUiAcceptance: false, modelRequestAcceptance: false }
  } finally {
    await stopTree(child, closed)
  }
}
