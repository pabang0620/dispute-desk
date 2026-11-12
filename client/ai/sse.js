// Read a server-sent-event response as an async iterator of JSON frames.
export async function* readFrames(response, signal) {
  if (!response.ok || !response.body) throw new Error(`Server returned ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const line = raw.split('\n').find((l) => l.startsWith('data:'))
        if (line) yield JSON.parse(line.slice(5).trim())
      }
    }
  } finally {
    reader.releaseLock?.()
  }
}
