import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { c as createTar, t as listTar, x as extractTar } from 'tar'
import ignore from 'ignore'

export type CloudFetch = (path: string, init?: RequestInit, expectedConnectionKey?: string) => Promise<{ response: Response, base: string, connectionKey: string }>
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
  private readonly projects = new Map<string, { path: string; appId?: string; versionId?: string; connectionKey: string }>()
  constructor(private readonly fetch: CloudFetch, private readonly root: string) {}

  async request(input: unknown): Promise<unknown> {
    const request = record(input)
    if (request.operation === 'guide') {
      const result = await this.fetch('/api/v1/dev-toolkit/versions')
      await json(result.response)
      const toolkit = developmentToolkit(result.base)
      return { guideUrl: toolkit.workbenchGuideUrl, toolkit }
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
    if (request.operation === 'create') {
      const checked = await this.fetch('/api/v1/dsh/apps/deploy-limits')
      await json(checked.response)
      const projectId = randomUUID()
      const path = join(this.root, projectId, 'project')
      await mkdir(path, { recursive: true, mode: 0o700 })
      this.projects.set(projectId, { path, connectionKey: checked.connectionKey })
      await writeFile(join(this.root, projectId, 'origin.json'), JSON.stringify({ connectionKey: checked.connectionKey }), { mode: 0o600, flag: 'wx' })
      return { projectId, path, toolkit: developmentToolkit(checked.base) }
    }
    if (request.operation === 'launch') return this.launch(id(request.appId))
    if (request.operation === 'checkout') return this.checkout(id(request.appId), id(request.versionId))
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

  private async checkout(appId: string, versionId: string) {
    const result = await this.fetch(`/api/v1/dsh/apps/${appId}/versions/${versionId}/source`)
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
    const directory = join(this.root, projectId)
    const staging = `${directory}.staging`
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const archive = join(staging, 'source.tar.gz')
    try {
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
      const project = join(staging, 'project')
      await mkdir(project)
      await extractTar({ file: archive, cwd: project, strict: true, preservePaths: false, noChmod: true })
      await rm(archive)
      await writeFile(join(staging, 'origin.json'), JSON.stringify({ appId, baseVersionId: versionId, digest, connectionKey: result.connectionKey }), { flag: 'wx', mode: 0o600 })
      await rename(staging, directory)
      const path = join(directory, 'project')
      this.projects.set(projectId, { path, appId, versionId, connectionKey: result.connectionKey })
      return { projectId, path, appId, baseVersionId: versionId, digest, toolkit: developmentToolkit(result.base) }
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
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
      project = { path: join(directory, 'project'), connectionKey: origin.connectionKey,
        ...(origin.appId ? { appId: id(origin.appId) } : {}), ...(origin.baseVersionId ? { versionId: id(origin.baseVersionId) } : {}) }
      this.projects.set(projectId, project)
    }
    if (!project) throw new Error('Fetch the editable source before publishing this project.')
    const limits = await this.fetch('/api/v1/dsh/apps/deploy-limits')
    await json(limits.response)
    if (limits.connectionKey !== project.connectionKey) throw new Error('The enterprise account changed. Fetch the source again.')
    const root = await realpath(this.root)
    const path = await realpath(project.path)
    if (relative(root, path).startsWith('..') || resolve(root) === resolve(path)) throw new Error('Invalid development project directory.')
    return { ...project, path }
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
      const body = new FormData()
      body.set('package', new Blob([new Uint8Array(bytes)]), 'workbench.tar.gz')
      if (project.appId) body.set('app_id', project.appId)
      if (project.versionId) body.set('base_version_id', project.versionId)
      if (typeof request.releaseNotes === 'string') body.set('release_notes', request.releaseNotes)
      // Destructive schema confirmation is never inferred from a publish click.
      if (request.confirmSchemaChange === true) body.set('confirm_schema_change', 'true')
      const accepted = await json((await this.fetch('/api/v1/dsh/apps/deploy', { method: 'POST', body }, project.connectionKey)).response)
      const acceptedAppId = id(accepted.app_id)
      if (project.appId && project.appId !== acceptedAppId) throw new Error('The deployment returned a different application identity.')
      if (!project.appId) {
        // Admission creates the draft before the build runs. Retrying a failed
        // first build must update that draft, including after Desktop restarts.
        // The submitted version is not an approved base version yet.
        const metadata = join(dirname(path), 'origin.json')
        const temporary = join(dirname(path), `${randomUUID()}.origin.tmp`)
        try {
          await writeFile(temporary, JSON.stringify({ connectionKey: project.connectionKey, appId: acceptedAppId }), { mode: 0o600, flag: 'wx' })
          await rename(temporary, metadata)
        } finally { await rm(temporary, { force: true }) }
        this.projects.set(String(request.projectId), { ...project, appId: acceptedAppId })
      }
      return accepted
    } finally { await rm(archive, { force: true }) }
  }
}
