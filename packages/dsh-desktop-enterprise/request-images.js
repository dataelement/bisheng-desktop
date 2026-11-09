import {
  IMAGE_OFFLOAD_REQUIRED_CODE,
  LlmError,
  offloadedImageText,
  projectOffloadedImages,
  requiredImageOffload
} from '@deepseek-ai/dsh-llm'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_URL_LENGTH = 7_000_000
const MAX_TOTAL_URL_LENGTH = 28_000_000
export const MAX_BROKER_CHAT_BYTES = 32 * 1024 * 1024

export function projectEnterpriseOffloadedImages(messages) {
  return projectOffloadedImages(messages, offloadedImageText).map((message) => {
    if (!message.content.some((block) => block.type === 'tool-result')) return message
    return {
      ...message,
      content: message.content.map((block) => block.type !== 'tool-result' ? block : {
        ...block,
        content: projectOffloadedImages([{ content: block.content }], offloadedImageText)[0].content
      })
    }
  })
}

function imageBlocks(message) {
  return message.content.flatMap((block) => block.type === 'image' ? [block]
    : block.type === 'tool-result' ? block.content.filter((inner) => inner.type === 'image') : [])
}

function unsupported(message) {
  return new LlmError(message, 'UNSUPPORTED_CONTENT')
}

function offload(count) {
  throw new LlmError('Image request exceeds the size limit; offload the oldest retained images.',
    IMAGE_OFFLOAD_REQUIRED_CODE, { offloadImages: count })
}

function validImage(image) {
  if (!(image?.data instanceof Uint8Array)) return false
  const data = image.data
  switch (image.mediaType) {
    case 'image/png': return Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    case 'image/jpeg': return data[0] === 255 && data[1] === 216 && data[2] === 255
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(Buffer.from(data.subarray(0, 6)).toString('ascii'))
    case 'image/webp': return Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
    default: return false
  }
}

/** Count occurrences in wire order, while reading each immutable request version once. */
export async function readEnterpriseRequestImages(messages, readImage, signal) {
  const images = new Map()
  const occurrences = []
  for (const message of messages) {
    for (const block of imageBlocks(message)) {
      signal?.throwIfAborted()
      if (message.role !== 'user' && message.role !== 'tool') {
        throw unsupported('Image input is unavailable for this model or message role.')
      }
      const id = block.attachment.attachmentId
      if (!images.has(id)) {
        const image = await readImage?.(block.attachment, signal)
        signal?.throwIfAborted()
        if (!image) throw unsupported('Image attachment is unavailable.')
        if (!validImage(image)) throw unsupported('Image request has an invalid format.')
        const encodedLength = 4 * Math.ceil(image.data.byteLength / 3)
        images.set(id, {
          ...image,
          bytes: image.data.byteLength,
          // Match the broker's conservative base64 estimate, including padding.
          brokerBytes: Math.floor(encodedLength * 3 / 4),
          url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
        })
      }
      occurrences.push(block)
    }
  }
  // requiredImageOffload's public walker handles modern image blocks. Flatten
  // legacy tool-result blocks in the same order before applying that contract.
  const flat = [{ role: 'user', content: occurrences }]
  let count = Math.max(
    requiredImageOffload(flat, { representation: 'raw', maxBytes: MAX_TOTAL_BYTES }, (block) => images.get(block.attachment.attachmentId).brokerBytes),
    requiredImageOffload(flat, { representation: 'raw', maxBytes: MAX_TOTAL_URL_LENGTH }, (block) => images.get(block.attachment.attachmentId).url.length)
  )
  for (const [index, block] of occurrences.entries()) {
    const image = images.get(block.attachment.attachmentId)
    if (image.brokerBytes > MAX_IMAGE_BYTES || image.url.length > MAX_IMAGE_URL_LENGTH) count = Math.max(count, index + 1)
  }
  if (count > 0) {
    // The locked Harness recovery plugin projects modern user/tool events,
    // not the legacy nested tool-result representation.
    if (messages.some((message) => message.content.some((block) => block.type === 'tool-result' && block.content.some((inner) => inner.type === 'image')))) {
      throw unsupported('Legacy tool-result images exceed the request size limit and cannot be offloaded by this Harness.')
    }
    offload(count)
  }
  return images
}

/** Enforce the broker's complete JSON-envelope limit before any network I/O. */
export function enforceEnterpriseRequestSize(messages, serialize, attribution, envelope = {}) {
  const fits = (history) => Buffer.byteLength(JSON.stringify({ request: serialize(history), attribution, ...envelope })) <= MAX_BROKER_CHAT_BYTES
  if (fits(messages)) return
  if (messages.some((message) => message.content.some((block) => block.type === 'tool-result' && block.content.some((inner) => inner.type === 'image')))) {
    throw unsupported('Legacy tool-result images exceed the request size limit and cannot be offloaded by this Harness.')
  }
  const total = messages.reduce((count, message) => count + imageBlocks(message).length, 0)
  // This slow path is only for unusually large mixed text/image envelopes.
  // Find the first prefix that actually fits, including replacement text.
  for (let count = 1; count <= total; count++) {
    let index = 0
    const mark = (blocks) => blocks.map((block) => block.type === 'image'
      ? { ...block, offloaded: ++index <= count }
      : block.type === 'tool-result' ? { ...block, content: mark(block.content) } : block)
    const marked = messages.map((message) => ({ ...message, content: mark(message.content) }))
    if (fits(projectEnterpriseOffloadedImages(marked))) offload(count)
  }
  throw unsupported('Chat request exceeds the broker size limit even without retained images.')
}
