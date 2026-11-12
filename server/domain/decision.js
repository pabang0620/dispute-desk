import { RULES, TIER } from './rules.js'
import { round2 } from './money.js'

// Per-case cost of the three paths (PLAN 7-2). The model never touches these numbers.
// Costs are the seller's out-of-pocket dollars; the dispute-rate effect is returned separately.

function feeFor({ tier, paymentMethod, amount, spEligible, outcome }) {
  if (paymentMethod === 'ACDC') return RULES.chargebackFee // P1/P9: card transactions use the chargeback fee table
  if (tier === TIER.HIGH_VOLUME) return RULES.highVolumeFee // P6: charged even when the seller wins, never reimbursed
  const waived = spEligible || amount < RULES.standardFeeExemptBelow // P8
  if (waived) return 0
  return outcome === 'win' ? 0 : RULES.standardFee // P8: reimbursed when the seller wins
}

export function fightOutcome(kase, assumptions, spEligible) {
  const { amount, kind, paymentMethod = 'PAYPAL' } = kase
  const tier = kase.tierAtCreation || TIER.STANDARD
  const sp = spEligible && tier !== TIER.HIGH_VOLUME && paymentMethod !== 'ACDC'
  if (sp) {
    return { sellerProtection: true, loseCost: 0, winCost: 0, expectedCost: 0, fee: 0, winProbabilityShown: false }
  }
  const loseFee = feeFor({ tier, paymentMethod, amount, spEligible: false, outcome: 'lose' })
  const winFee = feeFor({ tier, paymentMethod, amount, spEligible: false, outcome: 'win' })
  const loseCost = amount + loseFee
  const winCost = winFee
  const p = assumptions.p
  const expectedCost = (1 - p) * loseCost + p * winCost
  // P12: for not-as-described PayPal may require the buyer to return the item, so the loss can be smaller.
  // The expected cost assumes no return (worst case); the returned-item value is shown beside it.
  const ratio = assumptions.returnValueRatio ?? 0.5
  const loseWithReturn = kind === 'SNAD' ? round2(amount - amount * ratio + loseFee) : null
  return { sellerProtection: false, loseCost, winCost, expectedCost, fee: loseFee, loseWithReturn, winProbabilityShown: true }
}

export function computeCaseOptions(kase, assumptions, { offerAmount, spEligible = false } = {}) {
  const amount = kase.amount
  const fight = fightOutcome(kase, assumptions, spEligible)
  const q = assumptions.q
  const x = offerAmount ?? Math.min(20, amount)
  const offer = {
    offerAmount: x,
    q,
    acceptCost: x,
    declineExpectedCost: fight.expectedCost,
    expectedCost: q * x + (1 - q) * fight.expectedCost,
    rateDeltaIfAccepted: 0,
    rateDeltaIfDeclined: amount,
    fee: 0,
  }
  const refund = { cost: amount, expectedCost: amount, fee: 0, rateDelta: 0 }
  const fightOpt = { ...fight, rateDelta: amount }
  const byCase = [
    ['refund', refund.expectedCost],
    ['offer', offer.expectedCost],
    ['fight', fightOpt.expectedCost],
  ].sort((a, b) => a[1] - b[1])[0][0]
  const rules = ruleLines(kase, fight, spEligible)
  return {
    id: kase.label || kase.id,
    amount,
    options: { refund, offer, fight: fightOpt },
    cheapestPerCase: byCase,
    rules,
  }
}

function ruleLines(kase, fight, spEligible) {
  const lines = []
  const tier = kase.tierAtCreation || TIER.STANDARD
  if (kase.paymentMethod === 'ACDC') lines.push('Card (ACDC) transaction: chargeback fee $20, no dispute fee (P1, P9)')
  else if (tier === TIER.HIGH_VOLUME) lines.push('High Volume tier at creation: $30 fee, not reimbursed even if you win (P6)')
  else if (fight.sellerProtection) lines.push('Seller Protection eligible: fee waived (P8, P11)')
  else if (kase.amount < RULES.standardFeeExemptBelow) lines.push(`Under $${RULES.standardFeeExemptBelow}: standard fee waived (P8)`)
  else lines.push(`Standard fee $${RULES.standardFee}, reimbursed if you win (P8)`)
  if (kase.kind === 'SNAD') lines.push('Not-as-described: PayPal may require the buyer to return the item at the buyer cost (P12)')
  if (kase.kind === 'INR' && !spEligible) lines.push('Seller Protection not confirmed from tracking and address')
  lines.push('A claim escalated to PayPal counts in the dispute rate; an inquiry settled with the buyer does not (P2)')
  return lines
}
