import test from 'node:test'
import assert from 'node:assert/strict'

process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.FORCE_MOCK = ''
const { modelEvents, setClientForTests, syntheticEvents } = await import('../server/agent/provider.js')

const TOOLS = [{ name: 'respond', description: 'answer', input_schema: { type: 'object', properties: {} } }]
const base = { system: 'x', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: TOOLS }

const message = (content) => ({ id: 'm1', type: 'message', role: 'assistant', model: 'm', content, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
const textMsg = message([{ type: 'text', text: 'plain words' }])
const toolMsg = message([{ type: 'tool_use', id: 't1', name: 'respond', input: { ok: true } }])

async function collect(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

// Fake API: 400 on any forced tool_choice, like the real one for this model. Replies come from the queue.
function fakeApi(replies) {
  const seen = []
  setClientForTests({
    messages: {
      create: async (body) => {
        seen.push(body)
        if (body.tool_choice && body.tool_choice.type !== 'auto') throw Object.assign(new Error('tool_choice not supported'), { status: 400 })
        const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
        return body.stream ? syntheticEvents(reply) : reply
      },
    },
  })
  return seen
}

const names = (events) => events.filter((e) => e.type === 'content_block_start').map((e) => e.content_block.name || e.content_block.type)

for (const choice of [{ type: 'tool', name: 'respond' }, { type: 'any' }]) {
  test(`no request carries a forced tool_choice (${choice.type})`, async () => {
    const seen = fakeApi([toolMsg])
    const meta = {}
    const events = await collect(modelEvents({ ...base, tool_choice: choice }, { meta }))
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].tool_choice, { type: 'auto' })
    assert.match(JSON.stringify(seen[0].system), /You must (answer by calling the tool respond|call one of the tools)/)
    assert.equal(meta.fallbackReason, undefined)
    assert.deepEqual(names(events), ['respond'])
  })
}

test('a model that answers in text once is retried with the instruction repeated', async () => {
  const seen = fakeApi([textMsg, toolMsg])
  const meta = {}
  const events = await collect(modelEvents({ ...base, tool_choice: { type: 'tool', name: 'respond' } }, { meta }))
  assert.equal(seen.length, 2)
  assert.ok(seen.every((b) => b.tool_choice.type === 'auto'))
  const note = 'You must answer by calling the tool respond.'
  assert.equal(seen[1].system.split(note).length - 1, 2)
  assert.equal(meta.fallbackReason, undefined)
  assert.deepEqual(names(events), ['respond'])
})

test('a model that never calls the tool ends in the labelled stand-in', async () => {
  const seen = fakeApi([textMsg])
  const meta = {}
  const events = await collect(modelEvents({ ...base, tool_choice: { type: 'tool', name: 'respond' } }, { meta }))
  assert.equal(seen.length, 2)
  assert.equal(meta.fallbackReason, 'model did not call the required tool')
  assert.equal(events.at(-1).type, 'message_stop')
})

test('auto choice is sent once and unchanged', async () => {
  const seen = fakeApi([textMsg])
  await collect(modelEvents({ ...base, tool_choice: { type: 'auto' } }, { meta: {} }))
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].tool_choice, { type: 'auto' })
})
