import { round2 } from './domain/money.js'

// "Saved vs Advised": what the advised path cost versus what fighting would have put at risk, from RESOLVED disputes.
// Results ended with the sandbox adjudicate call are kept apart and labelled as a sandbox simulation.
export function buildSavings({ resolved, details, simulated = new Set(), feeStandard = 15, feeExemptBelow = 30 }) {
  const rows = resolved.map((r) => {
    const d = details.get(r.disputeId)
    const refunded = Number(d?.dispute_outcome?.amount_refunded?.value ?? 0)
    const code = r.outcome?.outcome_code || null
    const reason = r.outcome?.outcome_reason || null
    const sim = simulated.has(r.disputeId)
    const inquiryRefund = reason === 'SELLER_ISSUED_REFUND' || reason === 'INQUIRY_OFFER_PARTIAL_REFUND'
    // A refund at the inquiry stage keeps the amount out of the dispute rate and avoids the fee a lost claim could carry.
    const feeAvoided = inquiryRefund && r.amount >= feeExemptBelow && r.kind !== 'INR' ? feeStandard : 0
    const kept = code === 'RESOLVED_SELLER_FAVOUR' ? r.amount : 0
    return {
      disputeId: r.disputeId,
      kind: r.kind,
      amount: r.amount,
      outcome: code,
      reason,
      paidToBuyer: round2(refunded),
      keptRevenue: round2(kept),
      feeAvoided,
      keptOutOfRate: inquiryRefund ? r.amount : 0,
      simulation: sim,
    }
  })
  const real = rows.filter((r) => !r.simulation)
  const sum = (arr, k) => round2(arr.reduce((s, r) => s + r[k], 0))
  return {
    rows,
    totals: { feeAvoided: sum(real, 'feeAvoided'), keptOutOfRate: sum(real, 'keptOutOfRate'), paidToBuyer: sum(real, 'paidToBuyer') },
    simulatedTotals: { keptRevenue: sum(rows.filter((r) => r.simulation), 'keptRevenue') },
    note: 'Fee avoided is the standard fee a lost claim would have carried. Seller-favour endings made with the sandbox adjudicate call are simulations and are not added to the totals.',
  }
}
