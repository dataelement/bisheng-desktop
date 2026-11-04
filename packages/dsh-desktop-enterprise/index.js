import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { CONTENT_SAFETY_ERROR_COPY } from './error-copy.js'
import { createContentSafetyLocaleScope } from './content-safety-locale.js'
import { applyEnterpriseSkills } from './work-skills.js'
import { applyWorkResources } from './work-resources.js'
import { applyWorkCapabilities } from './work-capabilities.js'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { applyEnterpriseMarket } from './market.js'
import { applyEnterpriseWorkbenchMarket } from './workbench-market.js'
import { applyEnterpriseAuth, createEnterpriseAuthTransport } from './enterprise-auth.js'
import {
  API_PATHS,
  CLIENT_ID,
  accessNeedsRefresh,
  createPkceTransaction,
  parseAuthorization,
  parseConfig,
  parseModelsLenient,
  parseThirdPartyPolicy,
  parseToken,
  parseUsageLenient,
  unavailableUsage
} from './contract.js'
import { createAuditTitleSync } from './audit-title.js'
import {
  isInsecurePrivateHttpOrigin,
  normalizeEnterpriseServerUrl,
  parseEnterpriseLoginDeepLink
} from './deep-link.js'
import { EnterpriseLlmAdapter, pickAttributionHeaders } from './openai.js'

export { EnterpriseAuthError } from './enterprise-auth.js'

export const name = 'dsh-desktop-enterprise'
export const inject = ['connection', 'llm', 'loader']
export const BISHENG_PROVIDER_ROUTE = 'bisheng-enterprise'

const LOCAL_PATHS = Object.freeze({
  state: '/api/enterprise.state',
  inspectBase: '/api/enterprise.base.inspect',
  start: '/api/enterprise.login.start',
  manual: '/api/enterprise.login.manual',
  inspectDeepLink: '/api/enterprise.deep-link.inspect',
  confirmDeepLink: '/api/enterprise.deep-link.confirm',
  refresh: '/api/enterprise.refresh',
  refreshModels: '/api/enterprise.models.refresh',
  logout: '/api/enterprise.logout',
  chatHistory: '/api/enterprise.chat.history',
  chatDelete: '/api/enterprise.chat.delete'
})

const MAX_JSON_BYTES = 64 * 1024

function disabledState(error) {
  return {
    connected: false,
    secureStorageAvailable: true,
    storageMode: 'session',
    phase: 'idle',
    revision: 0,
    models: [],
    modelsAvailable: false,
    ...(error ? { error } : {})
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function allowInsecureLoopback() {
  return process.env.DSH_DESKTOP_ENTERPRISE_ALLOW_INSECURE_LOOPBACK === '1'
}

function inspectUrlOptions() {
  return {
    allowInsecureLoopback: allowInsecureLoopback(),
    allowInsecurePrivateHttp: true
  }
}

function inspectedBase(base) {
  return {
    base,
    ...(isInsecurePrivateHttpOrigin(base) ? { insecurePrivateHttp: true } : {})
  }
}

function parseBrokerOrigin(urlValue, capability) {
  if (!urlValue || !capability) return undefined
  let url
  try {
    url = new URL(urlValue)
  } catch {
    console.warn('[enterprise] broker URL is invalid')
    return undefined
  }
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    console.warn('[enterprise] broker URL must be an HTTP loopback origin without credentials, query or hash')
    return undefined
  }
  return { origin: url.origin, capability }
}

function brokerConfig(ctx, config) {
  const injected = (typeof ctx?.get === 'function' ? ctx.get('enterpriseBroker') : ctx?.enterpriseBroker) ?? config?.broker
  if (injected && typeof injected === 'object') {
    const resolved = parseBrokerOrigin(injected.origin ?? injected.url, injected.capability)
    if (resolved) return resolved
  }
  const urlValue = process.env.DSH_DESKTOP_ENTERPRISE_BROKER_URL
  const capability = process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY
  // Consume the owner secret before any market plugin is imported. This is not a Node sandbox.
  delete process.env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY
  if (!urlValue || !capability) {
    console.warn('[enterprise] broker configuration missing', { urlConfigured: Boolean(urlValue), capabilityConfigured: Boolean(capability) })
    return undefined
  }
  return parseBrokerOrigin(urlValue, capability)
}

export function provideEnterpriseBroker(ctx, broker) {
  const resolved = parseBrokerOrigin(broker?.origin ?? broker?.url, broker?.capability)
  if (!resolved) throw new Error('Invalid enterprise broker configuration.')
  if (typeof ctx?.provide === 'function') ctx.provide('enterpriseBroker', resolved)
  return resolved
}

async function readJson(request) {
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error('Request body is too large.')
  if (!text) return {}
  const body = JSON.parse(text)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object.')
  }
  return body
}

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' }
  })
}

function registerJsonRoute(connection, path, methods, handler) {
  connection.fetch.register({
    path,
    methods,
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        return jsonResponse(await handler(request))
      } catch (error) {
        const status = Number(error?.status) || 400
        return jsonResponse({ ok: false, error: errorMessage(error) }, status)
      }
    }
  })
}

function unavailable() {
  throw Object.assign(new Error('Enterprise login is not available yet.'), { status: 503 })
}

async function brokerChat(broker, body, signal, attribution, connectionKey) {
  if (!broker) unavailable()
  let response
  try {
    response = await fetch(new URL(connectionKey === undefined ? '/v1/chat' : '/v1/responses', `${broker.origin}/`), {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        authorization: `Bearer ${broker.capability}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ request: body, attribution, ...(connectionKey === undefined ? {} : { connectionKey }) })
    })
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn('[enterprise] broker model request failed', error)
    unavailable()
  }
  return response
}

async function requestBrokerJson(broker, path, body, signal) {
  if (!broker) unavailable()
  let response
  try {
    response = await fetch(new URL(path, `${broker.origin}/`), {
      method: body === undefined ? 'GET' : 'POST',
      signal,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${broker.capability}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } catch (error) {
    signal?.throwIfAborted()
    console.warn('[enterprise] broker request failed', { path }, error)
    unavailable()
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(typeof payload.error === 'string' ? payload.error : `Enterprise request failed (${response.status}).`), {
      status: response.status,
      ...(typeof payload.errorCode === 'string' && payload.errorCode ? { errorCode: payload.errorCode } : {})
    })
  }
  return payload
}

function startEphemeralLoginCallbackServer(onAccepted) {
  return new Promise((resolve) => {
    let closed = false
    const server = createServer((req, res) => {
      try {
        const port = server.address()?.port || 0
        const url = new URL(req.url, `http://127.0.0.1:${port}`)
        if (url.pathname === '/dsh/callback') {
          const authId = url.searchParams.get('auth_id') || undefined
          const state = url.searchParams.get('state') || undefined
          const identityTicket = url.searchParams.get('identity_ticket') || undefined
          const error = url.searchParams.get('error') || undefined
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store'
          })
          res.end('<!doctype html><html><head><meta charset="utf-8"><title>BISHENG</title></head><body><p>Sign-in complete. You may return to the application.</p><script>window.close()</script></body></html>')
          if (!closed && onAccepted) {
            onAccepted({ authId, state, identityTicket, error })
          }
          return
        }
      } catch {}
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('Invalid request')
    })
    server.once('error', () => resolve(null))
    server.listen(0, '127.0.0.1', () => {
      const port = server.address()?.port
      if (!port) {
        server.close()
        resolve(null)
        return
      }
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/dsh/callback`,
        close: () => {
          if (!closed) {
            closed = true
            server.close()
          }
        }
      })
    })
  })
}

function getSessionStorePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'enterprise-session.json')
}

function saveSessionToDisk(session) {
  try {
    const filePath = getSessionStorePath()
    if (!session) {
      try { unlinkSync(filePath) } catch {}
      return
    }
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.warn('[enterprise] failed to save session to disk', err)
  }
}

function loadSessionFromDisk() {
  try {
    const filePath = getSessionStorePath()
    const content = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed.base === 'string' && parsed.tokens?.access_token) {
      return parsed
    }
  } catch {}
  return null
}

export function apply(ctx, config) {
  const broker = brokerConfig(ctx, config)
  const brokerJson = (path, body, signal) => requestBrokerJson(broker, path, body, signal)
  const connection = Reflect.get(ctx, 'connection')
  let market
  let workbenches
  let capabilityPolicy
  let sessionAuth = broker ? null : loadSessionFromDisk()
  let sessionPending = null
  let account = sessionAuth && !broker
    ? {
        connected: true,
        secureStorageAvailable: true,
        storageMode: 'session',
        phase: 'connected',
        connectionKey: randomUUID(),
        revision: 1,
        base: sessionAuth.base,
        user: sessionAuth.user,
        tenant: sessionAuth.tenant,
        models: [],
        modelsAvailable: false,
        usage: unavailableUsage(),
        desktopVersion: process.env.DSH_DESKTOP_VERSION || '1.0.1'
      }
    : disabledState()
  let workSkills
  let workResources
  let workCapabilities
  let ingestEnterpriseState = () => undefined

  const fetchSessionData = async (base, accessToken) => {
    let models = []
    let usage = unavailableUsage()
    try {
      const [modelsRes, usageRes] = await Promise.all([
        fetch(`${base}${API_PATHS.models}`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
        }),
        fetch(`${base}${API_PATHS.usage}`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
        })
      ])
      if (modelsRes.ok) {
        models = parseModelsLenient(await modelsRes.json())
      } else {
        console.warn(`[enterprise] models request failed: ${modelsRes.status}`)
      }
      if (usageRes.ok) {
        const usageJson = await usageRes.json()
        console.log('[enterprise] usage response:', usageJson)
        usage = parseUsageLenient(usageJson)
      } else {
        console.warn(`[enterprise] usage request failed: ${usageRes.status}`)
      }
    } catch (err) {
      console.warn('[enterprise] failed to fetch models or usage', err)
    }
    return { models, usage }
  }

  let tokenRefreshPromise = null
  const refreshSessionTokens = async () => {
    if (!sessionAuth?.tokens?.refresh_token || !sessionAuth?.base) return
    if (tokenRefreshPromise) return tokenRefreshPromise
    tokenRefreshPromise = (async () => {
      try {
        const disk = loadSessionFromDisk()
        if (disk?.tokens?.refresh_token && disk.tokens.refresh_token !== sessionAuth.tokens.refresh_token && !accessNeedsRefresh(disk.tokens)) {
          sessionAuth = disk
          return
        }
        const res = await fetch(`${sessionAuth.base}${API_PATHS.token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: sessionAuth.tokens.refresh_token
          })
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          console.warn('[enterprise] token refresh failed', res.status, payload)
          const reloaded = loadSessionFromDisk()
          if (reloaded?.tokens?.refresh_token && reloaded.tokens.refresh_token !== sessionAuth.tokens?.refresh_token) {
            sessionAuth = reloaded
            return
          }
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            account = {
              ...account,
              phase: 'reauthRequired',
              error: payload.error?.message || `Token refresh failed (${res.status}).`
            }
            ingestEnterpriseState(account)
          }
          return
        }
        const newTokens = parseToken(await res.json(), sessionAuth.base)
        sessionAuth = {
          ...sessionAuth,
          tokens: newTokens,
          user: newTokens.user,
          tenant: newTokens.tenant
        }
        saveSessionToDisk(sessionAuth)
      } catch (err) {
        console.warn('[enterprise] token refresh error', err)
      } finally {
        tokenRefreshPromise = null
      }
    })()
    return tokenRefreshPromise
  }

  const ensureValidSessionAuth = async () => {
    if (!sessionAuth) return null
    if (accessNeedsRefresh(sessionAuth.tokens)) {
      await refreshSessionTokens()
    }
    return sessionAuth
  }

  let refreshPromise = null
  const refreshSessionState = async () => {
    if (!sessionAuth) return account
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      try {
        await ensureValidSessionAuth()
        if (!sessionAuth) return account
        const { models, usage } = await fetchSessionData(sessionAuth.base, sessionAuth.tokens.access_token)
        account = {
          ...account,
          models,
          modelsAvailable: models.length > 0,
          usage,
          revision: (account.revision || 0) + 1
        }
        ingestEnterpriseState(account)
        return account
      } finally {
        refreshPromise = null
      }
    })()
    return refreshPromise
  }

  const thirdPartyFlags = () => {
    const snap = capabilityPolicy?.snapshot()
    const connected = account.connected === true && snap?.connected === true && snap?.connectionKey === account.connectionKey
    return {
      allowThirdPartyPlugins: connected && snap.allowThirdPartyPlugins === true,
      allowThirdPartyWorkbenches: connected && snap.allowThirdPartyWorkbenches === true
    }
  }
  const readBrokerState = async () => {
    if (!broker && sessionAuth && !account.modelsAvailable) {
      await refreshSessionState().catch(() => undefined)
    }
    const state = broker ? await brokerJson('/v1/state') : account
    if (account.connectionKey !== state.connectionKey) {
      await market?.stop()
      await workbenches?.stop()
      capabilityPolicy?.reset()
    }
    if ((!state.connected && account.connected) || account.connectionKey !== state.connectionKey) { workResources?.clear(); workSkills?.clear(); workCapabilities?.clear() }
    account = state
    if (!state.connected) capabilityPolicy?.reset()
    else void capabilityPolicy?.refresh(state.connectionKey).catch(() => undefined)
    ingestEnterpriseState(state)
    return { ...state, ...thirdPartyFlags() }
  }
  const marketRequest = async (path, body, binary = false) => {
    if (!broker) {
      if (!sessionAuth) unavailable()
      const auth = await ensureValidSessionAuth()
      if (!auth?.tokens?.access_token || !auth?.base) unavailable()
      const makeRequest = async (token) => {
        const url = new URL(path, auth.base)
        return fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
      }
      let response = await makeRequest(auth.tokens.access_token)
      if (response.status === 401) {
        await refreshSessionTokens()
        if (sessionAuth?.tokens?.access_token) {
          response = await makeRequest(sessionAuth.tokens.access_token)
        }
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const failure = new Error(payload.error || `Enterprise market request failed (${response.status}).`)
        if (typeof payload.errorCode === 'string' && payload.errorCode) failure.code = payload.errorCode
        throw failure
      }
      return binary ? Buffer.from(await response.arrayBuffer()) : response.json()
    }
    const response = await fetch(new URL('/v1/market', broker.origin), {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path, connectionKey: account.connectionKey, ...(body === undefined ? {} : { body }) })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      const failure = new Error(payload.error || `Enterprise market request failed (${response.status}).`)
      if (typeof payload.errorCode === 'string' && payload.errorCode) failure.code = payload.errorCode
      throw failure
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
  if (typeof ctx.inject === 'function') ctx.inject(['tools', 'sessions', 'systemPrompt'], scoped => { workResources = applyWorkResources(scoped, {
    state: () => account, refreshState: readBrokerState,
    request: (body, signal) => brokerJson('/v1/work-resources', body, signal)
  }) })
  if (typeof ctx.inject === 'function') ctx.inject(['skills'], scoped => { workSkills = applyEnterpriseSkills(scoped, {
    state: () => account, refreshState: readBrokerState,
    request: async (body, signal) => {
      if (!broker) unavailable()
      const response = await fetch(new URL('/v1/work-skills', broker.origin), {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Skill request failed (${response.status}).`)
      return body.operation === 'bundle' ? Buffer.from(await response.arrayBuffer()) : response.json()
    }
  }) })
  if (typeof ctx.inject === 'function') ctx.inject(['tools', 'sessions'], scoped => {
    workCapabilities = applyWorkCapabilities(scoped, {
      state: () => account, refreshState: readBrokerState,
      request: (body, signal) => brokerJson('/v1/work-mcp', body, signal)
    })
  })
  const verifyWorkbenchArtifact = async (input) => {
    if (broker) {
      const response = await fetch(new URL('/v1/workbench/verify', broker.origin), {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, connectionKey: account.connectionKey })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw Object.assign(new Error(payload.error || `Enterprise workbench verification failed (${response.status}).`), { status: response.status })
      }
      return payload
    }
    if (!sessionAuth) unavailable()
    const auth = await ensureValidSessionAuth()
    if (!auth?.tokens?.access_token || !auth?.base) unavailable()
    const path = `/api/v1/dsh/market/workbenches/${input.id}/versions/${input.versionId}/artifact`
    const res = await fetch(new URL(path, auth.base), {
      headers: { authorization: `Bearer ${auth.tokens.access_token}` }
    })
    if (!res.ok) {
      return { ok: false, stage: 'download', error: `Failed to download artifact (${res.status}).` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (typeof input.sizeBytes === 'number' && buf.length !== input.sizeBytes) {
      return { ok: false, stage: 'size', error: 'Artifact size mismatch.' }
    }
    if (typeof input.sha256 === 'string') {
      const hash = createHash('sha256').update(buf).digest('hex')
      if (hash !== input.sha256) {
        return { ok: false, stage: 'sha256', error: 'Artifact checksum mismatch.' }
      }
    }
    return { ok: true }
  }
  const materializeWorkbenchArtifact = async (input) => {
    if (broker) {
      const response = await fetch(new URL('/v1/workbench/materialize', broker.origin), {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, connectionKey: account.connectionKey })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw Object.assign(new Error(payload.error || `Enterprise workbench installation failed (${response.status}).`), { status: response.status })
      }
      return payload
    }
    if (!sessionAuth) unavailable()
    const auth = await ensureValidSessionAuth()
    if (!auth?.tokens?.access_token || !auth?.base) unavailable()
    const path = `/api/v1/dsh/market/workbenches/${input.id}/versions/${input.versionId}/artifact`
    const res = await fetch(new URL(path, auth.base), {
      headers: { authorization: `Bearer ${auth.tokens.access_token}` }
    })
    if (!res.ok) {
      throw new Error(`Failed to download artifact (${res.status}).`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (typeof input.sha256 === 'string') {
      const hash = createHash('sha256').update(buf).digest('hex')
      if (hash !== input.sha256) {
        throw new Error('Artifact checksum mismatch.')
      }
    }
    const tmpDir = await mkdtemp(join(tmpdir(), 'dsh-wb-'))
    const artifactPath = join(tmpDir, 'package.tgz')
    await writeFile(artifactPath, buf)
    const ticket = randomUUID()
    return { ok: true, path: artifactPath, ticket, connectionKey: account.connectionKey }
  }
  const releaseWorkbenchArtifact = async (ticket, connectionKey) => {
    if (!broker || typeof ticket !== 'string' || typeof connectionKey !== 'string') return
    await fetch(new URL('/v1/workbench/release', broker.origin), {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
      body: JSON.stringify({ connectionKey, ticket })
    }).catch(() => undefined)
  }
  applyEnterpriseAuth(ctx)
  const grants = new WeakMap()
  const auth = {
    async grant(identity) {
      const value = await brokerJson('/v1/auth/grant', identity)
      if (typeof value.capability !== 'string' || !value.capability) throw new Error('Invalid enterprise grant.')
      const transport = createEnterpriseAuthTransport(broker.origin, value.capability)
      grants.set(transport, value.capability)
      return transport
    },
    async revoke(transport) {
      const capability = grants.get(transport)
      if (capability) {
        await brokerJson('/v1/auth/revoke', { capability })
        grants.delete(transport)
      }
    }
  }
  const accountController = {
    state: () => account,
    refreshState: readBrokerState,
    refreshProfile: readBrokerState,
    marketRequest,
    verifyWorkbenchArtifact,
    materializeWorkbenchArtifact,
    releaseWorkbenchArtifact
  }
  market = applyEnterpriseMarket(ctx, accountController, { auth })
  workbenches = applyEnterpriseWorkbenchMarket(ctx, accountController)
  if (typeof ctx.provide === 'function') {
    ctx.provide('enterpriseWorkbenchPackages', {
      async open(id) {
        const opened = await workbenches.packageForInstall(id)
        return {
          path: opened.path,
          packageName: opened.packageName,
          version: opened.version,
          release: () => releaseWorkbenchArtifact(opened.ticket, opened.connectionKey)
        }
      }
    })
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['enterpriseCapabilityPolicy'], (scoped) => {
      capabilityPolicy = scoped.enterpriseCapabilityPolicy
      const disposeResolver = capabilityPolicy.registerResolver(async () => {
        const connectionKey = account.connectionKey
        if (!account.connected || !connectionKey) return { connected: false, connectionKey, authoritative: true }
        try {
          const envelope = await marketRequest('/api/v1/dsh/market/capabilities')
          if (account.connectionKey !== connectionKey) return { stale: true, connectionKey }
          const parsed = envelope?.status_code === 200
            ? parseThirdPartyPolicy(envelope.data)
            : parseThirdPartyPolicy(undefined)
          return { connected: true, connectionKey, authoritative: true, ...parsed }
        } catch {
          if (account.connectionKey !== connectionKey) return { stale: true, connectionKey }
          return { connected: true, connectionKey, authoritative: true, ...parseThirdPartyPolicy(undefined) }
        }
      })
      if (account.connected) void capabilityPolicy.refresh(account.connectionKey).catch(() => undefined)
      return () => {
        disposeResolver()
        capabilityPolicy = undefined
      }
    })
  }
  registerJsonRoute(connection, LOCAL_PATHS.state, ['GET'], async () => readBrokerState())
  registerJsonRoute(connection, LOCAL_PATHS.inspectBase, ['POST'], async (request) => {
    const body = await readJson(request)
    return inspectedBase(normalizeEnterpriseServerUrl(String(body?.base ?? ''), inspectUrlOptions()))
  })

  const completeSessionLoginWithTicket = async (ticket) => {
    if (!ticket) throw Object.assign(new Error('A one-time login code is required.'), { status: 400 })
    if (!sessionPending || Date.now() > sessionPending.expiresAt) {
      throw Object.assign(new Error('No enterprise login is waiting for a code.'), { status: 409 })
    }
    const tokenRes = await fetch(`${sessionPending.base}${API_PATHS.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'identity_ticket',
        identity_ticket: ticket,
        auth_id: sessionPending.authId,
        code_verifier: sessionPending.codeVerifier
      })
    })
    if (!tokenRes.ok) {
      const payload = await tokenRes.json().catch(() => ({}))
      const errorMsg = payload.error || payload.status_message || `Login verification failed (${tokenRes.status}).`
      console.warn('[enterprise] token exchange failed', { status: tokenRes.status, payload })
      throw Object.assign(new Error(errorMsg), { status: tokenRes.status })
    }
    const tokens = parseToken(await tokenRes.json(), sessionPending.base)
    const { models, usage } = await fetchSessionData(sessionPending.base, tokens.access_token)
    sessionAuth = {
      base: sessionPending.base,
      tokens,
      user: tokens.user,
      tenant: tokens.tenant
    }
    saveSessionToDisk(sessionAuth)
    sessionPending.callbackServer?.close?.()
    sessionPending = null
    const state = {
      connected: true,
      secureStorageAvailable: true,
      storageMode: 'session',
      phase: 'connected',
      connectionKey: randomUUID(),
      revision: (account.revision || 0) + 1,
      base: sessionAuth.base,
      user: tokens.user,
      tenant: tokens.tenant,
      models,
      modelsAvailable: models.length > 0,
      usage,
      desktopVersion: process.env.DSH_DESKTOP_VERSION || '1.0.1'
    }
    if (account.connectionKey !== state.connectionKey) {
      await market?.stop()
      await workbenches?.stop()
      capabilityPolicy?.reset()
    }
    if ((!state.connected && account.connected) || account.connectionKey !== state.connectionKey) {
      workResources?.clear(); workSkills?.clear(); workCapabilities?.clear()
    }
    account = state
    ingestEnterpriseState(state)
    if (state.connected) await capabilityPolicy?.refresh(state.connectionKey).catch(() => undefined)
    return { ...state, ...thirdPartyFlags() }
  }

  const startSessionLogin = async (base) => {
    const configRes = await fetch(`${base}${API_PATHS.config}`, {
      headers: { accept: 'application/json' }
    })
    if (!configRes.ok) {
      throw Object.assign(new Error(`Failed to connect to enterprise platform (${configRes.status}).`), { status: configRes.status })
    }
    const config = parseConfig(await configRes.json())
    if (!config.enabled) throw Object.assign(new Error('Enterprise login is disabled on this platform.'), { status: 503 })

    sessionPending?.callbackServer?.close?.()
    const pkce = createPkceTransaction()
    let callbackServer = null
    try {
      callbackServer = await startEphemeralLoginCallbackServer(async ({ authId, state, identityTicket }) => {
        if (identityTicket && sessionPending && sessionPending.authId === authId && sessionPending.state === state) {
          try {
            await completeSessionLoginWithTicket(identityTicket)
          } catch (err) {
            console.warn('[enterprise] automatic callback ticket exchange failed', err)
          }
        }
      })
    } catch (err) {
      console.warn('[enterprise] failed to start ephemeral callback server', err)
    }

    const redirectUri = callbackServer?.redirectUri || 'http://127.0.0.1:49152/dsh/callback'
    const authRes = await fetch(`${base}${API_PATHS.authorizations}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
        state: pkce.state,
        device_name: 'BISHENG Web'
      })
    })
    if (!authRes.ok) {
      callbackServer?.close?.()
      const errorText = await authRes.text().catch(() => '')
      console.warn('[enterprise] authorization request failed', {
        status: authRes.status,
        url: `${base}${API_PATHS.authorizations}`,
        body: errorText
      })
      throw Object.assign(new Error(`Enterprise authorization failed (${authRes.status}).`), { status: authRes.status })
    }
    const authData = parseAuthorization(await authRes.json(), base)
    const expiresAt = Date.now() + authData.expires_in * 1000
    sessionPending = {
      base,
      codeVerifier: pkce.codeVerifier,
      state: pkce.state,
      authId: authData.auth_id,
      expiresAt,
      callbackServer
    }
    account = {
      ...account,
      base,
      phase: 'authorizing',
      revision: (account.revision || 0) + 1,
      loginExpiresAt: expiresAt
    }
    ingestEnterpriseState(account)
    return {
      authorizationUrl: authData.authorize_url,
      expiresIn: authData.expires_in,
      base
    }
  }

  registerJsonRoute(connection, LOCAL_PATHS.start, ['POST'], async (request) => {
    const body = await readJson(request)
    const base = normalizeEnterpriseServerUrl(String(body?.base ?? ''), inspectUrlOptions())
    if (broker) {
      return brokerJson('/v1/login/start', {
        base,
        ...(body?.confirmInsecurePrivateHttp === true ? { confirmInsecurePrivateHttp: true } : {})
      })
    }
    return startSessionLogin(base)
  })
  registerJsonRoute(connection, LOCAL_PATHS.manual, ['POST'], async (request) => {
    const body = await readJson(request)
    const ticket = String(body?.identityTicket ?? '').trim()
    if (broker) {
      const state = await brokerJson('/v1/login/manual', { identityTicket: ticket })
      if (account.connectionKey !== state.connectionKey) {
        await market?.stop()
        await workbenches?.stop()
        capabilityPolicy?.reset()
      }
      if ((!state.connected && account.connected) || account.connectionKey !== state.connectionKey) { workResources?.clear(); workSkills?.clear(); workCapabilities?.clear() }
      account = state
      ingestEnterpriseState(state)
      if (state.connected) await capabilityPolicy?.refresh(state.connectionKey).catch(() => undefined)
      return { ...state, ...thirdPartyFlags() }
    }
    return completeSessionLoginWithTicket(ticket)
  })
  registerJsonRoute(connection, LOCAL_PATHS.inspectDeepLink, ['POST'], async (request) => {
    const body = await readJson(request)
    const parsed = parseEnterpriseLoginDeepLink(String(body?.url ?? ''), inspectUrlOptions())
    return inspectedBase(parsed.serverUrl)
  })
  registerJsonRoute(connection, LOCAL_PATHS.confirmDeepLink, ['POST'], async (request) => {
    const body = await readJson(request)
    const base = normalizeEnterpriseServerUrl(String(body?.base ?? ''), inspectUrlOptions())
    if (broker) {
      return brokerJson('/v1/login/start', {
        base,
        ...(body?.confirmInsecurePrivateHttp === true ? { confirmInsecurePrivateHttp: true } : {})
      })
    }
    return startSessionLogin(base)
  })
  registerJsonRoute(connection, LOCAL_PATHS.refreshModels, ['POST'], async (request) => {
    await readJson(request)
    if (broker) {
      const state = await brokerJson('/v1/models/refresh', {})
      ingestEnterpriseState(state)
      return state
    }
    if (sessionAuth) {
      return refreshSessionState()
    }
    return account
  })
  registerJsonRoute(connection, LOCAL_PATHS.refresh, ['POST'], async (request) => {
    await readJson(request)
    if (broker) {
      const state = await brokerJson('/v1/refresh', {})
      ingestEnterpriseState(state)
      return state
    }
    if (sessionAuth) {
      return refreshSessionState()
    }
    return account
  })
  registerJsonRoute(connection, LOCAL_PATHS.logout, ['POST'], async (request) => {
    await readJson(request)
    let state
    if (broker) {
      state = await brokerJson('/v1/logout', {})
    } else {
      sessionAuth = null
      sessionPending = null
      saveSessionToDisk(null)
      state = disabledState()
    }
    await market?.stop()
    await workbenches?.stop()
    capabilityPolicy?.reset()
    if ((!state.connected && account.connected) || account.connectionKey !== state.connectionKey) { workResources?.clear(); workSkills?.clear(); workCapabilities?.clear() }
    account = state
    ingestEnterpriseState(state)
    return { ...state, allowThirdPartyPlugins: false, allowThirdPartyWorkbenches: false }
  })
  registerJsonRoute(connection, LOCAL_PATHS.chatHistory, ['GET'], async (request) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    if (!broker) {
      const auth = await ensureValidSessionAuth()
      if (!auth?.tokens?.access_token || !auth?.base) {
        throw Object.assign(new Error('Enterprise chat unavailable.'), { status: 401 })
      }
      const targetUrl = new URL(`/api/v1/chat/list?page=${page}&limit=40`, auth.base)
      const res = await fetch(targetUrl.href, {
        headers: {
          authorization: `Bearer ${auth.tokens.access_token}`,
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) throw Object.assign(new Error(`Chat history request failed (${res.status}).`), { status: res.status })
      const result = await res.json()
      const rawItems = Array.isArray(result?.data) ? result.data : []
      const items = rawItems.map(row => ({
        id: String(row.chat_id || ''),
        title: String(row.name || row.flow_name || '').slice(0, 500),
        updatedAt: String(row.update_time || row.create_time || '').slice(0, 50)
      })).filter(item => Boolean(item.id))
      return {
        epoch: account.revision || 1,
        items,
        hasMore: rawItems.length === 40
      }
    }
    return { epoch: account.revision || 1, items: [], hasMore: false }
  })
  registerJsonRoute(connection, LOCAL_PATHS.chatDelete, ['POST'], async (request) => {
    const body = await readJson(request)
    const id = String(body?.id || '').trim()
    if (!id) throw Object.assign(new Error('Chat id required.'), { status: 400 })
    if (!broker) {
      const auth = await ensureValidSessionAuth()
      if (!auth?.tokens?.access_token || !auth?.base) {
        throw Object.assign(new Error('Enterprise chat unavailable.'), { status: 401 })
      }
      const targetUrl = new URL(`/api/v1/chat/${encodeURIComponent(id)}`, auth.base)
      const res = await fetch(targetUrl.href, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${auth.tokens.access_token}`,
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) throw Object.assign(new Error(`Chat deletion failed (${res.status}).`), { status: res.status })
      return { epoch: body?.epoch ?? (account.revision || 1) }
    }
    return { epoch: body?.epoch ?? (account.revision || 1) }
  })
  const llm = ctx.llm
  if (llm) {
    const handle = startEnterpriseLlm(ctx, llm, broker, ensureValidSessionAuth)
    ingestEnterpriseState = handle.ingest
    if (typeof ctx.effect === 'function' && broker) {
      ctx.effect(() => handle.dispose, 'dsh-desktop-enterprise: poll broker state')
    }
  }
  if (!broker && sessionAuth) {
    ingestEnterpriseState(account)
    void refreshSessionState().catch((err) => {
      console.warn('[enterprise] failed to refresh restored session', err)
    })
  }
}

function contentSafetyLocale(request) {
  const authority = request.headers.host
  const cookie = request.headers.cookie
  if (typeof authority !== 'string' || typeof cookie !== 'string') return undefined
  const name = 'dshEnterpriseSafetyLocale_' + encodeURIComponent(authority.toLowerCase())
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='))
  if (values.length !== 1) return undefined
  const value = values[0].slice(name.length + 1)
  if (value.length > 2048) return undefined
  try {
    const payload = JSON.parse(decodeURIComponent(value))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'messages')
      || typeof payload.owner !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.owner)) return undefined
    const messages = payload.messages
    const codes = Object.keys(CONTENT_SAFETY_ERROR_COPY)
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)
      || Object.keys(messages).length !== codes.length
      || !codes.every(code => typeof messages[code] === 'string'
        && Object.values(CONTENT_SAFETY_ERROR_COPY[code]).includes(messages[code]))) return undefined
    return Object.freeze(messages)
  } catch {
    // Locale is an optional display hint, never an authentication or model input.
    return undefined
  }
}

function startEnterpriseLlm(ctx, llm, broker, getSessionAuth) {
  const safetyLocale = new AsyncLocalStorage()
  const disposeSafetyLocale = typeof ctx.on === 'function'
    ? ctx.on('connection/request', (request, _response, next) =>
      safetyLocale.run(contentSafetyLocale(request), next))
    : () => {}
  const safetyLocaleScope = createContentSafetyLocaleScope(ctx, () => safetyLocale.getStore())
  let latest = disabledState()
  let models = []
  let modelsAvailable = false
  let revision = -1
  let registration
  let timer
  let stopped = false
  const titles = createAuditTitleSync({
    ctx,
    async send(body, signal) {
      if (!broker) return { ok: true }
      const response = await fetch(new URL('/v1/audit/conversations/title', broker.origin), {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${broker.capability}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw Object.assign(new Error('Audit title synchronization failed.'), { status: response.status })
      }
      return response.json()
    },
    note: (reason, details) => console.warn('[enterprise-audit-title]', JSON.stringify({ reason, ...details }))
  })
  const adapter = new EnterpriseLlmAdapter({
    providerName: () => latest.tenant?.name || latest.user?.display_name || 'BiSheng Enterprise',
    models: () => modelsAvailable ? models : [],
    auditFields: () => latest.connected ? latest.audit_context?.fields ?? [] : [],
    resolveAuditSession: (id) => {
      titles.track(id)
      try {
        const header = ctx.get?.('sessions')?.get(id)?.header
        if (!header || header.id !== id) return undefined
        if (header.origin === 'subagent') return { session_origin: 'subagent', parent_conversation_id: header.parentSession }
        return header.origin === undefined ? { session_origin: 'main' } : undefined
      } catch {
        // Sessions are optional; unavailable provenance never blocks model generation.
        return undefined
      }
    },
    request: async (body, signal, headers) => {
      if (broker) return brokerChat(broker, body, signal, pickAttributionHeaders(headers))
      const session = await getSessionAuth?.()
      if (!session?.tokens?.access_token) unavailable()
      return fetch(`${session.base}${API_PATHS.chat}`, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${session.tokens.access_token}`,
          'content-type': 'application/json',
          ...pickAttributionHeaders(headers)
        },
        body: JSON.stringify(body)
      })
    },
    requestResponses: async (body, signal, headers, connectionKey) => {
      if (broker) return brokerChat(broker, body, signal, pickAttributionHeaders(headers), connectionKey)
      const session = await getSessionAuth?.()
      if (!session?.tokens?.access_token) unavailable()
      return fetch(`${session.base}${API_PATHS.responses}`, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${session.tokens.access_token}`,
          'content-type': 'application/json',
          ...pickAttributionHeaders(headers)
        },
        body: JSON.stringify({ ...body, connectionKey })
      })
    },
    connectionKey: () => latest.connectionKey,
    contentSafetyFormatterFor: options => safetyLocaleScope.formatterFor(options),
    onReplayDegrade: (reason) => ctx.logger?.info?.(`Enterprise Responses replay degraded: ${reason}`),
    readImage: (ref, signal) => ctx.get?.('attachments')?.readImageRequest?.(ref, {
      ...requestImageDimensions(ref.width, ref.height, 4_194_304),
      maxBytes: 5 * 1024 * 1024
    }, signal)
  })

  const ingest = (state) => {
    latest = state
    titles.ingest(state)
    if (state.revision === revision) return
    const nextRevision = Number.isSafeInteger(state.revision) ? state.revision : revision
    models = Array.isArray(state.models) ? state.models : []
    modelsAvailable = state.modelsAvailable === true && models.length > 0
    if (modelsAvailable) {
      if (!registration) registration = llm.registerAdapter([BISHENG_PROVIDER_ROUTE], adapter)
      else registration.replace([BISHENG_PROVIDER_ROUTE])
    } else if (registration) {
      registration.replace([])
    }
    revision = nextRevision
  }

  const poll = async () => {
    if (stopped || !broker) return
    try {
      ingest(await requestBrokerJson(broker, '/v1/state'))
    } catch {
      // Keep the last published catalog until the next local snapshot.
    }
    const delay = ['authorizing', 'refreshing'].includes(latest.phase)
      ? 1_000
      : latest.connected
        ? 30_000
        : 60_000
    timer = setTimeout(() => { void poll() }, delay)
    timer.unref?.()
  }
  if (broker) void poll()
  return {
    ingest(state) {
      if (stopped) return
      try {
        ingest(state)
      } catch {
        // Settings reads must not fail if adapter registration throws.
      }
    },
    dispose() {
      stopped = true
      disposeSafetyLocale()
      safetyLocaleScope.dispose()
      safetyLocale.disable()
      titles.dispose()
      if (timer) clearTimeout(timer)
      registration?.()
    }
  }
}
