import test from 'node:test'
import assert from 'node:assert/strict'

// Needs the api backend with a fake model that throws; no network is ever used (the client is replaced before the call).
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.FORCE_MOCK = ''
const { modelEvents, setClientForTests } = await import('../server/agent/provider.js')

const params = { system: 'x', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [] }

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('API error before the answer falls back to the stand-in and reports a reason, never the raw error', async () => {
  setClientForTests({ messages: { create: async () => { throw Object.assign(new Error('credit balance is too low'), { status: 400 }) } } })
  const meta = {}
  const events = await collect(modelEvents(params, { meta }))
  assert.equal(meta.fallbackReason, 'live API unavailable')
  assert.equal(events.at(-1).type, 'message_stop')
  assert.ok(!JSON.stringify(events).includes('credit balance'))
})

test('a timeout falls back the same way', async () => {
  setClientForTests({ messages: { create: async () => { throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }) } } })
  const meta = {}
  await collect(modelEvents(params, { meta }))
  assert.equal(meta.fallbackReason, 'live API unavailable')
})

test('a client abort is not hidden as a fallback', async () => {
  const ctl = new AbortController()
  ctl.abort()
  setClientForTests({ messages: { create: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) } } })
  await assert.rejects(collect(modelEvents(params, { signal: ctl.signal, meta: {} })), { name: 'AbortError' })
})

test('forceMock (cap reached) never touches the model', async () => {
  setClientForTests({ messages: { create: async () => { throw new Error('must not be called') } } })
  const meta = {}
  const events = await collect(modelEvents(params, { forceMock: true, meta }))
  assert.equal(meta.fallbackReason, undefined)
  assert.equal(events.at(-1).type, 'message_stop')
})
