import test from 'node:test'
import assert from 'node:assert/strict'
import { itemsToMessages, agUiToMessages, anthropicToAgUi, toAnthropicTools, toAnthropicToolChoice, outputItems } from '../server/agent/agui.js'
import { syntheticEvents } from '../server/agent/provider.js'
import { mockMessage, fillSchema } from '../server/agent/mockClaude.js'
import { runServerTool, serverToolSchemas } from '../server/agent/tools.js'
import { createSession } from '../server/session.js'
import { createCard, approveCard } from '../server/approvals.js'
import { validateDraftAmounts, validateChecklist, buildChecklist } from '../server/domain/evidence.js'

const collect = async (gen) => {
  const out = []
  for await (const e of gen) out.push(e)
  return out
}

test('Anthropic stream events become AG-UI events: text deltas and tool-call JSON deltas', async () => {
  async function* raw() {
    yield { type: 'message_start', message: { id: 'msg_1', model: 'm', usage: { input_tokens: 5 } } }
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }
    yield { type: 'content_block_stop', index: 0 }
    yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'compare_acceptance', input: {} } }
    yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"label":' } }
    yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"A","q_values":[0.5]}' } }
    yield { type: 'content_block_stop', index: 1 }
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }
    yield { type: 'message_stop' }
  }
  const sink = {}
  const events = await collect(anthropicToAgUi(raw(), sink))
  assert.deepEqual(events.map((e) => e.type), ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_ARGS', 'TOOL_CALL_END'])
  assert.equal(events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta).join(''), 'Hello')
  assert.equal(events.filter((e) => e.type === 'TOOL_CALL_ARGS').map((e) => e.delta).join(''), '{"label":"A","q_values":[0.5]}')
  assert.equal(sink.stopReason, 'tool_use')
  assert.deepEqual(sink.toolUses, [{ id: 'toolu_1', name: 'compare_acceptance', input: { label: 'A', q_values: [0.5] } }])
  const items = outputItems(sink)
  assert.equal(items[0].type, 'message')
  assert.equal(items[1].type, 'function_call')
  assert.equal(items[1].callId, 'toolu_1')
})

test('non-stream fallback: a whole message replays as the same events (adapter level 1)', async () => {
  const msg = await mockMessage({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [] })
  const sink = {}
  const events = await collect(anthropicToAgUi(syntheticEvents(msg), sink))
  assert.ok(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT'))
  assert.equal(sink.stopReason, 'end_turn')
})

test('Studio conversation items convert to valid Anthropic messages (tool results paired, orphans repaired)', () => {
  const items = [
    { id: 'u1', kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'hi' }], status: 'completed' },
    { id: 'f1', kind: 'output', type: 'function_call', callId: 'c1', name: 'view_schema', arguments: '{}' },
    { type: 'function_call_output', callId: 'c1', output: '{"tables":[]}', status: 'completed' },
    { id: 'f2', kind: 'output', type: 'function_call', callId: 'c2', name: 'execute_query', arguments: '{"q":1}' },
  ]
  const { messages } = itemsToMessages(items)
  assert.equal(messages[0].role, 'user')
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user'])
  const last = messages.at(-1).content
  assert.equal(last[0].type, 'tool_result')
  assert.equal(last[0].tool_use_id, 'c2')
  assert.equal(last[0].is_error, true, 'an unanswered call gets an error result so the API accepts the history')
})

test('AG-UI run messages convert, including tool errors', () => {
  const { messages } = agUiToMessages([
    { id: '1', role: 'user', content: 'q' },
    { id: '2', role: 'assistant', content: 'thinking', toolCalls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }] },
    { id: '3', role: 'tool', toolCallId: 't1', content: '', error: 'boom' },
  ])
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(messages[2].content[0].is_error, true)
  assert.deepEqual(messages[1].content[1].input, { a: 1 })
})

test('tool schemas and tool choice map to the Anthropic format', () => {
  const tools = toAnthropicTools([{ name: 'a.b', description: 'd', parameters: { $schema: 'x', type: 'object', properties: { q: { type: 'string' } } } }, { name: 'c', parameters: undefined }])
  assert.equal(tools[0].name, 'a_b')
  assert.equal(tools[0].input_schema.$schema, undefined)
  assert.deepEqual(tools[1].input_schema, { type: 'object', properties: {} })
  assert.deepEqual(toAnthropicToolChoice('required', tools), { type: 'any' })
  assert.deepEqual(toAnthropicToolChoice({ name: 'c' }, tools), { type: 'tool', name: 'c' })
  assert.equal(toAnthropicToolChoice('none', tools), undefined)
})

test('the offline stand-in fills tool schemas it has never seen (delegate_to with anyOf variants)', () => {
  const schema = { type: 'object', properties: { type: { anyOf: [{ type: 'object', properties: { id: { type: 'string', enum: ['planning'] } }, required: ['id'] }, { type: 'object', properties: { id: { type: 'string', enum: ['dispute-analyst'] } }, required: ['id'] }] }, instructions: { type: 'string' } }, required: ['type', 'instructions'] }
  assert.deepEqual(fillSchema(schema, 'ask'), { type: { id: 'dispute-analyst' }, instructions: 'ask' })
})

test('server tools: schemas exist for every tool and none can write to PayPal', () => {
  const names = serverToolSchemas().map((t) => t.name)
  assert.deepEqual(names.sort(), ['compare_acceptance', 'compute_case_options', 'compute_rate_plan', 'draft_response', 'get_dispute_detail', 'get_order', 'get_sales_window', 'get_store_order', 'get_tracking', 'list_open_disputes'])
  for (const t of serverToolSchemas()) assert.equal(t.input_schema.type, 'object')
  assert.equal(names.some((n) => /^(send_|make_|accept_claim|escalate|approve|adjudicate|provide_|require_)/.test(n)), false)
})

test('compare_acceptance returns the 7-3 numbers and compute_rate_plan never changes the seller settings', async () => {
  const s = createSession()
  const cmp = await runServerTool(s, 'compare_acceptance', { label: 'A', q_values: [0.5, 0.8] })
  assert.equal(cmp.ok, true)
  assert.deepEqual(cmp.result.rows.map((r) => r.bestTotal), [84.52, 74.13])
  const plan = await runServerTool(s, 'compute_rate_plan', { acceptance_probability: 0.8 })
  assert.equal(plan.result.bestPlan, 'Offer $20 A, Refund B, Fight C')
  assert.equal(s.plan.q, 0.5)
  const bad = await runServerTool(s, 'compare_acceptance', { label: 'C', q_values: [0.5] })
  assert.equal(bad.ok, true, 'a Seller Protection case cannot get an offer, so the calculator says so and uses case A')
  assert.equal(bad.result.label, 'A')
  assert.match(bad.result.note, /Case C cannot get a partial offer/)
})

test('draft_response only creates an approval card; it refuses amounts the server did not compute', async () => {
  const s = createSession()
  const invented = await runServerTool(s, 'draft_response', { dispute_id: 'PP-R-BLK-10200001', action: 'send_message', text: 'We will refund $99.99 right now.' })
  assert.equal(invented.ok, false)
  assert.match(invented.error, /amounts the server did not compute/)
  const ok = await runServerTool(s, 'draft_response', { dispute_id: 'PP-R-BLK-10200001', action: 'make_offer', text: 'We can offer $20.00 to close this.' })
  assert.equal(ok.ok, true)
  assert.equal([...s.approvals.values()][0].createdBy, 'claude')
  assert.equal([...s.approvals.values()][0].payload.offer_amount.value, '20.00', 'the offer amount comes from the seller policy, not the model')
  assert.equal((await s.paypal.getDispute('PP-R-BLK-10200001')).dispute_state, 'REQUIRED_ACTION', 'nothing was sent')
  assert.equal(s.audit.list().some((e) => e.event === 'paypal_call_ok'), false)
})

test('evidence checklist: every present item has a source id; the validator rejects ones without', async () => {
  const s = createSession()
  const d = await s.paypal.getDispute('PP-R-LMP-10200003')
  const list = buildChecklist(d, 'INR', 'JH-1051')
  assert.ok(list.every((i) => !i.present || i.sourceId))
  assert.equal(list.find((i) => i.id === 'tracking').present, true)
  assert.equal(validateChecklist([{ id: 'tracking', present: true, sourceId: null }]).ok, false)
  assert.equal(validateChecklist(list).ok, true)
  const unknownOrder = buildChecklist(d, 'INR', 'JH-9999')
  assert.equal(unknownOrder.find((i) => i.id === 'tracking').present, false)
})

test('draft amount validation', () => {
  assert.equal(validateDraftAmounts('Refund of $66.12 sent', [66.12, 20]).ok, true)
  assert.deepEqual(validateDraftAmounts('We owe you $70', [66.12, 20]).invented, [70])
  assert.equal(validateDraftAmounts('No amounts here', []).ok, true)
})

const approveNow = async (s, card) => approveCard(s, card.id, { hash: card.hash, token: card.token })
async function refundAndSettle(s, id) {
  const card = await createCard(s, { disputeId: id, action: 'accept_claim', params: {} })
  await approveNow(s, card)
  s.paypal.service.scale = 1
  s.paypal.service.clock = () => Date.now() + 60 * 60_000
}

test('G4: when the named case is already refunded, the analyst says so and uses an open case that can get an offer', async () => {
  const s = createSession()
  s.paypal.service.create({ kind: 'SNAD', amount: 52.25, item: 'Wool Blanket', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', buyerMessage: 'x', settled: true, createdAt: Date.now() - 3_600_000 })
  await refundAndSettle(s, 'PP-R-BLK-10200001')
  const out = await runServerTool(s, 'compare_acceptance', { label: 'A', q_values: [0.5, 0.8] })
  assert.equal(out.ok, true)
  assert.notEqual(out.result.label, 'A')
  assert.match(out.result.note, /Case A is already closed/)
  assert.equal(out.result.rows.length, 2)
})

test('G4: with nothing left that can get an offer, the tool explains why instead of failing silently', async () => {
  const s = createSession()
  await refundAndSettle(s, 'PP-R-BLK-10200001')
  const out = await runServerTool(s, 'compare_acceptance', { label: 'A', q_values: [0.5] })
  assert.equal(out.ok, false)
  assert.match(out.error, /no longer open/)
  assert.match(out.error, /Reset demo/)
  const open = await runServerTool(createSession(), 'compare_acceptance', { q_values: [0.5] })
  assert.equal(open.result.label, 'A', 'without a label the first open case that can get an offer is used')
})

test('Draft with Claude (stand-in): reads the dispute and the store order, creates a card drafted by claude with a sourced checklist', async () => {
  const { draftWithClaude } = await import('../server/agent/draft.js')
  const s = createSession()
  const out = await draftWithClaude(s, { disputeId: 'PP-R-BLK-10200001', action: 'send_message', forceMock: true })
  assert.deepEqual(out.steps.map((x) => x.tool), ['get_dispute_detail', 'get_store_order', 'draft_response'])
  const card = s.approvals.get(out.cardId)
  assert.equal(card.createdBy, 'claude')
  assert.equal(card.status, 'PENDING')
  assert.match(card.draft, /Wool Blanket/)
  assert.doesNotMatch(card.draft, /\$\d/, 'the draft uses no dollar amount of its own')
  assert.equal(s.audit.list().some((e) => e.event === 'paypal_call_ok'), false, 'nothing was sent')
})

test('Draft with Claude: a draft with an amount the server did not compute is rejected and no card exists', async () => {
  const s = createSession()
  const bad = await runServerTool(s, 'draft_response', { dispute_id: 'PP-R-BLK-10200001', action: 'send_message', text: 'We will refund you $12.34 today.' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /did not compute/)
  assert.equal(s.approvals.size, 0)
  const ok = await runServerTool(s, 'draft_response', { dispute_id: 'PP-R-BLK-10200001', action: 'send_message', text: 'We can refund $66.12 if you return it.' })
  assert.equal(ok.ok, true, 'the disputed amount is a server figure')
})

test('Draft with Claude route: POST /api/approvals/draft returns the card, the steps and validates input', async () => {
  const { createApp } = await import('../server/app.js')
  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (body) => fetch(`${base}/api/approvals/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post({ disputeId: 'nope' })).status, 400)
    assert.equal((await post({ disputeId: 'PP-R-BLK-10200001', action: 'accept_claim' })).status, 400)
    const res = await post({ disputeId: 'PP-R-BLK-10200001' })
    assert.equal(res.status, 201)
    const json = await res.json()
    assert.equal(json.data.card.createdBy, 'claude')
    assert.equal(json.data.steps.length, 3)
    // The scripted stand-in is labelled as such, never as a model (ROOT_CAUSE C2).
    assert.equal(json.data.source, 'mock')
    assert.equal(json.data.card.drafter.source, 'mock')
    assert.match(json.data.label, /stand-in.*not a model/)
  } finally {
    server.close()
  }
})
