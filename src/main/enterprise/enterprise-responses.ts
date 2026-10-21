import { pickAttributionHeaders, validateChatImages } from './enterprise-chat'

const KEYS = new Set(['model', 'input', 'stream', 'store', 'include', 'tools', 'tool_choice', 'parallel_tool_calls', 'max_output_tokens', 'temperature', 'top_p', 'reasoning', 'text'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw Object.assign(new Error('Invalid enterprise Responses request.'), { status: 400 })
}

export function parseEnterpriseResponsesPayload(value: unknown) {
  if (!record(value) || Object.keys(value).some((key) => !['request', 'attribution', 'connectionKey'].includes(key)) || !record(value.request)) invalid()
  const request = value.request
  if (Object.keys(request).some((key) => !KEYS.has(key)) ||
      typeof request.model !== 'string' || !/^bisheng:[1-9][0-9]*$/.test(request.model) ||
      request.stream !== true || request.store !== false ||
      !Array.isArray(request.include) || request.include.length !== 1 || request.include[0] !== 'reasoning.encrypted_content' ||
      !Array.isArray(request.input) || request.input.length === 0 || request.input.length > 4096 ||
      typeof value.connectionKey !== 'string' || !/^[a-f0-9]{16}$/.test(value.connectionKey)) invalid()
  const images: Array<{ content: unknown[] }> = []
  for (const item of request.input) {
    if (!record(item) || !['message', 'reasoning', 'function_call', 'function_call_output'].includes(String(item.type))) invalid()
    const blocks = item.type === 'function_call_output' ? item.output : item.content
    if (Array.isArray(blocks)) {
      for (const part of blocks) {
        if (!record(part)) invalid()
        if (part.type === 'input_image') images.push({ content: [{ type: 'image_url', image_url: { url: part.image_url } }] })
      }
    }
  }
  validateChatImages(images)
  return {
    request,
    model: request.model,
    attribution: pickAttributionHeaders(value.attribution),
    connectionKey: value.connectionKey,
    protocol: 'responses' as const
  }
}
