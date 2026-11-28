const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
/** Browser operations are bounded and cannot invoke cloud development tools. */
export function parseCloudBrowse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud request.')
  if (input.operation === 'state' && Object.keys(input).length === 1) return { operation: 'state' }
  if (input.operation === 'list' && Object.keys(input).every(key => ['operation', 'cursor'].includes(key)) && (input.cursor === undefined || validId(input.cursor))) return { operation: 'list', ...(input.cursor ? { cursor: input.cursor } : {}) }
  if (input.operation === 'launch' && Object.keys(input).every(key => ['operation', 'appId'].includes(key)) && validId(input.appId)) return { operation: 'launch', appId: input.appId }
  const fields = { add: ['operation', 'appId'], remove: ['operation', 'appId'], activate: ['operation', 'appId'], note: ['operation', 'appId', 'note'], bind: ['operation', 'appId', 'sessionId'] }
  if (Object.hasOwn(fields, input.operation) && validId(input.appId) && Object.keys(input).every(key => fields[input.operation].includes(key))) {
    if (input.operation === 'note' && (typeof input.note !== 'string' || input.note.length > 200000)) throw new Error('Invalid cloud note.')
    if (input.operation === 'bind' && (typeof input.sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(input.sessionId) || ['__proto__', 'prototype', 'constructor'].includes(input.sessionId))) throw new Error('Invalid session identity.')
    return { ...input }
  }
  throw new Error('Unsupported cloud browsing operation.')
}
export function applyCloudBrowse(ctx, account, call) {
  ctx.connection.fetch.register({ path: '/api/enterprise.workbenches/cloud', methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    try {
      const text = await request.text()
      if (text.length > 256 * 1024) return Response.json({ error: 'Cloud request is too large.' }, { status: 413 })
      const input = parseCloudBrowse(JSON.parse(text))
      await account.refreshState?.()
      const before = account.state()
      if (!before.connected || !before.connectionKey) return Response.json({ error: 'Sign in first.' }, { status: 401 })
      const result = await call(input, before)
      if (account.state().connectionKey !== before.connectionKey || !account.state().connected) return Response.json({ error: 'Enterprise account changed.' }, { status: 409 })
      return Response.json(result, { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      return Response.json({ error: error.message }, { status: [400, 401, 404, 409, 500].includes(error.status) ? error.status : 400, headers: { 'cache-control': 'no-store' } })
    }
  } })
}
export function cloudLaunch(payload, base, appId, connectionKey) {
  if (!payload || typeof payload.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.slug) || typeof payload.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.ticket) || payload.launch_path !== `/apps/${payload.slug}/_desktop` || payload.entry_path !== `/apps/${payload.slug}/`) throw new Error('Invalid hosted application entry.')
  return { appId, slug: payload.slug, ticket: payload.ticket, launchUrl: `${base.replace(/\/$/, '')}${payload.launch_path}`, entryUrl: `${base.replace(/\/$/, '')}${payload.entry_path}`, connectionKey }
}
