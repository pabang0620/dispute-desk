import { SCENARIO } from './domain/scenario.js'
import { buildQueue } from './domain/queue.js'
import { buildPlanView } from './domain/planView.js'

// Read the whole dispute queue for a session (list + detail per dispute), then build the planner view.
export async function loadQueue(session) {
  const list = await session.paypal.listDisputes({ page_size: 50 })
  const details = await Promise.all(list.items.map((i) => session.paypal.getDispute(i.dispute_id)))
  const byId = new Map(details.map((d) => [d.dispute_id, d]))
  // Labels (A, B, C ...) are assigned once per case, in creation order, and never reused, so a plan keeps pointing at the same case.
  session.labels ||= new Map()
  for (const d of [...details].sort((a, b) => a.create_time.localeCompare(b.create_time) || a.dispute_id.localeCompare(b.dispute_id))) {
    if (!session.labels.has(d.dispute_id)) session.labels.set(d.dispute_id, labelName(session.labels.size))
  }
  const queue = buildQueue(details, { orderIdOf: (id, d) => session.paypal.orderIdOf?.(id, d) ?? null, labelOf: (id) => session.labels.get(id) })
  return { queue, details: byId }
}

const labelName = (n) => (n < 26 ? String.fromCharCode(65 + n) : `Z${n - 25}`)

export const asOfDate = () => process.env.AS_OF || SCENARIO.asOf

export async function buildSnapshot(session) {
  const { queue, details } = await loadQueue(session)
  const view = buildPlanView({ plan: session.plan, ledger: session.ledger, queue, asOf: asOfDate() })
  return { view, queue, details }
}
