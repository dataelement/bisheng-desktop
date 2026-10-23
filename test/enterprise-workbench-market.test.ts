import { createHash } from 'node:crypto'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMarketRequest } from '../src/main/enterprise/enterprise-market'
import { etagDigest, releaseWorkbenchArtifact, rememberWorkbenchArtifact, verifyWorkbenchArtifactResponse, sweepWorkbenchVerifyDirectory } from '../src/main/enterprise/workbench-artifact'
import { parseWorkbenchDetail, parseWorkbenchListItem, createWorkbenchMarketController } from '../packages/dsh-desktop-enterprise/workbench-market.js'

const ID = '0123456789abcdef0123456789abcdef'
const VERSION = 'fedcba9876543210fedcba9876543210'
const LEGACY = 'abcdef0123456789abcdef0123456789'
const LEGACY_VERSION = '1234567890abcdef1234567890abcdef'

function repositoryItem(extra = {}) {
  return {
    id: ID, identity_kind: 'repository', workbench_key: 'cinderzhan/dsh-media-workbench', legacy_id: null,
    package_name: 'dsh-media-workbench', display_name: 'Media', description: '内容运营',
    current_version: { id: VERSION, version: '0.12.6' }, ...extra
  }
}

describe('enterprise workbench market request', () => {
  it('allows workbench catalog, detail, and artifact paths and rejects tenant selectors', () => {
    expect(parseMarketRequest({ path: '/api/v1/dsh/market/workbenches?page=1&size=20', connectionKey: 'tenant' }).binary).toBe(false)
    expect(parseMarketRequest({ path: `/api/v1/dsh/market/workbenches/${ID}`, connectionKey: 'tenant' }).binary).toBe(false)
    expect(parseMarketRequest({
      path: `/api/v1/dsh/market/workbenches/${ID}/versions/${VERSION}/artifact`, connectionKey: 'tenant'
    }).binary).toBe(true)
    expect(parseMarketRequest({ path: '/api/v1/dsh/market/catalog?q=a&page=1&size=20', connectionKey: 'tenant' }).path).toContain('/catalog')
    for (const path of [
      '/api/v1/dsh/market/workbenches?page=1&q=media',
      `/api/v1/dsh/market/workbenches/${ID}?tenant_id=2`,
      '/api/v1/dsh/market/workbenches/not-an-id'
    ]) {
      expect(() => parseMarketRequest({ path, connectionKey: 'tenant' })).toThrow('Unsupported enterprise market request.')
    }
    expect(() => parseMarketRequest({
      path: `/api/v1/dsh/market/workbenches/${ID}/versions/${VERSION}/artifact`, connectionKey: 'tenant', body: {}
    })).toThrow('Unsupported enterprise market request.')
  })
})

describe('enterprise workbench catalog parsing', () => {
  it('keeps repository and legacy identities and skips a malformed row without changing page progress', async () => {
    const pages = [
      { data: [repositoryItem(), { id: 'bad' }, { ...repositoryItem(), id: LEGACY, identity_kind: 'legacy', workbench_key: null, legacy_id: 'legacy-workbench', package_name: 'legacy-workbench', display_name: 'Legacy', current_version: { id: LEGACY_VERSION, version: '0.1.0' } }], total: 4 },
      { data: [repositoryItem({ description: 12 })], total: 4 }
    ]
    let page = 0
    const controller = createWorkbenchMarketController({
      state: () => ({ connected: true, connectionKey: 'account-a' }),
      marketRequest: async () => ({ status_code: 200, data: pages[page++] })
    })
    const result = await controller.catalog()
    expect(page).toBe(2)
    expect(result.status).toBe('ready')
    expect(result.skipped).toBe(1)
    expect(result.data.map(item => item.identityKind)).toEqual(['repository', 'legacy', 'repository'])
    const third = result.data[2]
    expect(third?.description).toBe('')
    expect(parseWorkbenchListItem({ ...repositoryItem(), workbench_key: 'owner/repo/extra' })).toBeNull()
  })

  it('fails the whole read when pages do not reach total and maps 404 to unavailable', async () => {
    const limited = createWorkbenchMarketController({
      state: () => ({ connected: true, connectionKey: 'account-a' }),
      marketRequest: async () => ({ status_code: 200, data: { data: [repositoryItem()], total: 99999 } })
    })
    await expect(limited.catalog()).rejects.toThrow('page limit exceeded')
    const missing = createWorkbenchMarketController({
      state: () => ({ connected: true, connectionKey: 'account-a' }),
      marketRequest: async () => { throw Object.assign(new Error('Enterprise market request failed (404).'), { status: 404 }) }
    })
    expect(await missing.catalog()).toMatchObject({ status: 'unavailable', data: [] })
  })

  it('rejects an artifact URL that does not match the detail identity', () => {
    const detail = parseWorkbenchDetail({
      ...repositoryItem(),
      current_version: {
        id: VERSION, version: '0.12.6', sha256: 'a'.repeat(64), size_bytes: 12,
        artifact_url: '/api/v1/dsh/market/workbenches/other/versions/other/artifact'
      }
    }, ID)
    expect(detail?.verifiable).toBe(false)
  })

  it('prepares a verified package for direct installation and drops it when the account changes', async () => {
    const sha256 = 'a'.repeat(64)
    const detail = {
      ...repositoryItem(),
      current_version: {
        id: VERSION, version: '0.12.6', sha256, size_bytes: 12,
        artifact_url: `/api/v1/dsh/market/workbenches/${ID}/versions/${VERSION}/artifact`
      }
    }
    const released: Array<[string, string]> = []
    let connected = { connected: true, connectionKey: 'account-a' }
    const controller = createWorkbenchMarketController({
      state: () => connected,
      marketRequest: async () => ({ status_code: 200, data: detail }),
      materializeWorkbenchArtifact: async () => ({ ok: true, path: '/tmp/enterprise-workbench.tgz', ticket: '11111111-1111-1111-1111-111111111111', connectionKey: 'account-a' }),
      releaseWorkbenchArtifact: async (ticket: string, connectionKey: string) => { released.push([ticket, connectionKey]) }
    })
    await expect(controller.packageForInstall(ID)).resolves.toMatchObject({
      path: '/tmp/enterprise-workbench.tgz', packageName: 'dsh-media-workbench', version: '0.12.6', connectionKey: 'account-a'
    })
    let releaseMaterialize: (value: { ok: boolean, path: string, ticket: string, connectionKey: string }) => void = () => undefined
    let materializeStarted: () => void = () => undefined
    const untilMaterialize = new Promise<void>(resolve => { materializeStarted = resolve })
    const changing = createWorkbenchMarketController({
      state: () => connected,
      marketRequest: async () => ({ status_code: 200, data: detail }),
      materializeWorkbenchArtifact: () => {
        materializeStarted()
        return new Promise(resolve => { releaseMaterialize = resolve })
      },
      releaseWorkbenchArtifact: async (ticket: string, connectionKey: string) => { released.push([ticket, connectionKey]) }
    })
    const pending = changing.packageForInstall(ID)
    await untilMaterialize
    connected = { connected: true, connectionKey: 'account-b' }
    changing.stop()
    releaseMaterialize({ ok: true, path: '/tmp/enterprise-workbench.tgz', ticket: '22222222-2222-2222-2222-222222222222', connectionKey: 'account-a' })
    await expect(pending).rejects.toThrow('Enterprise account changed.')
    expect(released).toEqual([['22222222-2222-2222-2222-222222222222', 'account-a']])
  })

  it('drops an in-flight catalog when the account changes', async () => {
    let connected = { connected: true, connectionKey: 'account-a' }
    let release: () => void = () => undefined
    const controller = createWorkbenchMarketController({
      state: () => connected,
      marketRequest: () => new Promise(resolve => { release = () => resolve({ status_code: 200, data: { data: [], total: 0 } }) })
    })
    const pending = controller.catalog()
    connected = { connected: true, connectionKey: 'account-b' }
    controller.stop()
    release()
    await expect(pending).rejects.toThrow('Enterprise account changed.')
  })
})

describe('enterprise workbench artifact verification', () => {
  it('checks size, sha256, and ETag, then deletes the temporary file', async () => {
    const bytes = Buffer.from('enterprise-workbench-package')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-wb-verify-'))
    const response = new Response(bytes, { headers: { etag: `"${sha256}"`, 'content-length': String(bytes.length) } })
    expect(etagDigest(response.headers.get('etag'))).toBe(sha256)
    await expect(verifyWorkbenchArtifactResponse(response, { expectedSha256: sha256, expectedSize: bytes.length, directory })).resolves.toEqual({ ok: true })
    expect(await readdir(directory)).toEqual([])
    await sweepWorkbenchVerifyDirectory(directory)
  })

  it('rejects a mismatched digest and does not keep the file', async () => {
    const bytes = Buffer.from('damaged')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-wb-verify-'))
    const response = new Response(bytes, { headers: { etag: `"${'b'.repeat(64)}"`, 'content-length': String(bytes.length) } })
    const result = await verifyWorkbenchArtifactResponse(response, { expectedSha256: 'b'.repeat(64), expectedSize: bytes.length, directory })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('sha256')
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps a verified package until installation releases it', async () => {
    const bytes = Buffer.from('enterprise-workbench-package')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-wb-install-'))
    const response = new Response(bytes, { headers: { etag: `"${sha256}"`, 'content-length': String(bytes.length) } })
    const result = await verifyWorkbenchArtifactResponse(response, { expectedSha256: sha256, expectedSize: bytes.length, directory, retain: true })
    expect(result.ok).toBe(true)
    expect(result.path).toMatch(/\.tgz$/u)
    const ticket = rememberWorkbenchArtifact(result.path ?? '', 'account-a')
    expect(await readdir(directory)).toEqual([result.path?.split('/').at(-1)])
    await sweepWorkbenchVerifyDirectory(directory)
    expect(await readdir(directory)).toEqual([result.path?.split('/').at(-1)])
    await releaseWorkbenchArtifact(ticket, 'account-b')
    expect(await readdir(directory)).toEqual([result.path?.split('/').at(-1)])
    await releaseWorkbenchArtifact(ticket, 'account-a')
    expect(await readdir(directory)).toEqual([])
  })
})
