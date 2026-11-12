import { getStoreOrder } from '../data/storeOrders.js'
import { sellerProtectionCheck } from './sellerProtection.js'
import { readPaypalAmount } from './money.js'
import { TIER } from './rules.js'

const kindOf = (reason) => (reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' ? 'INR' : reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' ? 'SNAD' : 'OTHER')
const CLAIM_STAGE = new Set(['CHARGEBACK', 'CLAIM'])

// Turn PayPal dispute bodies into planner cases. Open inquiries are plan candidates; disputes already at the
// claim stage are in the numerator already and are counted, not planned (PLAN 11-1, bundle C).
export function buildQueue(disputes, { orderIdOf, labelOf }) {
  const inquiries = []
  const claims = []
  const resolved = []
  disputes
    .slice()
    .sort((a, b) => a.create_time.localeCompare(b.create_time) || a.dispute_id.localeCompare(b.dispute_id))
    .forEach((d) => {
      const kind = kindOf(d.reason)
      const amount = readPaypalAmount(d.dispute_amount)
      const base = { label: labelOf(d.dispute_id), disputeId: d.dispute_id, kind, amount, stage: d.dispute_life_cycle_stage, state: d.dispute_state, status: d.status, dueDate: d.seller_response_due_date || null }
      if (d.dispute_state === 'RESOLVED') resolved.push({ ...base, outcome: d.dispute_outcome || null })
      else if (CLAIM_STAGE.has(d.dispute_life_cycle_stage)) claims.push({ ...base, escalatedOn: escalatedDate(d) })
      else inquiries.push(base)
    })
  const labelled = inquiries.map((c) => {
    const d = disputes.find((x) => x.dispute_id === c.disputeId)
    const order = getStoreOrder(orderIdOf(c.disputeId, d))
    const txn = d.disputed_transactions?.[0]
    const sp = sellerProtectionCheck({
      kind: c.kind,
      filedWith: d.dispute_channel === 'INTERNAL' ? 'PAYPAL' : 'ISSUER',
      tracking: order?.tracking,
      transactionAddress: order?.transactionAddress,
      shipToAddress: order?.shipToAddress,
      physical: order?.physical ?? true,
      tier: TIER.STANDARD,
    })
    return {
      ...c,
      tierAtCreation: TIER.STANDARD,
      paymentMethod: 'PAYPAL',
      item: txn?.items?.[0]?.item_name || order?.item || 'Item',
      orderId: order?.orderId || null,
      spCheck: sp,
      spEligible: sp.eligible && Boolean(txn?.seller_protection_eligible ?? true),
      allowedOptions: Object.keys(d.allowed_response_options || {}),
      actionable: d.dispute_state === 'REQUIRED_ACTION',
    }
  })
  return { inquiries: labelled, claims, resolved }
}

function escalatedDate(d) {
  const e = (d.evidences || []).find((x) => x.action_info?.action === 'ESCALATE')
  return (e?.date || d.update_time || d.create_time).slice(0, 10)
}
