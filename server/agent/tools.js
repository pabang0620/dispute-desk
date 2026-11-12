import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { buildSnapshot } from '../snapshot.js'
import { planInputs } from '../domain/planView.js'
import { evaluatePlan, searchPlans, breakEvenAcceptance } from '../domain/ratePlan.js'
import { pctString, round2 } from '../domain/money.js'
import { buildChecklist, validateChecklist } from '../domain/evidence.js'
import { getStoreOrder } from '../data/storeOrders.js'
import { createCard, checkDraftText } from '../approvals.js'
import { HttpError } from '../http.js'

// Tools the dispute-analyst can call on the server. All read-only except draft_response, which only creates an
// approval card. There is no PayPal write tool, and no tool takes an amount from the model except as a question.
const toJson = (schema) => {
  const { $schema, ...rest } = z.toJSONSchema(schema)
  return rest
}

const defs = {
  list_open_disputes: {
    description: 'List the open PayPal disputes in the queue with their stage, amount, deadline and the current plan choice.',
    schema: z.object({}),
    async run({ snap }) {
      return snap.view.cases.map((c) => ({ label: c.label, dispute_id: c.disputeId, kind: c.kind, amount: c.amount, due: c.dueDate, choice: c.choice.action, seller_protection: c.spEligible }))
    },
  },
  get_dispute_detail: {
    description: 'Get one dispute: buyer messages, requested evidence, allowed actions (links) and deadline, plus the evidence checklist with source ids.',
    schema: z.object({ dispute_id: z.string() }),
    async run({ snap, session }, { dispute_id }) {
      const d = snap.details.get(dispute_id)
      if (!d) throw new Error(`Unknown dispute ${dispute_id}`)
      const kind = d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' ? 'INR' : 'SNAD'
      const orderId = session.paypal.orderIdOf?.(dispute_id, d)
      return {
        dispute_id,
        stage: d.dispute_life_cycle_stage,
        state: d.dispute_state,
        reason: d.reason,
        amount: d.dispute_amount.value,
        due: d.seller_response_due_date || null,
        messages: (d.messages || []).map((m) => ({ by: m.posted_by, text: m.content })),
        requested_evidence: (d.evidences || []).filter((e) => e.source === 'REQUESTED_FROM_SELLER').map((e) => e.evidence_type),
        allowed_actions: d.links.map((l) => l.rel).filter((r) => r !== 'self'),
        checklist: buildChecklist(d, kind, orderId),
      }
    },
  },
  get_store_order: {
    description: 'Get the demo store order record (listing text, ship-to address, tracking). Source is demo store data. order_id is the store order id such as JH-1042 (the checklist item "order" has source id order:JH-1042), not the PayPal dispute id.',
    schema: z.object({ order_id: z.string() }),
    async run(_ctx, { order_id }) {
      const o = getStoreOrder(order_id)
      if (!o) throw new Error(`Unknown order ${order_id}`)
      return { ...o, source: 'demo store data' }
    },
  },
  get_order: {
    description: 'Get the PayPal order through the Agent Toolkit (sandbox) or the stand-in. Use get_store_order for shipping records.',
    schema: z.object({ order_id: z.string() }),
    async run({ session }, { order_id }) {
      return session.paypal.getOrder(order_id)
    },
  },
  get_tracking: {
    description: 'Get the shipment tracking record for an order.',
    schema: z.object({ order_id: z.string() }),
    async run({ session }, { order_id }) {
      return session.paypal.getTracking({ order_id })
    },
  },
  get_sales_window: {
    description: 'Get the demo store ledger used as the dispute-rate denominator: 3-month net sales, sale count, claims already counted.',
    schema: z.object({}),
    async run({ snap }) {
      return { source: 'demo store ledger', net_sales_3mo: snap.view.store.netSales, sales_count: snap.view.store.salesCount, counted_claims: snap.view.counted, applies_to: snap.view.appliesTo }
    },
  },
  compute_case_options: {
    description: 'Cost of the three paths (full refund, partial offer, fight) for one case, with fee rules and the rate effect. Numbers come from code.',
    schema: z.object({ label: z.string() }),
    async run({ snap }, { label }) {
      const c = snap.view.cases.find((x) => x.label === label)
      if (!c) throw new Error(`Unknown case ${label}`)
      return { label, dispute_id: c.disputeId, amount: c.amount, options: c.options, impact: c.impact, rules: c.rules, cheapest_per_case: c.cheapestPerCase }
    },
  },
  compute_rate_plan: {
    description: 'Dispute-rate plan for this queue. Optional what-if inputs: acceptance_probability (q), win_probability (p), period ("window" or "decOnly"). Returns rates, expected totals and the best plan. Does not change the seller settings.',
    schema: z.object({ acceptance_probability: z.number().min(0).max(1).optional(), win_probability: z.number().min(0).max(1).optional(), period: z.enum(['window', 'decOnly']).optional() }),
    async run({ session, snap }, args) {
      const inp = planInputs({ plan: session.plan, ledger: session.ledger, queue: snap.queue })
      const assumptions = { ...inp.assumptions, ...(args.acceptance_probability != null ? { q: args.acceptance_probability } : {}), ...(args.win_probability != null ? { p: args.win_probability } : {}) }
      const period = args.period || inp.period
      const plans = searchPlans({ ...inp, assumptions, period })
      const best = plans[0]
      const current = evaluatePlan({ ...inp, assumptions, period, choices: snap.view.cases.reduce((a, c) => ({ ...a, [c.label]: c.choice }), {}) })
      return {
        counted_pct: pctString(current.current.rate),
        worst_case_pct: pctString(current.worst.rate),
        planRatesPct: current.branches.map((b) => pctString(b.rate)),
        total: round2(current.total),
        bestPlan: describe(best.choices, inp.offerAmount),
        bestTotal: round2(best.result.total),
        assumptions: { q: assumptions.q, p: assumptions.p, period },
        note: 'q and p are the seller assumptions, not statistics.',
      }
    },
  },
  compare_acceptance: {
    description: 'Compare the best plan at several buyer acceptance probabilities for one open case that could get a partial offer. Returns one row per probability, the break-even probability and a comparison_id. Numbers come from code. Pass the comparison_id to show_scenario_comparison to put the result on the dashboard. label is optional: leave it out to use the first open case that can get an offer. If the named case is already closed, the calculator uses an open case that can get an offer and says so in `note`.',
    schema: z.object({ label: z.string().optional(), q_values: z.array(z.number().min(0).max(1)).min(1).max(5) }),
    async run({ session, snap }, { label: asked, q_values }) {
      const inp = planInputs({ plan: session.plan, ledger: session.ledger, queue: snap.queue })
      const offerable = inp.cases.filter((c) => c.amount > inp.offerAmount && !c.spEligible)
      const named = asked ? inp.cases.find((c) => c.label === asked) : null
      const target = named && offerable.includes(named) ? named : offerable[0]
      if (!target) {
        const why = asked && !named ? `Case ${asked} is no longer open (it is resolved or closed).` : asked ? `Case ${asked} cannot get a partial offer.` : 'No open case can get a partial offer.'
        throw new Error(`${why} No other open case can get a $${inp.offerAmount} offer either: the rest are under $${inp.offerAmount} or Seller Protection eligible. Use "Reset demo" to restore the untouched queue.`)
      }
      const label = target.label
      const note = asked && asked !== label ? `Case ${asked} ${named ? 'cannot get a partial offer' : 'is already closed'}, so this compares case ${label}, the open case that can.` : null
      const rows = q_values.map((q) => {
        const plans = searchPlans({ ...inp, assumptions: { ...inp.assumptions, q } })
        const offer = plans.find((p) => p.choices[label].action === 'offer')
        const best = plans[0]
        return { q, bestPlan: describe(best.choices, inp.offerAmount), bestTotal: round2(best.result.total), offerPlan: describe(offer.choices, inp.offerAmount), offerTotal: round2(offer.result.total), offerWins: best.choices[label].action === 'offer' }
      })
      const breakEvenQ = breakEvenAcceptance({ ledger: inp.ledger, cases: inp.cases, assumptions: inp.assumptions, offerAmount: inp.offerAmount, period: inp.period, label })
      const title = `Case ${label}: $${inp.offerAmount} offer at different acceptance`
      // The server keeps the calculator result. The comparison widget is filled from this copy, never from model text.
      const comparisonId = `cmp_${randomUUID().slice(0, 8)}`
      session.comparisons ||= new Map()
      session.comparisons.set(comparisonId, { title, label, rows })
      if (session.comparisons.size > 20) session.comparisons.delete(session.comparisons.keys().next().value)
      return { comparison_id: comparisonId, title, label, ...(note ? { note } : {}), offerAmount: inp.offerAmount, period: inp.period, rows, breakEvenQ }
    },
  },
  draft_response: {
    description: 'Create an approval card with a drafted reply or evidence note for the seller to review. Nothing is sent to PayPal. The text may only contain dollar amounts the server computed (the disputed amount and the offer amount).',
    schema: z.object({
      dispute_id: z.string(),
      action: z.enum(['send_message', 'provide_evidence', 'make_offer', 'accept_claim', 'escalate']),
      text: z.string().max(2000).optional(),
      checklist: z.array(z.object({ id: z.string(), present: z.boolean(), source_id: z.string().nullable() })).optional(),
    }),
    async run({ session, snap }, args) {
      const c = snap.view.cases.find((x) => x.disputeId === args.dispute_id)
      const d = snap.details.get(args.dispute_id)
      if (!d) throw new Error(`Unknown dispute ${args.dispute_id}`)
      const allowed = [Number(d.dispute_amount.value), session.plan.offerAmount]
      if (args.text) {
        const check = checkDraftText(args.text, allowed)
        if (!check.ok) throw new Error(`The draft contains amounts the server did not compute (${check.invented.map((n) => `$${n}`).join(', ')}). Remove them or use only $${allowed.join(' or $')}.`)
      }
      if (args.checklist) {
        const v = validateChecklist(args.checklist.map((i) => ({ id: i.id, present: i.present, sourceId: i.source_id })))
        if (!v.ok) throw new Error(v.error)
      }
      const params = {}
      if (args.action === 'send_message') params.message = args.text
      if (args.action === 'make_offer') {
        if (!c || !c.canOffer) throw new Error('This case cannot get a partial offer')
        Object.assign(params, { amount: session.plan.offerAmount, note: args.text })
      }
      if (['provide_evidence', 'escalate'].includes(args.action) && args.text) params[args.action === 'escalate' ? 'note' : 'notes'] = args.text
      try {
        const card = await createCard(session, { disputeId: args.dispute_id, action: args.action, params, createdBy: 'claude' })
        return { card_id: card.id, status: card.status, hash_prefix: card.hash.slice(0, 8), note: 'Nothing was sent. The seller must approve the card.' }
      } catch (err) {
        if (err instanceof HttpError) throw new Error(err.message)
        throw err
      }
    },
  },
}

function describe(choices, offerAmount) {
  return Object.entries(choices)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, c]) => `${c.action === 'refund' ? 'Refund' : c.action === 'fight' ? 'Fight' : `Offer $${offerAmount}`} ${label}`)
    .join(', ')
}

export const SERVER_TOOL_NAMES = new Set(Object.keys(defs))

export function serverToolSchemas() {
  return Object.entries(defs).map(([name, d]) => ({ name, description: d.description, input_schema: toJson(d.schema) }))
}

export async function runServerTool(session, name, input) {
  const def = defs[name]
  if (!def) return { ok: false, error: `Unknown tool ${name}` }
  const parsed = def.schema.safeParse(input ?? {})
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  try {
    const snap = await buildSnapshot(session)
    return { ok: true, result: await def.run({ session, snap }, parsed.data) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
