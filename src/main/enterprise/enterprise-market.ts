const MAX_WORKBENCH_ACCESS_IDS = 500

function isWorkbenchAccessBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const value = body as Record<string, unknown>
  const ids = value.workbench_ids
  return Object.keys(value).length === 1 && Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_WORKBENCH_ACCESS_IDS &&
    ids.every(id => typeof id === 'string' && /^[a-f0-9]{32}$/u.test(id))
}

/** Only enterprise catalog operations cross the credential boundary. */
export function parseMarketRequest(input: unknown): { path: string, connectionKey: string, body?: unknown, binary: boolean } {
  const invalid = () => Object.assign(new Error('Unsupported enterprise market request.'), { status: 400 })
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid()
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !['path', 'body', 'connectionKey'].includes(key)) ||
      typeof value.path !== 'string' || typeof value.connectionKey !== 'string' || !value.connectionKey) throw invalid()
  const path = value.path
  const url = new URL(path, 'https://market.invalid')
  if (url.origin !== 'https://market.invalid' || url.hash || path !== url.pathname + url.search) throw invalid()
  const prefix = '/api/v1/dsh/market/'
  const endpoint = url.pathname.slice(prefix.length)
  if (!url.pathname.startsWith(prefix)) throw invalid()
  const pluginArtifact = /^plugins\/[a-f0-9]{32}\/versions\/[a-f0-9]{32}\/artifact$/u.test(endpoint)
  const workbenchList = endpoint === 'workbenches'
  const workbenchDetail = /^workbenches\/[a-f0-9]{32}$/u.test(endpoint)
  const workbenchArtifact = /^workbenches\/[a-f0-9]{32}\/versions\/[a-f0-9]{32}\/artifact$/u.test(endpoint)
  // F022: whether installed enterprise workbenches are still visible to the account.
  const workbenchAccess = endpoint === 'workbenches/access'
  const binary = pluginArtifact || workbenchArtifact
  if (!binary && !workbenchList && !workbenchDetail && !workbenchAccess && !['capabilities', 'catalog', 'sync'].includes(endpoint)) throw invalid()
  if (endpoint === 'catalog') {
    if ([...url.searchParams.keys()].some(key => !['q', 'page', 'size'].includes(key))) throw invalid()
  } else if (workbenchList) {
    if ([...url.searchParams.keys()].some(key => !['page', 'size'].includes(key))) throw invalid()
  } else if (url.search) throw invalid()
  if ((endpoint === 'sync' || workbenchAccess) !== (value.body !== undefined)) throw invalid()
  if (workbenchAccess && !isWorkbenchAccessBody(value.body)) throw invalid()
  if ((workbenchList || workbenchDetail || workbenchArtifact) && value.body !== undefined) throw invalid()
  return { path, connectionKey: value.connectionKey, ...(value.body === undefined ? {} : { body: value.body }), binary }
}
