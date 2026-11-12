import { readFrames } from './sse.js'
import { noteAiSource } from '../store.js'

// AgLlmAdapter for Claude. AG Studio ships no model connection; this one sends each turn to our server
// (/api/studio/llm), which calls the Anthropic Messages API and answers with AG-UI events. The key never reaches the browser.
function createQueue() {
  const items = []
  let wake = null
  let closed = false
  return {
    push(item) {
      items.push(item)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) yield items.shift()
        else if (closed) return
        else await new Promise((r) => (wake = r))
        wake = null
      }
    },
  }
}

export function claudeAdapter({ endpoint = '/api/studio/llm' } = {}) {
  return {
    // Must return the handler synchronously: the stream fills while the request is in flight.
    executeTurn(request, options) {
      const queue = createQueue()
      let resolveComplete
      const complete = new Promise((resolve) => {
        resolveComplete = resolve
      })
      ;(async () => {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            signal: options?.signal,
            body: JSON.stringify({
              input: request.input,
              instructions: request.instructions,
              tools: request.tools?.map(({ name, description, parameters, kind }) => ({ name, description, parameters, kind })),
              toolChoice: request.toolChoice,
              responseFormat: request.responseFormat,
              model: request.model,
            }),
          })
          let finished = false
          for await (const frame of readFrames(res, options?.signal)) {
            if (frame.kind === 'event') queue.push(frame.event)
            else if (frame.kind === 'source') noteAiSource(frame)
            else if (frame.kind === 'complete') {
              finished = true
              resolveComplete(frame.response)
            } else if (frame.kind === 'error') throw new Error(frame.message)
          }
          if (!finished) throw new Error('The model connection ended before the turn finished.')
        } catch (err) {
          const message = err?.name === 'AbortError' ? 'Cancelled' : err.message
          resolveComplete({ id: `err_${Date.now()}`, createdAt: Date.now(), status: err?.name === 'AbortError' ? 'cancelled' : 'failed', error: { code: 'adapter_error', message }, output: [] })
        } finally {
          queue.close()
        }
      })()
      return { stream: queue, complete }
    },
  }
}
