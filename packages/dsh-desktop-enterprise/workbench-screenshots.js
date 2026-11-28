import { createHash } from 'node:crypto'

const HEX_ID = /^[a-f0-9]{32}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const SCREENSHOT_LIMIT = 5 * 1024 * 1024

/**
 * Validate untrusted catalog metadata before it can authorize an image request.
 * @param {unknown} value
 * @param {string} id Workbench identity, already validated by the catalog parser.
 * @param {string} versionId Current published version identity.
 */
// Compare literal paths: normalization could conceal a different resource scope.
export function parseWorkbenchScreenshots(value, id, versionId) {
  if (!Array.isArray(value) || value.length > 8) return []
  const seen = new Set()
  let total = 0
  const images = []
  for (const image of value) {
    if (!image || typeof image !== 'object' || !SHA256.test(image.id) || seen.has(image.id)
      || image.url !== `/api/v1/dsh/market/workbenches/${id}/versions/${versionId}/screenshots/${image.id}`
      || !SHA256.test(image.sha256) || !TYPES.has(image.media_type)
      || !Number.isSafeInteger(image.bytes) || image.bytes < 1 || image.bytes > SCREENSHOT_LIMIT
      || !Number.isSafeInteger(image.width) || image.width < 1
      || !Number.isSafeInteger(image.height) || image.height < 1 || image.width * image.height > 16_000_000
      || typeof image.alt !== 'string' || image.alt.length > 2000) return []
    seen.add(image.id)
    total += image.bytes
    if (total > 20 * 1024 * 1024) return []
    images.push({ id: image.id, url: image.url, sha256: image.sha256, media_type: image.media_type,
      width: image.width, height: image.height, bytes: image.bytes, alt: image.alt })
  }
  return images
}

export function validScreenshotIdentity(id, versionId, imageId) {
  return HEX_ID.test(id) && HEX_ID.test(versionId) && SHA256.test(imageId)
}

/**
 * Read only the declared raster media type and byte length; never buffer an
 * unbounded upstream response. Authentication and redirect rejection belong
 * to the existing enterprise request transport that supplies this response.
 * @param {Response} response
 * @param {AbortSignal | undefined} signal
 * @param {import('./workbench-market.js').EnterpriseWorkbenchScreenshot} image
 */
export async function readScreenshotResponse(response, signal, image) {
  if (!response.ok) throw Object.assign(new Error('Workbench screenshot request failed.'), { status: response.status })
  if (response.headers.get('content-type')?.split(';')[0].trim() !== image.media_type) {
    await response.body?.cancel()
    throw Object.assign(new Error('Invalid screenshot media type.'), { status: 502 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body || []) {
    signal?.throwIfAborted()
    size += chunk.length
    if (size > image.bytes || size > SCREENSHOT_LIMIT) throw Object.assign(new Error('Screenshot size limit exceeded.'), { status: 502 })
    chunks.push(chunk)
  }
  return verifyScreenshotBytes(Buffer.concat(chunks), image)
}

export function verifyScreenshotBytes(bytes, image) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== image.bytes
    || createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
    throw Object.assign(new Error('Workbench screenshot integrity check failed.'), { status: 502 })
  }
  return bytes
}
