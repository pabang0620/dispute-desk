import test from 'node:test'
import assert from 'node:assert/strict'
import { accountMessage, withoutApiKey, transcriptOf } from '../server/agent/accountModel.js'

// A fake Claude Agent SDK: no process is started and the account is never contacted.
function fakeSdk(reply) {
  const seen = { options: null, prompt: null, tools: [] }
  return {
    seen,
    tool: (name, description, shape) => {
      seen.tools.push({ name, description, keys: Object.keys(shape) })
      return { name }
    },
    createSdkMcpServer: ({ name, tools }) => ({ name, tools }),
    query: ({ prompt, options }) => {
      seen.prompt = prompt
      seen.options = options
      return (async function* () {
        yield { type: 'system', subtype: 'init' }
        for (const content of reply) yield { type: 'assistant', message: { id: 'm1', content: [content], usage: { input_tokens: 11, output_tokens: 7 } } }
        yield { type: 'result', subtype: 'error_max_turns' }
      })()
    },
  }
}

const params = {
  system: 'You are the analyst.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'What if the buyer accepts 80%?' }] }],
  tools: [{ name: 'compare_acceptance', description: 'Compare', input_schema: { type: 'object', properties: { q_values: { type: 'array', items: { type: 'number' } } }, required: ['q_values'] } }],
  tool_choice: { type: 'auto' },
}

test('account backend: the API key variables are removed from the Claude Code process environment', async () => {
  const env = withoutApiKey({ ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' })
  assert.deepEqual(env, { PATH: '/bin' })
  const sdk = fakeSdk([{ type: 'text', text: 'ok' }])
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak'
  try {
    await accountMessage(params, { sdk })
  } finally {
    delete process.env.ANTHROPIC_API_KEY
  }
  assert.equal('ANTHROPIC_API_KEY' in sdk.seen.options.env, false)
  assert.equal('ANTHROPIC_AUTH_TOKEN' in sdk.seen.options.env, false)
  assert.equal(sdk.seen.options.maxTurns, 1, 'one turn per call: our own loop runs the tools')
  assert.deepEqual(sdk.seen.options.tools, [], 'no Claude Code built-in tools')
  assert.deepEqual(sdk.seen.options.settingSources, [])
})

test('account backend: a tool call in the assistant message comes back as an Anthropic tool_use block with the plain tool name', async () => {
  const sdk = fakeSdk([
    { type: 'text', text: 'Comparing.' },
    { type: 'tool_use', id: 'toolu_1', name: 'mcp__dd__compare_acceptance', input: { q_values: [0.5, 0.8] } },
  ])
  const msg = await accountMessage(params, { sdk })
  assert.deepEqual(sdk.seen.tools.map((t) => [t.name, t.keys]), [['compare_acceptance', ['q_values']]])
  assert.equal(msg.stop_reason, 'tool_use')
  assert.deepEqual(msg.content, [{ type: 'text', text: 'Comparing.' }, { type: 'tool_use', id: 'toolu_1', name: 'compare_acceptance', input: { q_values: [0.5, 0.8] } }])
  assert.equal(msg.usage.output_tokens, 7)
})

test('account backend: the conversation and a forced tool choice reach the model as a transcript and a system note', async () => {
  const sdk = fakeSdk([{ type: 'tool_use', id: 't2', name: 'mcp__dd__respond', input: { a: 1 } }])
  await accountMessage({ ...params, tool_choice: { type: 'tool', name: 'respond' }, messages: [...params.messages, { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'compare_acceptance', input: { q_values: [0.5] } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"rows":[]}' }] }] }, { sdk })
  assert.match(sdk.seen.options.systemPrompt, /You are the analyst\./)
  assert.match(sdk.seen.options.systemPrompt, /must answer by calling the tool respond/)
  assert.match(sdk.seen.prompt, /assistant called tool compare_acceptance/)
  assert.match(sdk.seen.prompt, /\[tool result\]\n\{"rows":\[\]\}/)
  assert.match(transcriptOf([{ role: 'user', content: 'hi' }]), /\[user\]\nhi/)
})

test('account backend: an empty reply is an error that says what to check', async () => {
  await assert.rejects(() => accountMessage(params, { sdk: fakeSdk([]) }), /logged in/)
})

test('account backend: the SDK error for the one-turn cap after a tool call is the expected end, not a failure', async () => {
  const sdk = fakeSdk([{ type: 'tool_use', id: 't1', name: 'mcp__dd__compare_acceptance', input: { q_values: [0.5] } }])
  const original = sdk.query
  sdk.query = (args) => {
    const inner = original(args)
    return (async function* () {
      for await (const m of inner) if (m.type !== 'result') yield m
      throw new Error('Claude Code returned an error result: Reached maximum number of turns (1)')
    })()
  }
  const msg = await accountMessage(params, { sdk })
  assert.equal(msg.stop_reason, 'tool_use')
})
