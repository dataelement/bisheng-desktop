import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { c as pack, Header } from 'tar'
import { gzipSync } from 'node:zlib'
import { CloudWorkbenchService, type CloudFetch } from '../src/main/enterprise/cloud-workbench'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'bisheng-cloud-')); roots.push(root); return root }
const appId = 'a'.repeat(32)
const versionId = 'b'.repeat(32)
const key = 'c'.repeat(16)
function envelope(data: unknown) { return Response.json({ status_code: 200, data }) }

it('normal discovery and launch do not create or fetch a local source project', async () => {
  const root = await fixture()
  const calls: string[] = []
  const fetch: CloudFetch = async path => {
    calls.push(path)
    return { base: 'http://enterprise.test/prefix', connectionKey: key, response: path.includes('/launch')
      ? envelope({ slug: 'board', entry_path: '/apps/board/', launch_path: '/apps/board/_desktop', ticket: 't'.repeat(43) })
      : envelope({ items: [], next_cursor: null }) }
  }
  const service = new CloudWorkbenchService(fetch, join(root, 'projects'))
  await service.request({ operation: 'list' })
  const launch = await service.launch(appId)
  expect(launch.entryUrl).toBe('http://enterprise.test/prefix/apps/board/')
  expect(calls.some(path => path.endsWith('/source'))).toBe(false)
  expect(await readdir(root)).toEqual([])
})

it('gives development Agents the current enterprise toolkit including reverse-proxy prefixes', async () => {
  const root = await fixture()
  const service = new CloudWorkbenchService(async () => ({ base: 'https://enterprise.test/bisheng/', connectionKey: key,
    response: envelope({ max_package_mb: 50 }) }), root)
  const result = await service.request({ operation: 'create' }) as { toolkit: Record<string, string> }
  expect(result.toolkit).toEqual({
    workbenchGuideUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/workbench-guide.md',
    versionsUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/versions',
    sdkGuideUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/sdk-guide.md',
    sdkIndexUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/simple/',
    platformWiringUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/skills/platform-wiring'
  })
})

it('checks source identity and digest before safely materializing a new project', async () => {
  const root = await fixture()
  const source = join(root, 'main.py')
  await writeFile(source, 'print("hello")\n')
  const archive = join(root, 'source.tar.gz')
  await pack({ file: archive, cwd: root, gzip: true }, ['main.py'])
  const bytes = await readFile(archive)
  let digest = '0'.repeat(64)
  const service = new CloudWorkbenchService(async () => ({ base: 'http://enterprise.test', connectionKey: key,
    response: new Response(bytes, { headers: { 'content-type': 'application/gzip', 'x-source-sha256': digest, 'x-app-id': appId, 'x-base-version-id': versionId } }) }), join(root, 'projects'))
  await expect(service.request({ operation: 'checkout', appId, versionId })).rejects.toThrow('integrity')
  digest = createHash('sha256').update(bytes).digest('hex')
  const result = await service.request({ operation: 'checkout', appId, versionId }) as { path: string }
  expect(await readFile(join(result.path, 'main.py'), 'utf8')).toBe('print("hello")\n')
})

it('rejects caller paths and publishing a project created for another account', async () => {
  const root = await fixture()
  let connectionKey = key
  let uploads = 0
  const service = new CloudWorkbenchService(async (path) => { if (path.endsWith('/deploy')) uploads++; return {
    base: 'http://enterprise.test', connectionKey, response: envelope({ max_package_mb: 50 })
  } }, root)
  await expect(service.request({ operation: 'publish', path: '/etc' })).rejects.toThrow('Fetch')
  const result = await service.request({ operation: 'create' }) as { projectId: string }
  connectionKey = 'd'.repeat(16)
  await expect(service.request({ operation: 'publish', projectId: result.projectId })).rejects.toThrow('account changed')
  expect(uploads).toBe(0)
})

it('restores managed project identity after restart and filters private files from publishing', async () => {
  const root = await fixture()
  let uploaded: FormData | undefined
  const fetch: CloudFetch = async (path, init, expectedConnectionKey) => {
    if (path.endsWith('/deploy')) { expect(expectedConnectionKey).toBe(key); uploaded = init?.body as FormData }
    return { base: 'https://enterprise.test', connectionKey: key, response: envelope({ app_id: appId, deployment_id: versionId }) }
  }
  const first = new CloudWorkbenchService(fetch, join(root, 'projects'))
  const project = await first.request({ operation: 'create' }) as { path: string; projectId: string }
  await writeFile(join(project.path, 'main.py'), 'print("ready")')
  await mkdir(join(project.path, 'assets'))
  await writeFile(join(project.path, 'assets', 'app.css'), 'body { margin: 0 }')
  await writeFile(join(project.path, '.npmrc'), 'private registry token')
  await writeFile(join(project.path, '.bishengignore'), 'selftest.py\nscratch/\n*.log\n!keep.log\n!.env\n!.npmrc\n')
  await writeFile(join(project.path, 'selftest.py'), 'local verification only')
  await writeFile(join(project.path, '.env'), 'PRIVATE=must-never-ship')
  await writeFile(join(project.path, 'debug.log'), 'local log')
  await writeFile(join(project.path, 'keep.log'), 'explicitly included public sample')
  await mkdir(join(project.path, 'scratch'))
  await writeFile(join(project.path, 'scratch', 'draft.txt'), 'local scratch')
  await writeFile(join(project.path, 'app.db-wal'), 'private records')
  const second = new CloudWorkbenchService(fetch, join(root, 'projects'))
  await second.request({ operation: 'publish', projectId: project.projectId })
  const blob = uploaded?.get('package')
  expect(blob).toBeInstanceOf(Blob)
  if (!(blob instanceof Blob)) throw new Error('Missing upload')
  const archive = join(root, 'uploaded.tar.gz')
  await writeFile(archive, Buffer.from(await blob.arrayBuffer()))
  const names: string[] = []
  const { t: list } = await import('tar')
  await list({ file: archive, onReadEntry: entry => { names.push(entry.path) } })
  expect(names).toContain('main.py')
  expect(names).toContain('assets/app.css')
  expect(names).toContain('keep.log')
  // Runtime v2 rejects root markers, dot segments and empty path components.
  expect(names.every(name => name.replace(/\/$/u, '').split('/').every(part => part && part !== '.' && part !== '..'))).toBe(true)
  expect(names.some(name => /selftest|scratch|debug\.log|\.env/u.test(name))).toBe(false)
  expect(names.some(name => name.includes('.npmrc') || name.includes('app.db-wal'))).toBe(false)
})

it('retries a failed first build against its existing draft after a Desktop restart', async () => {
  const root = await fixture()
  const uploads: FormData[] = []
  const fetch: CloudFetch = async (path, init) => {
    if (path.endsWith('/deploy')) uploads.push(init?.body as FormData)
    return { base: 'https://enterprise.test', connectionKey: key,
      response: envelope({ app_id: appId, deployment_id: 'd'.repeat(32), version_id: versionId }) }
  }
  const first = new CloudWorkbenchService(fetch, root)
  const project = await first.request({ operation: 'create' }) as { projectId: string; path: string }
  await writeFile(join(project.path, 'main.py'), 'print("ready")')
  await first.request({ operation: 'publish', projectId: project.projectId })
  expect(uploads[0]?.get('app_id')).toBe(null)
  const restarted = new CloudWorkbenchService(fetch, root)
  await restarted.request({ operation: 'publish', projectId: project.projectId })
  expect(uploads[1]?.get('app_id')).toBe(appId)
  expect(uploads[1]?.get('base_version_id')).toBe(null)
})


it.each(['SymbolicLink', 'File'])('rejects unsafe %s archive entries without escaping the request promise', async type => {
  const root = await fixture()
  const header = new Header({ path: type === 'File' ? '../escape.py' : 'link', type: type as 'File' | 'SymbolicLink', ...(type === 'SymbolicLink' ? { linkpath: '../private' } : {}), size: 0, mode: 0o644 })
  header.encode()
  if (!header.block) throw new Error('Missing tar header')
  const bytes = gzipSync(Buffer.concat([header.block, Buffer.alloc(1024)]))
  const service = new CloudWorkbenchService(async () => ({ base: 'https://enterprise.test', connectionKey: key,
    response: new Response(bytes, { headers: { 'content-type': 'application/gzip', 'x-source-sha256': createHash('sha256').update(bytes).digest('hex'), 'x-app-id': appId, 'x-base-version-id': versionId } }) }), join(root, 'projects'))
  await expect(service.request({ operation: 'checkout', appId, versionId })).rejects.toThrow('Unsafe')
  expect(await readdir(join(root, 'projects'))).toEqual([])
})


it('reports an absent collection API without treating it as an empty catalog or creating source files', async () => {
  const root = await fixture()
  const service = new CloudWorkbenchService(async () => ({
    base: 'http://enterprise.test', connectionKey: key,
    response: Response.json({ detail: 'Not Found' }, { status: 404 })
  }), join(root, 'projects'))
  await expect(service.request({ operation: 'list' })).rejects.toThrow('CLOUD_WORKBENCH_API_UNAVAILABLE')
  expect(await readdir(root)).toEqual([])
})

it('does not label an authentication or upstream failure as an unsupported server', async () => {
  const root = await fixture()
  for (const status of [401, 403, 500]) {
    const service = new CloudWorkbenchService(async () => ({
      base: 'http://enterprise.test', connectionKey: key,
      response: Response.json({ status_code: status, status_message: 'Request rejected' }, { status })
    }), root)
    await expect(service.request({ operation: 'list' })).rejects.toThrow('Request rejected')
  }
})


it('restores the complete current enterprise toolkit in a new conversation without creating source', async () => {
  const root = await fixture()
  const calls: string[] = []
  const service = new CloudWorkbenchService(async path => {
    calls.push(path)
    return { base: 'https://enterprise.test/bisheng/', connectionKey: key, response: envelope({}) }
  }, root)
  expect(await service.request({ operation: 'guide' })).toEqual({
    guideUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/workbench-guide.md',
    toolkit: {
      workbenchGuideUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/workbench-guide.md',
      versionsUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/versions',
      sdkGuideUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/sdk-guide.md',
      sdkIndexUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/simple/',
      platformWiringUrl: 'https://enterprise.test/bisheng/api/v1/dev-toolkit/skills/platform-wiring'
    }
  })
  expect(calls).toEqual(['/api/v1/dev-toolkit/versions'])
  expect(await readdir(root)).toEqual([])
})


it.each([undefined, false, true, 'true'])('sends schema-change confirmation only for explicit boolean true (%s)', async confirmation => {
  const root = await fixture()
  let uploaded: FormData | undefined
  const service = new CloudWorkbenchService(async (path, init) => {
    if (path.endsWith('/deploy')) uploaded = init?.body as FormData
    return { base: 'https://enterprise.test', connectionKey: key,
      response: envelope({ app_id: appId, deployment_id: versionId }) }
  }, root)
  const project = await service.request({ operation: 'create' }) as { projectId: string; path: string }
  await writeFile(join(project.path, 'main.py'), 'print("ready")')
  await service.request({ operation: 'publish', projectId: project.projectId,
    ...(confirmation === undefined ? {} : { confirmSchemaChange: confirmation }) })
  expect(uploaded?.get('confirm_schema_change')).toBe(confirmation === true ? 'true' : null)
})

it('rejects an empty project before uploading or creating an application', async () => {
  const root = await fixture()
  const uploads: string[] = []
  const service = new CloudWorkbenchService(async path => {
    if (path.endsWith('/deploy')) uploads.push(path)
    return { base: 'https://enterprise.test', connectionKey: key, response: envelope({}) }
  }, root)
  const project = await service.request({ operation: 'create' }) as { projectId: string }
  await expect(service.request({ operation: 'publish', projectId: project.projectId })).rejects.toThrow('project is empty')
  expect(uploads).toEqual([])
})
