import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { c as createTar, t as listTar, x as extractTar } from 'tar'
import ignore from 'ignore'

export type CloudFetch = (path: string, init?: RequestInit, expectedConnectionKey?: string) => Promise<{ response: Response, base: string, connectionKey: string }>
export interface CloudEffect {
  operation: 'publish' | 'checkout'
  serverUrl: string
  appId?: string
  versionId?: string
  path?: string
  digest?: string
  releaseNotes?: string
  schemaChange?: boolean
}
export type CloudAuthorize = (effect: Readonly<CloudEffect>) => Promise<boolean>
export interface CloudLaunch { appId: string; slug: string; launchUrl: string; entryUrl: string; ticket: string; connectionKey: string }
const ID = /^[a-f0-9]{32}$/u
const PRIVATE = /^(?:\.git|node_modules|\.venv|venv|\.npmrc|\.pypirc|\.netrc|\.DS_Store|\.ssh|\.aws|\.azure|\.cache|\.env(?:\..*)?|\.bisheng|\.dsh|__pycache__|data|sessions?|logs?)$|\.(?:pem|key|p12|pfx|(?:db|sqlite3?)(?:-(?:wal|shm|journal))?)$/iu
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud workbench request.')
  return input as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid application or version identity.')
  return value
}
async function json(response: Response): Promise<Record<string, unknown>> {
  const data = record(await response.json())
  if (!response.ok || data.status_code !== 200) throw new Error(typeof data.status_message === 'string' ? data.status_message : 'Cloud workbench request failed.')
  return record(data.data)
}
function developmentToolkit(base: string) {
  const prefix = base.replace(/\/$/u, '')
  return {
    workbenchGuideUrl: `${prefix}/api/v1/dev-toolkit/workbench-guide.md`,
    versionsUrl: `${prefix}/api/v1/dev-toolkit/versions`,
    sdkGuideUrl: `${prefix}/api/v1/dev-toolkit/sdk-guide.md`,
    sdkIndexUrl: `${prefix}/api/v1/dev-toolkit/simple/`,
    platformWiringUrl: `${prefix}/api/v1/dev-toolkit/skills/platform-wiring`
  }
}

// Match the CLI's gitignore syntax, including ordered negations. Mandatory
// credential/data exclusions below remain authoritative and cannot be negated.
async function projectExclusions(path: string) {
  const rules = ignore()
  const file = join(path, '.bishengignore')
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error('Invalid .bishengignore file.')
    rules.add(await readFile(file, 'utf8'))
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  return rules
}

export class CloudWorkbenchService {
  private readonly projects = new Map<string, { path: string; appId?: string; versionId?: string; connectionKey: string; workspaceRoot?: string }>()
  constructor(private readonly fetch: CloudFetch, private readonly root: string, private readonly authorize?: CloudAuthorize) {}

  private async confirm(effect: CloudEffect): Promise<void> {
    if (!this.authorize || !await this.authorize(Object.freeze(effect))) throw new Error('Cloud operation requires explicit Desktop confirmation.')
  }

  async request(input: unknown): Promise<unknown> {
    const request = record(input)
    if (request.operation === 'guide') {
      // Probe the protocol itself. Toolkit metadata can be deployed separately
      // and cannot establish that the linked Markdown actually exists.
      const result = await this.fetch('/api/v1/dev-toolkit/workbench-guide.md')
      const toolkit = developmentToolkit(result.base)
      if (!result.response.ok) {
        // Release the authenticated response stream while preserving the server
        // status even if cancellation itself fails.
        await result.response.body?.cancel().catch(() => undefined)
        throw new Error(`Enterprise workbench guide request failed: HTTP ${result.response.status} at ${toolkit.workbenchGuideUrl}. Check this enterprise server's dev-toolkit deployment and routing.`)
      }
      const contentType = result.response.headers.get('content-type') || ''
      const guide = await result.response.text()
      if (!/^(?:text\/markdown|text\/plain)(?:;|$)/iu.test(contentType) || !guide.trim()) {
        throw new Error(`Enterprise workbench guide is not a Markdown document at ${toolkit.workbenchGuideUrl}. Check this enterprise server's dev-toolkit deployment and routing.`)
      }
      return {
        guideUrl: toolkit.workbenchGuideUrl,
        guideMarkdown: guide,
        guideSha256: createHash('sha256').update(guide).digest('hex'),
        toolkit
      }
    }
    if (request.operation === 'list') {
      const query = new URLSearchParams()
      if (request.cursor !== undefined && request.cursor !== null) query.set('cursor', id(request.cursor))
      if (request.managed === true) query.set('managed', 'true')
      const result = await this.fetch(`/api/v1/dsh/apps?${query}`)
      // A missing collection route means the server has no hosted-workbench API;
      // it is not an empty catalog or an invalid user credential.
      if (result.response.status === 404) throw new Error('CLOUD_WORKBENCH_API_UNAVAILABLE')
      return { ...await json(result.response), connectionKey: result.connectionKey }
    }
    if (request.operation === 'project') return this.project(request.projectId)
    if (request.operation === 'resume') return this.resume(request.projectId, request.workspaceRoot)
    if (request.operation === 'create') {
      const checked = await this.fetch('/api/v1/dsh/apps/deploy-limits')
      await json(checked.response)
      const projectId = randomUUID()
      const project = await this.materializeProject(projectId, request.workspaceRoot, { connectionKey: checked.connectionKey })
      this.projects.set(projectId, { ...project, connectionKey: checked.connectionKey })
      return { projectId, path: project.path, toolkit: developmentToolkit(checked.base) }
    }
    if (request.operation === 'launch') return this.launch(id(request.appId))
    if (request.operation === 'checkout') return this.checkout(id(request.appId), id(request.versionId), request.workspaceRoot)
    if (request.operation === 'publish') return this.publish(request)
    if (request.operation === 'progress') {
      const result = await this.fetch(`/api/v1/dsh/apps/${id(request.appId)}/deployments/${id(request.deploymentId)}`)
      return { ...await json(result.response), manageUrl: `${result.base.replace(/\/$/u, '')}/build/apps/${id(request.appId)}` }
    }
    if (request.operation === 'limits') return json((await this.fetch('/api/v1/dsh/apps/deploy-limits')).response)
    throw new Error('Unsupported cloud workbench operation.')
  }

  async launch(appId: string): Promise<CloudLaunch> {
    const result = await this.fetch(`/api/v1/dsh/apps/${id(appId)}/launch`, { method: 'POST' })
    const payload = await json(result.response)
    if (typeof payload.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(payload.slug) ||
      typeof payload.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(payload.ticket) ||
      payload.launch_path !== `/apps/${payload.slug}/_desktop` || payload.entry_path !== `/apps/${payload.slug}/`) throw new Error('Invalid hosted application entry.')
    const base = result.base.replace(/\/$/u, '')
    return { appId, slug: payload.slug, ticket: payload.ticket, launchUrl: `${base}${payload.launch_path}`,
      entryUrl: `${base}${payload.entry_path}`, connectionKey: result.connectionKey }
  }

  private async checkout(appId: string, versionId: string, workspaceRoot?: unknown) {
    const checked = await this.fetch('/api/v1/dsh/apps/deploy-limits')
    await json(checked.response)
    await this.confirm({ operation: 'checkout', serverUrl: checked.base, appId, versionId })
    const result = await this.fetch(`/api/v1/dsh/apps/${appId}/versions/${versionId}/source`, {}, checked.connectionKey)
    if (!result.response.ok || !result.response.headers.get('content-type')?.startsWith('application/gzip')) {
      await json(result.response)
      throw new Error('The server did not return editable source.')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of result.response.body ?? []) {
      size += chunk.length
      if (size > 64 * 1024 * 1024) throw new Error('Source archive exceeds the allowed size.')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== result.response.headers.get('x-source-sha256') || result.response.headers.get('x-app-id') !== appId ||
      result.response.headers.get('x-base-version-id') !== versionId) throw new Error('Source archive identity or integrity check failed.')
    const projectId = randomUUID()
    const origin = { appId, baseVersionId: versionId, digest, connectionKey: result.connectionKey }
    const project = await this.materializeProject(projectId, workspaceRoot, origin, async path => {
      const archive = join(dirname(path), 'source.tar.gz')
      await writeFile(archive, bytes, { mode: 0o600, flag: 'wx' })
      let count = 0
      let expanded = 0
      await new Promise<void>((accept, reject) => {
        const parser = listTar({ strict: true, onReadEntry: entry => {
          const path = entry.path
          const segments = path.split('/')
          expanded += entry.size
          if (++count > 10000 || expanded > 256 * 1024 * 1024 || !['File', 'Directory'].includes(entry.type) ||
            isAbsolute(path) || path.includes('\\') || segments.some(p => p === '..' || PRIVATE.test(p))) {
            // Abort through tar's error channel; throwing from this event
            // callback would escape the request promise in Electron main.
            parser.abort(new Error('Unsafe source archive member.'))
          }
        } })
        parser.once('error', reject)
        parser.once('end', accept)
        parser.end(bytes)
      })
      await extractTar({ file: archive, cwd: path, strict: true, preservePaths: false, noChmod: true })
      await rm(archive)
    })
    this.projects.set(projectId, { ...project, appId, versionId, connectionKey: result.connectionKey })
    return { projectId, path: project.path, appId, baseVersionId: versionId, digest, toolkit: developmentToolkit(result.base) }
  }

  private async resume(projectId: unknown, workspaceRoot: unknown) {
    const original = await this.project(projectId)
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) throw new Error('An existing absolute development workspace is required.')
    const workspace = await realpath(workspaceRoot)
    const relativePath = relative(workspace, original.path)
    if (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)) {
      return { projectId, path: original.path, toolkit: developmentToolkit(original.serverUrl) }
    }
    // Older releases kept source outside the conversation workspace. Prepare a
    // local development copy while retaining the published app/version identity.
    const nextId = randomUUID()
    const project = await this.materializeProject(nextId, workspace, {
      connectionKey: original.connectionKey, appId: original.appId, baseVersionId: original.versionId
    }, async path => {
      for (const entry of await readdir(original.path)) {
        await cp(join(original.path, entry), join(path, entry), { recursive: true, force: false, errorOnExist: true,
          filter: async source => !(await lstat(source)).isSymbolicLink() })
      }
    })
    this.projects.set(nextId, { ...project, connectionKey: original.connectionKey, appId: original.appId, versionId: original.versionId })
    return { projectId: nextId, path: project.path, previousProjectId: projectId,
      appId: original.appId, baseVersionId: original.versionId, toolkit: developmentToolkit(original.serverUrl) }
  }

  private async projectLocation(projectId: string, workspaceRoot?: unknown) {
    if (workspaceRoot === undefined) return { directory: join(this.root, projectId), workspaceRoot: undefined }
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) throw new Error('An existing absolute development workspace is required.')
    const workspace = await realpath(workspaceRoot)
    if (!(await lstat(workspace)).isDirectory()) throw new Error('The development workspace must be a directory.')
    return { directory: join(workspace, `cloud-workbench-${projectId}`), workspaceRoot: workspace }
  }

  private async materializeProject(projectId: string, workspace: unknown, origin: Record<string, unknown>, populate?: (path: string) => Promise<void>) {
    const location = await this.projectLocation(projectId, workspace)
    const directory = location.directory
    const registry = join(this.root, projectId)
    const staging = `${directory}.staging`
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    // Both create and checkout publish a fresh directory atomically. Identity
    // stays in Desktop storage, outside the Agent-editable source tree.
    await mkdir(staging, { mode: 0o700 })
    let committed = false
    let registryCreated = false
    try {
      const path = join(staging, 'project')
      await mkdir(path, { mode: 0o700 })
      await populate?.(path)
      if (location.workspaceRoot) {
        await mkdir(registry, { mode: 0o700 })
        registryCreated = true
      }
      await rename(staging, directory)
      committed = true
      await writeFile(join(registry, 'origin.json'), JSON.stringify({ ...origin, workspaceRoot: location.workspaceRoot }), { flag: 'wx', mode: 0o600 })
      return { path: join(directory, 'project'), workspaceRoot: location.workspaceRoot }
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      if (committed) await rm(directory, { force: true, recursive: true })
      if (registryCreated) await rm(registry, { force: true, recursive: true })
      throw error
    }
  }

  private async project(projectId: unknown) {
    let project = typeof projectId === 'string' ? this.projects.get(projectId) : undefined
    if (!project && typeof projectId === 'string' && /^[a-f0-9-]{36}$/u.test(projectId)) {
      const directory = join(this.root, projectId)
      const metadata = join(directory, 'origin.json')
      const directoryStat = await lstat(directory)
      const metadataStat = await lstat(metadata)
      if (directoryStat.isSymbolicLink() || metadataStat.isSymbolicLink() || metadataStat.size > 4096) throw new Error('Invalid development project metadata.')
      const origin = record(JSON.parse(await readFile(metadata, 'utf8')))
      if (typeof origin.connectionKey !== 'string' || !/^[a-f0-9]{16}$/u.test(origin.connectionKey)) throw new Error('Invalid development project identity.')
      const location = await this.projectLocation(projectId, origin.workspaceRoot)
      project = { path: join(location.directory, 'project'), workspaceRoot: location.workspaceRoot, connectionKey: origin.connectionKey,
        ...(origin.appId ? { appId: id(origin.appId) } : {}), ...(origin.baseVersionId ? { versionId: id(origin.baseVersionId) } : {}) }
      this.projects.set(projectId, project)
    }
    if (!project) throw new Error('Fetch the editable source before publishing this project.')
    const limits = await this.fetch('/api/v1/dsh/apps/deploy-limits')
    await json(limits.response)
    if (limits.connectionKey !== project.connectionKey) throw new Error('The enterprise account changed. Fetch the source again.')
    const root = await realpath(project.workspaceRoot || this.root)
    const expected = join(root, project.workspaceRoot ? `cloud-workbench-${projectId}` : String(projectId), 'project')
    const path = await realpath(project.path)
    if (path !== expected) throw new Error('Invalid development project directory.')
    return { ...project, path, serverUrl: limits.base }
  }

  private async publish(request: Record<string, unknown>) {
    const project = await this.project(request.projectId)
    const path = project.path
    const archive = join(this.root, `${randomUUID()}.tar.gz`)
    const exclusions = await projectExclusions(path)
    const entries = (await readdir(path)).sort()
    if (!entries.length) throw new Error('The development project is empty. Create application source before publishing.')
    try {
      await createTar({ file: archive, cwd: path, gzip: true, portable: true, strict: true,
        filter: (name, stat) => {
          if (('isSymbolicLink' in stat ? stat.isSymbolicLink() : stat.type === 'SymbolicLink') || name.split('/').some(part => PRIVATE.test(part))) return false
          const relativeName = name.replace(/^\.\//u, '').replace(/\/$/u, '')
          if (!relativeName || relativeName === '.') return true
          const directory = 'isDirectory' in stat ? stat.isDirectory() : stat.type === 'Directory'
          return !exclusions.ignores(relativeName + (directory ? '/' : ''))
        } }, entries)
      const bytes = await readFile(archive)
      if (bytes.length > 64 * 1024 * 1024) throw new Error('Application package exceeds the allowed size.')
      const schemaChange = request.confirmSchemaChange === true
      const releaseNotes = typeof request.releaseNotes === 'string' ? request.releaseNotes : undefined
      await this.confirm({ operation: 'publish', serverUrl: project.serverUrl, appId: project.appId,
        versionId: project.versionId, path, digest: createHash('sha256').update(bytes).digest('hex'),
        releaseNotes, schemaChange })
      const body = new FormData()
      body.set('package', new Blob([new Uint8Array(bytes)]), 'workbench.tar.gz')
      if (project.appId) body.set('app_id', project.appId)
      if (project.versionId) body.set('base_version_id', project.versionId)
      if (releaseNotes) body.set('release_notes', releaseNotes)
      // Destructive schema confirmation is never inferred from a publish click.
      if (schemaChange) body.set('confirm_schema_change', 'true')
      const accepted = await json((await this.fetch('/api/v1/dsh/apps/deploy', { method: 'POST', body }, project.connectionKey)).response)
      const acceptedAppId = id(accepted.app_id)
      if (project.appId && project.appId !== acceptedAppId) throw new Error('The deployment returned a different application identity.')
      if (!project.appId) {
        // Admission creates the draft before the build runs. Retrying a failed
        // first build must update that draft, including after Desktop restarts.
        // The submitted version is not an approved base version yet.
        const metadata = join(this.root, String(request.projectId), 'origin.json')
        const temporary = join(dirname(metadata), `${randomUUID()}.origin.tmp`)
        try {
          await writeFile(temporary, JSON.stringify({ connectionKey: project.connectionKey, appId: acceptedAppId, workspaceRoot: project.workspaceRoot }), { mode: 0o600, flag: 'wx' })
          await rename(temporary, metadata)
        } finally { await rm(temporary, { force: true }) }
        this.projects.set(String(request.projectId), { ...project, appId: acceptedAppId })
      }
      return accepted
    } finally { await rm(archive, { force: true }) }
  }
}
