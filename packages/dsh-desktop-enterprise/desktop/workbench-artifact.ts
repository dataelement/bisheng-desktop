import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

export const WORKBENCH_ARTIFACT_LIMIT = 512 * 1024 * 1024
const activeFiles = new Set<string>()
const retainedArtifacts = new Map<string, { path: string, connectionKey: string }>()

export function workbenchVerifyDirectory(): string {
  return join(tmpdir(), 'dsh-enterprise-workbench-verify')
}

export function etagDigest(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^W\//u, '').replaceAll('"', '').toLowerCase()
}

export async function sweepWorkbenchVerifyDirectory(directory = workbenchVerifyDirectory()): Promise<void> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return
  }
  await Promise.all(names.map(async (name) => {
    const path = join(directory, name)
    if (activeFiles.has(path)) return
    await rm(path, { force: true }).catch(() => undefined)
  }))
}

export interface WorkbenchVerifyResult {
  ok: boolean
  path?: string
  stage?: string
  error?: string
}

export function rememberWorkbenchArtifact(path: string, connectionKey: string): string {
  const ticket = randomUUID()
  activeFiles.add(path)
  retainedArtifacts.set(ticket, { path, connectionKey })
  return ticket
}

export async function releaseWorkbenchArtifact(ticket: string, connectionKey: string): Promise<void> {
  const retained = retainedArtifacts.get(ticket)
  if (!retained || retained.connectionKey !== connectionKey) return
  retainedArtifacts.delete(ticket)
  activeFiles.delete(retained.path)
  await rm(retained.path, { force: true }).catch(() => undefined)
}

export async function discardWorkbenchArtifact(path: string): Promise<void> {
  activeFiles.delete(path)
  await rm(path, { force: true }).catch(() => undefined)
}

function failed(stage: string, error: string): WorkbenchVerifyResult {
  return { ok: false, stage, error }
}

export async function verifyWorkbenchArtifactResponse(
  response: Response,
  options: {
    expectedSha256: string
    expectedSize: number
    directory?: string
    retain?: boolean
    signal?: AbortSignal
    assertConnection?: () => void
  }
): Promise<WorkbenchVerifyResult> {
  const expectedSha256 = options.expectedSha256
  const expectedSize = options.expectedSize
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256) || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > WORKBENCH_ARTIFACT_LIMIT) {
    await response.body?.cancel().catch(() => undefined)
    return failed('detail', 'Workbench artifact metadata is not verifiable.')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return failed('http', `Enterprise workbench artifact request failed (${response.status}).`)
  }
  if (etagDigest(response.headers.get('etag')) !== expectedSha256) {
    await response.body?.cancel().catch(() => undefined)
    return failed('etag', 'Workbench artifact ETag does not match the published digest.')
  }
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised !== expectedSize) {
    await response.body?.cancel().catch(() => undefined)
    return failed('size', 'Workbench artifact length does not match the published size.')
  }
  const directory = options.directory ?? workbenchVerifyDirectory()
  try {
    const space = await statfs(directory).catch(async () => {
      await mkdir(directory, { recursive: true })
      return statfs(directory)
    })
    if (Number(space.bavail) * Number(space.bsize) < expectedSize) {
      await response.body?.cancel().catch(() => undefined)
      return failed('disk', 'Not enough temporary disk space to verify the workbench artifact.')
    }
  } catch {
    await mkdir(directory, { recursive: true }).catch(() => undefined)
  }
  if (!response.body) return failed('http', 'Enterprise workbench artifact response was empty.')
  const body = response.body
  const path = join(directory, `${randomUUID()}.part`)
  activeFiles.add(path)
  const hash = createHash('sha256')
  const file = createWriteStream(path, { flags: 'wx' })
  const reader = body.getReader()
  let received = 0
  try {
    while (true) {
      if (options.signal?.aborted) return failed('cancelled', 'Workbench artifact verification was cancelled.')
      options.assertConnection?.()
      const chunk = await reader.read()
      if (chunk.done) break
      const bytes = Buffer.from(chunk.value)
      received += bytes.length
      if (received > expectedSize || received > WORKBENCH_ARTIFACT_LIMIT) {
        await reader.cancel().catch(() => undefined)
        return failed('size', 'Workbench artifact exceeded the published size.')
      }
      hash.update(bytes)
      if (!file.write(bytes)) await once(file, 'drain')
    }
    file.end()
    await once(file, 'finish')
    if (received !== expectedSize) return failed('size', 'Workbench artifact length does not match the published size.')
    if (hash.digest('hex') !== expectedSha256) return failed('sha256', 'Workbench artifact digest does not match the published digest.')
    if (options.retain) {
      const kept = join(directory, `${randomUUID()}.tgz`)
      await rename(path, kept)
      activeFiles.add(kept)
      return { ok: true, path: kept }
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workbench artifact verification failed.'
    if (message.includes('account changed') || message.includes('Enterprise account changed')) return failed('account', message)
    return failed(options.signal?.aborted ? 'cancelled' : 'download', message)
  } finally {
    file.destroy()
    activeFiles.delete(path)
    await rm(path, { force: true }).catch(() => undefined)
  }
}
