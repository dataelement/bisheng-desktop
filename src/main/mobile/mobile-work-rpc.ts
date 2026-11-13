import { randomUUID } from 'node:crypto'

/** A phone RPC body stays under the bridge limit, so each chunk is smaller. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const MAX_CHUNK_BYTES = 32 * 1024
const UPLOAD_TTL_MS = 2 * 60 * 1000

const WORK_JSON_METHODS = new Set(['work.skills', 'work.tools', 'work.knowledge'])

export type WorkDispatch =
  | { kind: 'json'; path: string; body: Record<string, unknown> }
  | { kind: 'office'; payload: Record<string, unknown> }
  | { kind: 'ppt'; endpoint: string; payload: Record<string, unknown> }
  | { kind: 'upload-start' }
  | { kind: 'upload-chunk' }
  | { kind: 'upload-finish' }

export function isWorkRpcMethod(method: string): boolean {
  return (
    WORK_JSON_METHODS.has(method) ||
    method === 'office.call' ||
    method === 'ppt.call' ||
    method === 'session.uploadStart' ||
    method === 'session.uploadChunk' ||
    method === 'session.uploadFinish'
  )
}

export function parseWorkDispatch(
  method: string,
  payload: unknown
): WorkDispatch | { error: string } {
  if (method === 'work.skills') return parseSkills(payload)
  if (method === 'work.tools') return parseTools(payload)
  if (method === 'work.knowledge') return parseKnowledge(payload)
  if (method === 'office.call') return parseOffice(payload)
  if (method === 'ppt.call') return parsePpt(payload)
  if (method === 'session.uploadStart') return { kind: 'upload-start' }
  if (method === 'session.uploadChunk') return { kind: 'upload-chunk' }
  if (method === 'session.uploadFinish') return { kind: 'upload-finish' }
  return { error: 'RPC method is not available on mobile.' }
}

function parseSkills(payload: unknown): WorkDispatch | { error: string } {
  const body = record(payload)
  if (body === undefined) return { error: 'Invalid skill request.' }
  const operation = body.operation
  if (operation === 'catalog') {
    return { kind: 'json', path: '/api/enterprise.work-skills', body: { operation } }
  }
  if (operation !== 'validate') return { error: 'Unknown skill operation.' }
  const names = stringList(body.names, 'skill')
  if (typeof names !== 'object' || !Array.isArray(names)) return names
  return {
    kind: 'json',
    path: '/api/enterprise.work-skills',
    body: { operation, names }
  }
}

function parseTools(payload: unknown): WorkDispatch | { error: string } {
  const body = record(payload)
  if (body === undefined) return { error: 'Invalid tool request.' }
  const operation = body.operation
  if (operation === 'catalog') {
    return { kind: 'json', path: '/api/enterprise.work-tools', body: { operation } }
  }
  if (operation !== 'validate') return { error: 'Unknown tool operation.' }
  const names = stringList(body.names, 'tool')
  if (!Array.isArray(names)) return names
  const connectionKey = boundedString(body.connectionKey, 512)
  if (connectionKey === undefined) return { error: 'Invalid tool connection.' }
  return {
    kind: 'json',
    path: '/api/enterprise.work-tools',
    body: { operation, names, connectionKey }
  }
}

function parseKnowledge(payload: unknown): WorkDispatch | { error: string } {
  const body = record(payload)
  if (body === undefined) return { error: 'Invalid resource request.' }
  const operation = body.operation
  if (operation !== 'catalog' && operation !== 'get' && operation !== 'select') {
    return { error: 'Unknown resource operation.' }
  }
  const request: Record<string, unknown> = { operation }
  if (body.sessionId !== undefined) {
    const sessionId = sessionIdOf(body.sessionId)
    if (sessionId === undefined) return { error: 'Choose an active session.' }
    request.sessionId = sessionId
  } else if (operation !== 'catalog') {
    return { error: 'Choose an active session.' }
  }
  if (operation === 'select') {
    const spaceIds = spaceIdList(body.spaceIds)
    if (!Array.isArray(spaceIds)) return spaceIds
    request.spaceIds = spaceIds
  }
  return { kind: 'json', path: '/api/enterprise.work-resources', body: request }
}

function parseOffice(payload: unknown): WorkDispatch | { error: string } {
  const body = record(payload)
  if (body === undefined) return { error: 'Use a bounded Office request.' }
  const endpoint = body.endpoint
  if (
    endpoint !== 'catalog' &&
    endpoint !== 'state' &&
    endpoint !== 'mode' &&
    endpoint !== 'select' &&
    endpoint !== 'deselect'
  ) {
    return { error: 'Unknown Office operation.' }
  }
  const request: Record<string, unknown> = { endpoint }
  if (endpoint !== 'catalog' || body.sessionId !== undefined) {
    if (endpoint !== 'catalog') {
      const sessionId = sessionIdOf(body.sessionId)
      if (sessionId === undefined) return { error: 'Choose an active session.' }
      request.sessionId = sessionId
    } else if (body.sessionId !== undefined) {
      const sessionId = sessionIdOf(body.sessionId)
      if (sessionId === undefined) return { error: 'Choose an active session.' }
      request.sessionId = sessionId
    }
  }
  if (endpoint === 'mode') {
    if (body.mode !== null && body.mode !== 'word' && body.mode !== 'excel') {
      return { error: 'Unknown Office mode.' }
    }
    request.mode = body.mode
  }
  if (endpoint === 'select') {
    const templateId = boundedString(body.templateId, 128)
    if (templateId === undefined) return { error: 'Choose an Office example.' }
    if (typeof body.revision !== 'string' && typeof body.revision !== 'number') {
      return { error: 'Choose an Office example.' }
    }
    request.templateId = templateId
    request.revision = body.revision
  }
  return { kind: 'office', payload: request }
}

function parsePpt(payload: unknown): WorkDispatch | { error: string } {
  const body = record(payload)
  if (body === undefined) return { error: 'Invalid PPT request.' }
  const endpoint = body.endpoint
  if (
    endpoint !== 'template/catalog' &&
    endpoint !== 'state' &&
    endpoint !== 'presentation/mode' &&
    endpoint !== 'template/select' &&
    endpoint !== 'template/deselect'
  ) {
    return { error: 'Unknown PPT operation.' }
  }
  const request: Record<string, unknown> = {}
  if (endpoint !== 'template/catalog') {
    const sessionId = sessionIdOf(body.sessionId)
    if (sessionId === undefined) return { error: 'Choose an active session.' }
    request.sessionId = sessionId
  }
  if (endpoint === 'presentation/mode') {
    if (body.mode !== null && body.mode !== 'ppt') return { error: 'Unknown PPT mode.' }
    request.mode = body.mode
  }
  if (endpoint === 'template/select') {
    const templateId = boundedString(body.templateId, 128)
    if (templateId === undefined) return { error: 'Choose a PPT example.' }
    request.templateId = templateId
    request.mode = 'ppt'
  }
  return { kind: 'ppt', endpoint, payload: request }
}

export function readWorkJson(status: number, text: string): {
  ok: boolean
  value?: unknown
  error?: string
} {
  let parsed: unknown
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    return { ok: false, error: `Harness transport returned HTTP ${status}.` }
  }
  const body = record(parsed)
  const message = body === undefined ? undefined : boundedString(body.error, 500)
  if (status < 200 || status >= 300) {
    return { ok: false, error: message ?? `Harness transport returned HTTP ${status}.` }
  }
  if (message !== undefined) return { ok: false, error: message }
  return { ok: true, value: parsed }
}

export function readUploadResult(
  status: number,
  text: string
): { ok: boolean; value?: { receiptId: string }; error?: string } {
  const parsed = readWorkJson(status, text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const body = record(parsed.value)
  if (body?.ok === false) {
    const error = record(body.error)
    const message = error === undefined ? undefined : boundedString(error.message, 500)
    return { ok: false, error: message ?? 'Harness rejected the upload.' }
  }
  const value = record(body?.ok === true ? body.value : body)
  const receiptId = value === undefined ? undefined : boundedString(value.receiptId, 80)
  if (receiptId === undefined) return { ok: false, error: 'Harness returned an invalid upload receipt.' }
  return { ok: true, value: { receiptId } }
}

export function readWorkEnvelope(
  text: string,
  rpcId: string
): { ok: boolean; value?: unknown; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Harness returned invalid JSON.' }
  }
  const envelope = record(parsed)
  if (envelope === undefined || envelope.rpcId !== rpcId) {
    return { ok: false, error: 'Harness RPC response did not match the request.' }
  }
  const result = record(envelope.result)
  if (result?.ok !== true) {
    const error = record(result?.error)
    const message = error === undefined ? undefined : boundedString(error.message, 500)
    return { ok: false, error: message ?? 'Harness rejected the request.' }
  }
  const value = record(result.value)
  if (value?.status === 'error') {
    const error = record(value.error)
    const message = error === undefined ? undefined : boundedString(error.message, 500)
    return { ok: false, error: message ?? 'Harness rejected the request.' }
  }
  if (value?.status === 'ok') return { ok: true, value: value.data }
  return { ok: true, value: result.value }
}

interface UploadSlot {
  sessionId: string
  name: string
  totalBytes: number
  received: number
  nextIndex: number
  chunks: Buffer[]
  updatedAt: number
}

/** Reassembles one phone upload, then the bridge posts the bytes once. */
export class MobileWorkUploads {
  private readonly slots = new Map<string, UploadSlot>()

  start(
    payload: unknown,
    now: number
  ): { ok: true; value: { uploadId: string } } | { ok: false; error: string } {
    this.sweep(now)
    const body = record(payload)
    if (body === undefined) return { ok: false, error: 'Invalid upload.' }
    const sessionId = sessionIdOf(body.sessionId)
    const name = fileNameOf(body.name)
    if (sessionId === undefined || name === undefined) return { ok: false, error: 'Invalid upload.' }
    if (typeof body.totalBytes !== 'number' || !Number.isSafeInteger(body.totalBytes)) {
      return { ok: false, error: 'Invalid upload.' }
    }
    if (body.totalBytes < 1 || body.totalBytes > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'The attachment is too large.' }
    }
    const uploadId = randomUUID()
    this.slots.set(uploadId, {
      sessionId,
      name,
      totalBytes: body.totalBytes,
      received: 0,
      nextIndex: 0,
      chunks: [],
      updatedAt: now
    })
    return { ok: true, value: { uploadId } }
  }

  chunk(payload: unknown, now: number): { ok: true; value: { received: number } } | { ok: false; error: string } {
    this.sweep(now)
    const body = record(payload)
    if (body === undefined) return { ok: false, error: 'Invalid upload chunk.' }
    const uploadId = boundedString(body.uploadId, 80)
    const slot = uploadId === undefined ? undefined : this.slots.get(uploadId)
    if (uploadId === undefined || slot === undefined) {
      return { ok: false, error: 'The upload expired.' }
    }
    if (body.index !== slot.nextIndex) return { ok: false, error: 'Invalid upload chunk.' }
    if (typeof body.data !== 'string') return { ok: false, error: 'Invalid upload chunk.' }
    const bytes = decodeChunk(body.data)
    if (bytes === undefined) return { ok: false, error: 'Invalid upload chunk.' }
    if (slot.received + bytes.length > slot.totalBytes) {
      this.slots.delete(uploadId)
      return { ok: false, error: 'The attachment is too large.' }
    }
    slot.chunks.push(bytes)
    slot.received += bytes.length
    slot.nextIndex += 1
    slot.updatedAt = now
    return { ok: true, value: { received: slot.received } }
  }

  finish(
    payload: unknown,
    now: number
  ):
    | { ok: true; value: { sessionId: string; name: string; body: Buffer } }
    | { ok: false; error: string } {
    this.sweep(now)
    const body = record(payload)
    const uploadId = body === undefined ? undefined : boundedString(body.uploadId, 80)
    const slot = uploadId === undefined ? undefined : this.slots.get(uploadId)
    if (slot === undefined || uploadId === undefined) return { ok: false, error: 'The upload expired.' }
    if (slot.received !== slot.totalBytes) {
      return { ok: false, error: 'The attachment is incomplete.' }
    }
    this.slots.delete(uploadId)
    return {
      ok: true,
      value: { sessionId: slot.sessionId, name: slot.name, body: Buffer.concat(slot.chunks) }
    }
  }

  clear(): void {
    this.slots.clear()
  }

  private sweep(now: number): void {
    for (const [uploadId, slot] of this.slots) {
      if (now - slot.updatedAt > UPLOAD_TTL_MS) this.slots.delete(uploadId)
    }
  }
}

function decodeChunk(data: string): Buffer | undefined {
  if (data.length === 0 || data.length > ((MAX_CHUNK_BYTES + 2) * 4) / 3 + 4) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_CHUNK_BYTES) return undefined
  if (bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '')) return undefined
  return bytes
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function sessionIdOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return undefined
  if (/[\u0000-\u001f\u007f/\\]/.test(value)) return undefined
  return value
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > max) return undefined
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined
  return trimmed
}

function fileNameOf(value: unknown): string | undefined {
  const name = boundedString(value, 180)
  if (name === undefined || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return undefined
  }
  return name
}

function stringList(value: unknown, label: string): string[] | { error: string } {
  if (!Array.isArray(value) || value.length > 50) return { error: `Invalid ${label} selection.` }
  const names: string[] = []
  for (const item of value) {
    const name = boundedString(item, 200)
    if (name === undefined) return { error: `Invalid ${label} selection.` }
    names.push(name)
  }
  return names
}

function spaceIdList(value: unknown): number[] | { error: string } {
  if (!Array.isArray(value) || value.length > 50) return { error: 'Invalid knowledge space selection.' }
  const ids: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      return { error: 'Invalid knowledge space selection.' }
    }
    ids.push(item)
  }
  return ids
}
