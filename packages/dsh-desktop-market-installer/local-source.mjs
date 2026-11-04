import { isAbsolute } from 'node:path'

/** Absolute path carried by a local directory or local tarball spec. Remote URLs are not absolute paths. */
export function localSourcePath(spec) {
  if (typeof spec !== 'string') return undefined
  const stripped = spec.trim().replace(/^(?:file|link):/u, '')
  return isAbsolute(stripped) ? stripped : undefined
}

/** A package-manager request whose bytes already live on this machine. */
export function isLocalPluginRequest(request) {
  if (request === null || typeof request !== 'object') return false
  if (request.kind === 'path') return localSourcePath(request.path) !== undefined
  if (request.kind === 'tarball') {
    // The backend passes spec, not path, to pnpm for archives. Do not grant
    // the local exception to a different or remote installation target.
    if (request.host !== undefined || typeof request.path !== 'string' || !isAbsolute(request.path)) return false
    return request.spec === request.path || request.spec === `file:${request.path}` || request.spec === `link:${request.path}`
  }
  return false
}

