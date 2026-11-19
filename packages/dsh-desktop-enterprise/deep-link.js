export const ENTERPRISE_LOGIN_PROTOCOL = 'bisheng'
export const ENTERPRISE_LOGIN_DEV_PROTOCOL = 'bisheng-dev'

function isEnterpriseLoginProtocol(protocol) {
  return protocol === `${ENTERPRISE_LOGIN_PROTOCOL}:` || protocol === `${ENTERPRISE_LOGIN_DEV_PROTOCOL}:`
}

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

// Keep the legacy API name for broker/client compatibility. It now covers all
// non-loopback HTTP origins, including public IPs and domain names.
export function isInsecurePrivateHttpOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}

export function normalizeEnterpriseServerUrl(value, options = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('The BiSheng platform address is not a valid URL.')
  }
  if (url.username || url.password) {
    throw new Error('The BiSheng platform address cannot contain credentials.')
  }
  if (url.search || url.hash) {
    throw new Error('The BiSheng platform address must not contain a query or fragment.')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('The BiSheng platform address must be an origin without a path.')
  }
  if (url.protocol === 'https:') {
    return url.origin
  }
  if (url.protocol === 'http:') {
    if (isLoopbackHost(url.hostname) || options.allowInsecurePrivateHttp === true) {
      return url.origin
    }
    throw new Error('HTTP addresses require explicit confirmation.')
  }
  throw new Error('The BiSheng platform address must use HTTP or HTTPS.')
}

export function parseEnterpriseLoginDeepLink(value, options = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('The enterprise login link is not a valid URL.')
  }
  if (
    !isEnterpriseLoginProtocol(url.protocol) ||
    url.hostname !== 'login' ||
    url.pathname !== '' ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('The enterprise login link has an unsupported destination.')
  }
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0][0] !== 'server') {
    throw new Error('The enterprise login link must contain only one server parameter.')
  }
  const serverUrl = normalizeEnterpriseServerUrl(entries[0][1], options)
  const canonical = new URL(`${url.protocol}//login`)
  canonical.searchParams.set('server', serverUrl)
  return { url: canonical.toString(), serverUrl }
}

export function enterpriseLoginDeepLinkFromArgv(argv, options = {}) {
  for (const argument of argv) {
    const lower = argument.toLowerCase()
    if (
      !lower.startsWith(`${ENTERPRISE_LOGIN_PROTOCOL}://`) &&
      !lower.startsWith(`${ENTERPRISE_LOGIN_DEV_PROTOCOL}://`)
    ) continue
    try {
      return parseEnterpriseLoginDeepLink(argument, options)
    } catch {
      continue
    }
  }
  return undefined
}
