import { round2 } from './domain/money.js'

// Flat tables for AG Studio's data engine. Field types stay stable (numbers, text, ISO dates) so widgets can map them.
const DAY = 86_400_000

export function buildStudioTables({ view, queue, details, savings, scenarios = [], simulated = new Set(), now = Date.now() }) {
  const choiceOf = new Map(view.cases.map((c) => [c.disputeId, c.choice.action]))
  const all = [...queue.inquiries.map((c) => ({ ...c, group: 'inquiry' })), ...queue.claims.map((c) => ({ ...c, group: 'claim' })), ...queue.resolved.map((c) => ({ ...c, group: 'resolved' }))]
  const disputes = all.map((c) => {
    const d = details.get(c.disputeId)
    const due = c.dueDate ? Date.parse(c.dueDate) : null
    return {
      id: c.disputeId,
      label: c.label || '',
      reason: c.kind === 'INR' ? 'Item not received' : c.kind === 'SNAD' ? 'Not as described' : 'Other',
      kind: c.kind,
      stage: c.stage,
      state: c.state,
      amount: c.amount,
      daysLeft: due == null ? 0 : Math.max(0, Math.ceil((due - now) / DAY)),
      hoursLeft: due == null ? 0 : Math.max(0, Math.round((due - now) / 3_600_000)),
      plan: c.group === 'inquiry' ? choiceOf.get(c.disputeId) || 'refund' : c.group === 'claim' ? 'already a claim' : 'resolved',
      group: c.group,
      item: c.item || d?.disputed_transactions?.[0]?.items?.[0]?.item_name || '',
      createdOn: (d?.create_time || '').slice(0, 10),
      simulated: simulated.has(c.disputeId),
    }
  })
  const outcomes = savings.rows.map((r) => ({ id: r.disputeId, outcome: r.outcome || 'n/a', reason: r.reason || '', amount: r.amount, paidToBuyer: r.paidToBuyer, keptRevenue: r.keptRevenue, feeAvoided: r.feeAvoided, simulation: r.simulation ? 'sandbox simulation' : 'sandbox result' }))
  const ratePlan = view.plans.map((p) => ({ id: p.id === 'ref' ? 'ref ' + p.description : p.id, plan: p.title, description: p.description, total: p.total, casesExpected: p.casesExpected, tierExpected: p.tierExpected, pHighVolume: p.pHighVolume, worstPct: Number(p.ratesPct.map((r) => Number(r.pct)).reduce((a, b) => Math.max(a, b), 0)) }))
  const gauges = view.empty
    ? []
    : [
        { id: 'counted', label: 'Counted so far', pct: Number(view.gauges.counted.pct), tier: view.gauges.counted.tier },
        { id: 'worst', label: 'If all open inquiries become claims', pct: Number(view.gauges.worst.pct), tier: view.gauges.worst.tier },
        ...view.gauges.plan.branches.map((b) => ({ id: `plan-${b.tag}`, label: b.tag === 'certain' ? 'With this plan' : `With this plan (${b.tag.split(' ').join(', ')})`, pct: Number(b.pct), tier: b.tier })),
      ]
  return { disputes, outcomes, ratePlan, gauges, scenarios: scenarios.map((s) => ({ ...s })), summary: [{ id: 'total', savedFees: savings.totals.feeAvoided, keptOutOfRate: round2(savings.totals.keptOutOfRate) }] }
}
