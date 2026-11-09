/** Observe consumption without buffering or reading ahead of the plugin. */
export function observeRequestResponse(response, signal, settle) {
  if (!response.ok) {
    settle(new Error(`Enterprise request failed (${response.status}).`))
    return response
  }
  if (!response.body) {
    settle()
    return response
  }
  const reader = response.body.getReader()
  let ended = false
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (ended) return
        if (chunk.done) {
          ended = true
          reader.releaseLock()
          if (!signal.aborted) settle()
          controller.close()
        } else controller.enqueue(chunk.value)
      } catch (error) {
        if (ended) return
        ended = true
        reader.releaseLock()
        if (!signal.aborted) settle(error)
        controller.error(error)
      }
    },
    async cancel(reason) {
      ended = true
      try { await reader.cancel(reason) } finally { reader.releaseLock() }
    }
  }, { highWaterMark: 0 })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
