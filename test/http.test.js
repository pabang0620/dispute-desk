import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.js'

let server
let base
before(async () => {
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

function client() {
  let cookie = ''
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    const text = await res.text()
    return { status: res.status, json: text.startsWith('{') ? JSON.parse(text) : null, text }
  }
}

const A = 'PP-R-BLK-10200001'

test('GET /api/state returns the scenario numbers from one place', async () => {
  const call = client()
  const { json } = await call('GET', '/api/state')
  const v = json.data.view
  assert.equal(v.gauges.counted.pct, '1.30')
  assert.equal(v.gauges.worst.pct, '1.82')
  assert.deepEqual(v.gauges.plan.branches.map((b) => b.pct), ['1.47', '1.75'])
  assert.equal(v.tierCost.total, 150)
  assert.deepEqual(v.plans.slice(0, 3).map((p) => [p.id, p.total]), [['X', 127.74], ['Y', 84.52], ['Z', 209.71]])
  assert.equal(v.recommended.text, 'Refund A, Refund B, Fight C')
  assert.equal(v.recommended.id, 'Y')
  assert.equal(v.cases[0].counts.from, '2026-12-01')
  assert.equal(v.cases[0].counts.dropsOut, '2027-03-01')
  assert.equal(json.data.banner.layer, 0)
  assert.ok(json.data.tables.disputes.length === 3)
})

test('plan changes: refund A gives 1.47% in one line, q = 0.8 makes the offer win, December only flips the advice', async () => {
  const call = client()
  let r = await call('POST', '/api/plan', { choices: { A: { action: 'refund' } } })
  assert.deepEqual(r.json.data.view.gauges.plan.branches.map((b) => b.pct), ['1.47'])
  r = await call('POST', '/api/plan', { q: 0.8 })
  assert.equal(r.json.data.view.recommended.text, 'Offer $20 A, Refund B, Fight C')
  assert.equal(r.json.data.view.plans.find((p) => p.id === 'X').total, 74.13)
  // REVIEW_2 G3: Y stays the account-safe plan ($84.52, never reaches 1.5%); the recommended chip goes to the plan that is cheapest.
  const y = r.json.data.view.plans.find((p) => p.id === 'Y')
  assert.equal(y.total, 84.52)
  assert.equal(y.pHighVolume, 0)
  assert.equal(r.json.data.view.recommended.id, 'X')
  assert.equal(r.json.data.view.recommended.total, 74.13)
  r = await call('POST', '/api/plan', { q: 0.5, period: 'decOnly' })
  assert.equal(r.json.data.view.recommended.total, 77.74)
  assert.deepEqual(r.json.data.view.breakEven.A, { window: 0.742, decOnly: 0.414 })
})

test('plan input is validated with zod', async () => {
  const call = client()
  assert.equal((await call('POST', '/api/plan', { q: 3 })).status, 400)
  assert.equal((await call('POST', '/api/plan', { choices: { A: { action: 'steal' } } })).status, 400)
  assert.equal((await call('GET', '/api/disputes/not-an-id')).status, 400)
  assert.equal((await call('POST', '/api/approvals', { disputeId: A, action: 'drop_database' })).status, 400)
})

test('approval over HTTP: edit changes the hash, stale hash is refused, approval resolves the case and updates Saved vs Advised', async () => {
  const call = client()
  const made = await call('POST', '/api/approvals', { disputeId: A, action: 'send_message', params: { message: 'Hello, we are on it.' } })
  assert.equal(made.status, 201)
  const card = made.json.data
  const edited = await call('PATCH', `/api/approvals/${card.id}`, { params: { message: 'Hello, we are on it today.' } })
  assert.notEqual(edited.json.data.hash, card.hash)
  const stale = await call('POST', `/api/approvals/${card.id}/approve`, { hash: card.hash, token: card.token })
  assert.equal(stale.status, 409)
  const ok = await call('POST', `/api/approvals/${card.id}/approve`, { hash: edited.json.data.hash, token: edited.json.data.token })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.data.status, 'EXECUTED')
})

test('refund A end to end, then the dispute is resolved and counted as saved', async () => {
  const call = client()
  const made = await call('POST', '/api/approvals', { disputeId: A, action: 'accept_claim', params: {} })
  const card = made.json.data
  assert.deepEqual(card.payload, { note: 'refund_issued' })
  const ok = await call('POST', `/api/approvals/${card.id}/approve`, { hash: card.hash, token: card.token })
  assert.equal(ok.json.data.status, 'EXECUTED')
  // the stand-in runs at 40x: 2 minutes become 3 seconds
  await new Promise((r) => setTimeout(r, 3300))
  const state = (await call('GET', '/api/state')).json.data
  const row = state.savings.rows.find((x) => x.disputeId === A)
  assert.equal(row.reason, 'SELLER_ISSUED_REFUND')
  assert.equal(row.paidToBuyer, 66.12)
  assert.equal(row.keptOutOfRate, 66.12)
  assert.equal(state.view.gauges.counted.pct, '1.30', 'an inquiry settled with the buyer never entered the dispute rate')
  assert.equal(state.view.cases.map((c) => c.label).join(), 'B,C', 'labels stay with their cases')
  assert.equal(state.view.cases.length, 2)
})

test('sessions do not share state', async () => {
  const one = client()
  const two = client()
  await one('POST', '/api/plan', { q: 0.9 })
  const s2 = (await two('GET', '/api/state')).json.data
  assert.equal(s2.view.assumptions.q, 0.5)
})

test('judge claim in offline mode adds two cases to the private stand-in; recorded run is served', async () => {
  const call = client()
  const claimed = await call('POST', '/api/judge/claim')
  assert.equal(claimed.json.data.tables.disputes.length, 5)
  assert.equal(claimed.json.data.banner.layer, 0)
  const rec = await call('GET', '/api/recorded-run')
  assert.equal(rec.json.data.runs.length, 2)
  assert.equal(rec.json.data.runs[0].steps.some((s) => s.request.path.endsWith('/accept-claim') && s.status === 200), true)
})

test('buyer-accepts needs an open offer', async () => {
  const call = client()
  assert.equal((await call('POST', `/api/sandbox/${A}/buyer-accepts`)).status, 409)
})

test('studio llm route streams AG-UI events then a complete frame (delegation to the dispute-analyst)', async () => {
  const call = client()
  const body = {
    input: [{ id: '1', kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'What if the buyer on A is likely to accept $20?' }], status: 'completed' }],
    tools: [{ name: 'delegate_to', description: 'd', parameters: { type: 'object', properties: { type: { anyOf: [{ type: 'object', properties: { id: { type: 'string', enum: ['planning'] } }, required: ['id'] }, { type: 'object', properties: { id: { type: 'string', enum: ['dispute-analyst'] } }, required: ['id'] }] }, instructions: { type: 'string' } }, required: ['type', 'instructions'] } }],
    responseFormat: { type: 'text' },
  }
  const res = await call('POST', '/api/studio/llm', body)
  const frames = res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')))
  const types = frames.filter((f) => f.kind === 'event').map((f) => f.event.type)
  assert.ok(types.includes('TEXT_MESSAGE_START') && types.includes('TOOL_CALL_START') && types.includes('TOOL_CALL_END'))
  const args = frames.filter((f) => f.event?.type === 'TOOL_CALL_ARGS').map((f) => f.event.delta).join('')
  assert.equal(JSON.parse(args).type.id, 'dispute-analyst')
  const complete = frames.at(-1)
  assert.equal(complete.kind, 'complete')
  assert.equal(complete.response.output.at(-1).type, 'function_call')
  assert.equal(complete.response.status, 'completed')
})

test('agent run route runs server tools, leaves Studio tools open, and does not send anything to PayPal', async () => {
  const call = client()
  const body = {
    input: {
      messages: [{ id: '1', role: 'user', content: 'What if the buyer on A is likely to accept $20?' }],
      tools: [
        { name: 'show_scenario_comparison', description: 'x', parameters: { type: 'object', properties: { title: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } } } },
        { name: 'complete_task', description: 'x', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
      ],
    },
  }
  const res = await call('POST', '/api/agent/run', body)
  const events = res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, ''))).filter((f) => f.kind === 'event').map((f) => f.event)
  const calls = events.filter((e) => e.type === 'TOOL_CALL_START').map((e) => e.toolCallName)
  assert.deepEqual(calls, ['compare_acceptance', 'show_scenario_comparison'])
  const result = events.find((e) => e.type === 'TOOL_CALL_RESULT')
  const parsed = JSON.parse(result.content)
  assert.deepEqual(parsed.rows.map((r) => [r.q, r.bestTotal, r.offerTotal, r.offerWins]), [[0.5, 84.52, 127.74, false], [0.8, 74.13, 74.13, true]])
  assert.equal(parsed.breakEvenQ, 0.742)
  assert.equal(events.some((e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId && events.find((x) => x.type === 'TOOL_CALL_START' && x.toolCallId === e.toolCallId)?.toolCallName === 'show_scenario_comparison'), false, 'Studio tool stays open for the browser to run')
  const state = (await call('GET', '/api/state')).json.data
  assert.equal(state.audit.some((a) => a.event === 'paypal_call_ok'), false)
})

test('webhook endpoint refuses events it cannot verify (offline mode has no webhook id)', async () => {
  const call = client()
  const res = await call('POST', '/api/webhooks/paypal', { event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: A } })
  assert.equal(res.status, 501)
})

test('comparison widget numbers come from the server calculator result, not from model arguments (REVIEW_2 G5)', async () => {
  const call = client()
  assert.equal((await call('POST', '/api/scenarios', { comparisonId: 'cmp_deadbeef' })).status, 404)
  assert.equal((await call('POST', '/api/scenarios', { rows: [] })).status, 400)
  const res = await call('POST', '/api/agent/run', { input: { messages: [{ id: '1', role: 'user', content: 'What if the buyer on A is likely to accept $20?' }], tools: [{ name: 'show_scenario_comparison', description: 'x', parameters: { type: 'object', properties: {} } }] } })
  const events = res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, ''))).filter((f) => f.kind === 'event').map((f) => f.event)
  const compare = JSON.parse(events.find((e) => e.type === 'TOOL_CALL_RESULT').content)
  assert.match(compare.comparison_id, /^cmp_[a-f0-9]{8}$/)
  // A model that tries to pass its own rows: the extra field is ignored and the stored numbers are the server's.
  const saved = await call('POST', '/api/scenarios', { comparisonId: compare.comparison_id, rows: [{ q: 0.5, bestPlan: 'x', bestTotal: 1, offerPlan: 'x', offerTotal: 1, offerWins: true }] })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.data.scenarios.map((r) => [r.acceptance, r.bestTotal, r.offerTotal, r.offerWins]), [[50, 84.52, 127.74, 'refund wins'], [80, 74.13, 74.13, 'offer wins']])
  const state = (await call('GET', '/api/state')).json.data
  assert.deepEqual(state.tables.scenarios.map((r) => r.bestTotal), [84.52, 74.13])
})

test('dispute-analyst keeps its server tool calls when Studio returns a client tool result (Studio drops them)', async () => {
  const call = client()
  const frames = (res) => res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, ''))).filter((f) => f.kind === 'event').map((f) => f.event)
  const tools = [
    { name: 'show_scenario_comparison', description: 'x', parameters: { type: 'object', properties: { comparison_id: { type: 'string' } } } },
    { name: 'complete_task', description: 'x', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  ]
  const user = { id: 'u1', role: 'user', content: 'What if the buyer on A is likely to accept $20?' }
  const first = frames(await call('POST', '/api/agent/run', { input: { threadId: 't1', messages: [user], tools } }))
  const show = first.find((e) => e.type === 'TOOL_CALL_START' && e.toolCallName === 'show_scenario_comparison')
  assert.ok(show)
  // What Studio sends back: the user turn, the client tool call it ran, and its result. No compare_acceptance.
  const back = [user, { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: show.toolCallId, type: 'function', function: { name: 'show_scenario_comparison', arguments: '{}' } }] }, { id: 'r1', role: 'tool', toolCallId: show.toolCallId, content: '{"success":true}' }]
  const second = frames(await call('POST', '/api/agent/run', { input: { threadId: 't1', messages: back, tools } }))
  const names = second.filter((e) => e.type === 'TOOL_CALL_START').map((e) => e.toolCallName)
  assert.deepEqual(names, ['complete_task'], 'the analyst does not run compare_acceptance again')
})
