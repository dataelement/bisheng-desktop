import { isAbsolute } from 'node:path'
import { valid as validVersion } from 'semver'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

class EnterpriseWorkbenchInstallError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

/**
 * The verified artifact stays server-side until the Manager finishes using it.
 * @param {import('@deepseek-ai/dsh-plugin-manager').PluginManager} manager
 * @param {{ open(id: string): Promise<{ path: string, packageName: string, version: string, release(): Promise<unknown> | void }> }} packages
 * @param {string} id Enterprise catalog identity, never an npm spec or local path.
 */
export async function installEnterpriseWorkbench(manager, packages, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/u.test(id)) throw new EnterpriseWorkbenchInstallError('An enterprise workbench is required.')
  // A backend capability alone cannot prove that the Manager forwards or enforces identity.
  if (manager?.verifiedInstallContract !== 1) throw new EnterpriseWorkbenchInstallError('Plugin Manager does not support verified enterprise installs.', 503)
  const opened = await packages.open(id)
  try {
    if (!opened || typeof opened.path !== 'string' || !isAbsolute(opened.path) ||
        opened.path.includes('\0') || typeof opened.release !== 'function' ||
        typeof opened.packageName !== 'string' || opened.packageName.length > 214 || !PACKAGE_NAME.test(opened.packageName) ||
        typeof opened.version !== 'string' || opened.version !== opened.version.trim() || !/^[0-9]/u.test(opened.version) || validVersion(opened.version) === null) {
      throw new EnterpriseWorkbenchInstallError('The enterprise workbench package could not be prepared.')
    }
    const installed = (await manager.listBundles()).some(bundle => bundle.name === opened.packageName && bundle.installed)
    const result = workbenchInstallOutcome(await manager.installBundle(opened.path, {
      enabled: true, expectedName: opened.packageName, expectedVersion: opened.version, replace: installed
    }), installed)
    if (!result || !['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(result.application)) {
      throw new EnterpriseWorkbenchInstallError('Plugin Manager returned no lifecycle outcome.', 502)
    }
    const failed = !['applied', 'restart-required'].includes(result.application)
    if (!failed && (result.bundle !== opened.packageName || result.stage !== 'enable' || result.version !== opened.version)) {
      throw new EnterpriseWorkbenchInstallError('Plugin Manager returned an unexpected installation outcome.', 502)
    }
    return {
      status: failed ? 409 : 200,
      body: {
        result, application: result.application,
        restartRequired: result.application === 'restart-required',
        ...(result.restartReason ? { restartReason: result.restartReason } : {}),
        ...(!failed && result.bundle === opened.packageName && result.stage === 'enable' ? {
          install: { id, pluginName: opened.packageName, version: opened.version, source: 'enterprise', installedAt: new Date().toISOString() }
        } : {}),
        ...(failed ? { error: result.error?.diagnostic || result.error?.message || result.error?.code || 'Plugin operation did not complete.' } : {})
      }
    }
  } finally { if (typeof opened?.release === 'function') await opened.release() }
}

/**
 * A replacement publishes new files, but Harness may retain the old server module
 * even when its general reload reports applied. Require a process restart so the
 * workbench never advertises unverified hot-upgrade success. Fresh installs can
 * still become available immediately through the normal activation path.
 * @param {import('@deepseek-ai/dsh-plugin-manager').ChangeResult | undefined} result
 * @param {boolean} replacement
 */
export function workbenchInstallOutcome(result, replacement) {
  if (replacement === true && result?.application === 'applied') {
    return { ...result, application: 'restart-required', restartReason: 'package-moved' }
  }
  return result
}

/** Register one compatibility route; service revocation immediately closes new installs. */
export function applyEnterpriseWorkbenchInstall(ctx) {
  let services
  ctx.inject(['pluginManager', 'enterpriseWorkbenchPackages'], scoped => {
    const current = { manager: scoped.pluginManager, packages: scoped.enterpriseWorkbenchPackages }
    services = current
    return () => { if (services === current) services = undefined }
  })
  ctx.connection.fetch.register({
    path: '/api/desktop-workbenches/enterprise-install', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const current = services
        if (!current) throw new EnterpriseWorkbenchInstallError('The verified enterprise package service is unavailable.', 503)
        const payload = await readInstallRequest(request)
        if (services !== current) throw new EnterpriseWorkbenchInstallError('The verified enterprise package service is unavailable.', 503)
        const result = await installEnterpriseWorkbench(current.manager, current.packages, payload.id)
        return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500
        return Response.json({ error: error instanceof Error ? error.message : 'Enterprise workbench installation failed.' }, { status, headers: { 'cache-control': 'no-store' } })
      }
    }
  })
}

async function readInstallRequest(request) {
  const maximum = 4096
  if (Number(request.headers.get('content-length')) > maximum) throw new EnterpriseWorkbenchInstallError('Request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new EnterpriseWorkbenchInstallError('A JSON body is required.')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > maximum) { await reader.cancel(); throw new EnterpriseWorkbenchInstallError('Request is too large.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new EnterpriseWorkbenchInstallError('Invalid JSON body.') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'id')) throw new EnterpriseWorkbenchInstallError('Only an enterprise workbench catalog ID is accepted.')
  return payload
}
