import { randomUUID } from 'node:crypto'

// Offline stand-in for the Anthropic Messages API: same request in, same message shape out. It is deterministic and
// follows scripts for the two agents of this app. It only restates numbers that tools returned; it never makes any up.
const id = () => `msg_mock_${randomUUID().slice(0, 8)}`
const usage = { input_tokens: 0, output_tokens: 0 }

export async function mockMessage(params) {
  const tools = params.tools || []
  const names = new Set(tools.map((t) => t.name))
  const turn = currentTurn(params.messages)
  const ctx = { tools, names, turn, text: turn.userText, results: turn.results }
  const content = names.has('compare_acceptance') ? analyst(ctx) : names.has('draft_response') ? drafter(ctx) : lead(ctx)
  return { id: id(), type: 'message', role: 'assistant', model: 'mock-claude', content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage }
}

export function currentTurn(messages = []) {
  let start = 0
  messages.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content) ? m.content.some((b) => b.type === 'text') : m.role === 'user' && typeof m.content === 'string') start = i
  })
  const first = messages[start]
  const userText = Array.isArray(first?.content) ? first.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : String(first?.content || '')
  const slice = messages.slice(start)
  const nameById = new Map()
  const results = []
  for (const m of slice) {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'tool_use') nameById.set(b.id, b.name)
      if (b.type === 'tool_result') results.push({ name: nameById.get(b.tool_use_id), content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content), isError: Boolean(b.is_error) })
    }
  }
  return { userText, results }
}

const text = (t) => ({ type: 'text', text: t })
const use = (name, input) => ({ type: 'tool_use', id: `toolu_mock_${randomUUID().slice(0, 8)}`, name, input })
const parse = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// JSON-schema aware filler so the mock can call any tool Studio advertises (for example delegate_to, complete_task).
export function fillSchema(schema, hint, key = '') {
  if (!schema) return undefined
  const variants = schema.anyOf || schema.oneOf
  const pick = variants && (variants.find((x) => JSON.stringify(x).includes('dispute-analyst')) || variants.find((x) => x.type !== 'null'))
  const s = pick || schema
  if (s.enum) return s.enum.includes('dispute-analyst') ? 'dispute-analyst' : s.enum[0]
  if (s.type === 'array') return [fillSchema(s.items, hint, key)].filter((v) => v !== undefined)
  if (s.type === 'object') {
    const out = {}
    const props = s.properties || {}
    for (const [k, v] of Object.entries(props)) {
      if ((s.required || []).includes(k)) out[k] = fillSchema(v, hint, k)
    }
    if (props.id?.enum) out.id = props.id.enum[0]
    return out
  }
  if (s.type === 'number' || s.type === 'integer') return 0
  if (s.type === 'boolean') return false
  if (/agent|target|assignee|id$/i.test(key)) return 'dispute-analyst'
  return hint
}

function lead({ names, tools, text: userText, results }) {
  const delegate = tools.find((t) => t.name === 'delegate_to')
  const delegated = results.find((r) => r.name === 'delegate_to')
  if (delegated) {
    return [text('The dispute-analyst agent answered above, using the server calculators.')]
  }
  if (delegate && /accept|offer|what if|rate|plan|refund|fight|probab|dispute|\d+\s?%|\$\d/i.test(userText)) {
    return [text('This is a dispute-plan question, so I will delegate it to the dispute-analyst agent.'), use('delegate_to', fillSchema(delegate.input_schema, userText))]
  }
  if (names.has('view_schema') && /table|field|schema|data/i.test(userText) && !results.length) return [text('Let me look at the schema.'), use('view_schema', {})]
  if (results.length) return [text('Done. The dashboard is updated.')]
  return [text('I can plan your dispute queue. Ask what happens if a buyer accepts a partial refund, or ask for the plan with different assumptions.')]
}

function analyst({ names, tools, text: userText, results }) {
  const compare = results.find((r) => r.name === 'compare_acceptance')
  const shown = results.find((r) => r.name === 'show_scenario_comparison')
  const plan = results.find((r) => r.name === 'compute_rate_plan')
  const complete = tools.find((t) => t.name === 'complete_task')
  const pcts = [...userText.matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1]) / 100).filter((v) => v > 0 && v <= 1)
  const label = (userText.match(/\b(?:on|case|buyer on)\s+([A-Z])\b/) || [])[1]
  if (!compare && !plan) {
    if (/accept|probab|what if|chance|likely|%/i.test(userText)) {
      // Compare what the seller named; with fewer than two distinct values, add the default pair 50% and 80%.
      const named = [...new Set(pcts)]
      const qs = (named.length >= 2 ? named : [...new Set([...named, 0.5, 0.8])].slice(0, Math.max(2, named.length))).sort((a, b) => a - b)
      return [text(`I will compare the plans at ${qs.map((q) => `${Math.round(q * 100)}%`).join(' and ')} buyer acceptance with the server calculator.`), use('compare_acceptance', { ...(label ? { label } : {}), q_values: qs })]
    }
    return [text('Let me compute the plan with the server calculator.'), use('compute_rate_plan', {})]
  }
  if (compare && !shown && names.has('show_scenario_comparison') && parse(compare.content)?.comparison_id) {
    const body = parse(compare.content)
    return [text('Adding a comparison to the dashboard.'), use('show_scenario_comparison', { comparison_id: body.comparison_id, title: body.title || 'Acceptance comparison' })]
  }
  const body = parse((compare || plan).content)
  const summary = compare ? compareSummary(body) : planSummary(body)
  if (complete) return [use('complete_task', fillSchema(complete.input_schema, summary, 'summary'))]
  return [text(summary)]
}

// "Draft with Claude" script: read the dispute and the store order, then draft only from those records.
// The reply uses record values (item, listing text, tracking) and no dollar amount of its own.
function drafter({ text: userText, results }) {
  const detail = parse(results.find((r) => r.name === 'get_dispute_detail')?.content)
  const order = parse(results.find((r) => r.name === 'get_store_order')?.content)
  const failed = results.filter((r) => r.name === 'draft_response' && r.isError).length
  const disputeId = (userText.match(/dispute (PP-R-[A-Z0-9-]+)/) || [])[1]
  const action = (userText.match(/Draft a (\w+) for/) || [])[1] || 'send_message'
  if (!detail) return [text('I will read the dispute first.'), use('get_dispute_detail', { dispute_id: disputeId })]
  const orderItem = (detail.checklist || []).find((i) => i.id === 'order')
  const orderId = (orderItem?.sourceId || '').replace(/^order:/, '')
  if (!order && orderId && !results.some((r) => r.name === 'get_store_order')) return [text('Now the store order record.'), use('get_store_order', { order_id: orderId })]
  if (failed >= 1) return [text('The server rejected the draft. I could not fix it without inventing an amount.')]
  const checklist = (detail.checklist || []).map((i) => ({ id: i.id, present: Boolean(i.present), source_id: i.sourceId ?? null }))
  const item = order?.item || 'order'
  const t = order?.tracking
  const parts = {
    send_message: [`Hi, thank you for your message about the ${item}${order?.orderId ? ` (order ${order.orderId})` : ''}.`, order?.listingText ? `I checked our records: the listing says "${String(order.listingText).slice(0, 140)}".` : 'I am checking our records.', 'Could you send a photo of the item and its label so we can settle this quickly?'],
    provide_evidence: [`The ${item} was shipped${t ? ` with ${t.carrier}, tracking number ${t.number}` : ''}.`, t?.status === 'DELIVERED' ? `Tracking shows it was delivered on ${t.deliveredOn}.` : 'Tracking has no delivery scan yet.', order?.shipToAddress ? 'It went to the address on the transaction.' : ''],
    escalate: [`We ask PayPal to review this case about the ${item}.`, t ? `${t.carrier} tracking ${t.number} is attached to the order record.` : 'The order record is attached.'],
  }[action]
  return [text('I have both records. Drafting from them.'), use('draft_response', { dispute_id: detail.dispute_id || disputeId, action, text: parts.filter(Boolean).join(' '), checklist })]
}

function compareSummary(body) {
  if (body?.error) return `The calculator could not compare: ${body.error}`
  if (!body?.rows?.length) return 'The calculator returned no scenarios.'
  const money = (v) => `$${Number(v).toFixed(2)}`
  const lines = body.rows.map((r) => `At ${Math.round(r.q * 100)}% acceptance the cheapest plan is "${r.bestPlan}" at ${money(r.bestTotal)}; the $${body.offerAmount} offer plan costs ${money(r.offerTotal)}.`)
  const subst = body.note ? `${body.note} ` : ''
  const be = body.breakEvenQ != null ? ` The offer starts to win above about ${Math.round(body.breakEvenQ * 100)}% acceptance (under your period assumption).` : ''
  return `${subst}${lines.join(' ')}${be} These are your assumptions, not statistics.`
}

function planSummary(body) {
  if (!body) return 'The calculator returned nothing.'
  return `Projected rate with this plan: ${body.planRatesPct?.join(' / ')}%. Expected total cost ${body.total != null ? `$${Number(body.total).toFixed(2)}` : 'n/a'}. The best plan is "${body.bestPlan}".`
}
