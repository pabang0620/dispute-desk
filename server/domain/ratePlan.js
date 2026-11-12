import { toCents } from './money.js'
import { tierFor, TIER } from './rules.js'
import { computeCaseOptions } from './decision.js'
import { countsForWindow } from './windows.js'

// Account-level dispute-rate plan (PLAN 7-2). All numbers come from code and the demo store ledger.
// Rate = claims escalated to PayPal (or filed with the card issuer) / net sales of the 3 previous months (P2, P3).
// An open inquiry is not in the numerator until it becomes a claim.

export const PERIODS = Object.freeze({ window: 1, decOnly: 1 / 3 })

// Fee difference per past dispute between the High Volume and Standard tiers (help350 exemption lists, P6, P8).
const TIER_DIFF = Object.freeze({ settledAtInquiry: 0, exemptClaims: 30, otherClaims: 15 })

export function tierCostEstimate(pastDisputes, period = 'window') {
  const factor = PERIODS[period] ?? 1
  const parts = [
    { key: 'settledAtInquiry', count: pastDisputes.settledAtInquiry, unit: TIER_DIFF.settledAtInquiry },
    { key: 'exemptClaims', count: pastDisputes.exemptClaims, unit: TIER_DIFF.exemptClaims },
    { key: 'otherClaims', count: pastDisputes.otherClaims, unit: TIER_DIFF.otherClaims },
  ].map((p) => ({ ...p, subtotal: p.count * p.unit * factor }))
  return { total: parts.reduce((s, p) => s + p.subtotal, 0), parts, period, factor }
}

function sumClaims(counted) {
  return counted.reduce((s, c) => s + toCents(c.amount), 0)
}

function caseCost(decision, choice, q) {
  if (choice.action === 'refund') return decision.options.refund.expectedCost
  if (choice.action === 'fight') return decision.options.fight.expectedCost
  const x = choice.amount ?? decision.options.offer.offerAmount
  return q * x + (1 - q) * decision.options.fight.expectedCost
}

// Enumerate the accept/decline branches of every offered case.
function branchesFor(cases, choices, q) {
  let branches = [{ prob: 1, addedCents: 0 }]
  for (const c of cases) {
    const choice = choices[c.label]
    const amt = toCents(c.amount)
    if (choice.action === 'fight') branches = branches.map((b) => ({ ...b, addedCents: b.addedCents + amt }))
    else if (choice.action === 'offer') {
      branches = branches.flatMap((b) => [
        { prob: b.prob * q, addedCents: b.addedCents, tag: [b.tag, `${c.label}:accepted`].filter(Boolean).join(' ') },
        { prob: b.prob * (1 - q), addedCents: b.addedCents + amt, tag: [b.tag, `${c.label}:declined`].filter(Boolean).join(' ') },
      ])
    }
  }
  return branches
}

/**
 * @param ledger { netSales3mo, salesCount, countedClaims[], pastDisputes }
 * @param cases  [{ label, amount, kind, tierAtCreation, paymentMethod, spEligible }]
 * @param choices { [label]: { action: 'refund' | 'offer' | 'fight', amount? } }
 */
export function evaluatePlan({ ledger, cases, choices, assumptions, offerAmount, period = 'window', denominator = 'net' }) {
  const salesCents = toCents(ledger.netSales3mo)
  const counted = sumClaims(ledger.countedClaims)
  const decisions = Object.fromEntries(
    cases.map((c) => [c.label, computeCaseOptions(c, assumptions, { offerAmount, spEligible: Boolean(c.spEligible) })]),
  )
  const worstCents = counted + cases.reduce((s, c) => s + toCents(c.amount), 0)
  const plannedRefundCents = cases.reduce((s, c) => (choices[c.label].action === 'refund' ? s + toCents(c.amount) : s), 0)
  const rateOf = (claimsCents) => {
    const base = denominator === 'netMinusPlannedRefunds' ? salesCents - plannedRefundCents : salesCents
    return tierFor({ claimsCents, salesCents: base, salesCount: ledger.salesCount })
  }

  const branches = branchesFor(cases, choices, assumptions.q).map((b) => {
    const r = rateOf(counted + b.addedCents)
    return { prob: b.prob, tag: b.tag || 'certain', rate: r.rate, tier: r.tier, claims: (counted + b.addedCents) / 100 }
  })
  const pHighVolume = branches.reduce((s, b) => (b.tier === TIER.HIGH_VOLUME ? s + b.prob : s), 0)
  const casesExpected = cases.reduce((s, c) => s + caseCost(decisions[c.label], choices[c.label], assumptions.q), 0)
  const tier = tierCostEstimate(ledger.pastDisputes, period)
  const tierExpected = pHighVolume * tier.total
  return {
    current: rateOf(counted),
    worst: rateOf(worstCents),
    branches,
    pHighVolume,
    casesExpected,
    tierCost: tier,
    tierExpected,
    total: casesExpected + tierExpected,
    decisions,
  }
}

/** The branch where only this case's offer is declined (every other offer accepted): the cleanest read of what one decline does. */
export function declinedBranch(branches, label) {
  return branches.find((b) => {
    const declined = (b.tag || '').split(' ').filter((t) => t.endsWith(':declined'))
    return declined.length === 1 && declined[0] === `${label}:declined`
  })
}

export function planKey(choices) {
  return Object.entries(choices)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v.action}${v.action === 'offer' ? v.amount ?? '' : ''}`)
    .join(' ')
}

const OPTIONS_FOR = (c, offerAmount) => {
  const opts = [{ action: 'refund' }, { action: 'fight' }]
  if (c.amount > offerAmount && !c.spEligible) opts.splice(1, 0, { action: 'offer', amount: offerAmount })
  return opts
}

/** Try every combination (<= 15 cases) and rank by total expected cost. Larger queues use a greedy pass. */
export function searchPlans({ ledger, cases, assumptions, offerAmount, period = 'window', fixed = {} }) {
  const free = cases.filter((c) => !fixed[c.label])
  const combos = free.length <= 15 ? allCombos(free, offerAmount) : greedyCombos(ledger, cases, free, assumptions, offerAmount, period, fixed)
  const plans = combos.map((combo) => {
    const choices = { ...fixed, ...combo }
    const result = evaluatePlan({ ledger, cases, choices, assumptions, offerAmount, period })
    return { choices, key: planKey(choices), result }
  })
  plans.sort((a, b) => a.result.total - b.result.total)
  return plans
}

function allCombos(free, offerAmount) {
  return free.reduce(
    (acc, c) => acc.flatMap((combo) => OPTIONS_FOR(c, offerAmount).map((opt) => ({ ...combo, [c.label]: opt }))),
    [{}],
  )
}

// Greedy for long queues: start from "refund everything", then flip the case whose change lowers the total most.
function greedyCombos(ledger, cases, free, assumptions, offerAmount, period, fixed) {
  let current = Object.fromEntries(free.map((c) => [c.label, { action: 'refund' }]))
  const total = (combo) => evaluatePlan({ ledger, cases, choices: { ...fixed, ...combo }, assumptions, offerAmount, period }).total
  let best = total(current)
  for (let guard = 0; guard < free.length * 3; guard += 1) {
    let improved = null
    for (const c of free) {
      for (const opt of OPTIONS_FOR(c, offerAmount)) {
        if (opt.action === current[c.label].action) continue
        const trial = { ...current, [c.label]: opt }
        const t = total(trial)
        if (t < best - 1e-9) {
          best = t
          improved = trial
        }
      }
    }
    if (!improved) break
    current = improved
  }
  return [current]
}

/** Acceptance probability above which offering `label` beats the best plan that does not offer it. */
export function breakEvenAcceptance({ ledger, cases, assumptions, offerAmount, period, label, fixed = {} }) {
  const without = searchPlans({ ledger, cases, assumptions, offerAmount, period, fixed }).filter((p) => p.choices[label].action !== 'offer')[0]
  const costOffer = (q) => {
    const plans = searchPlans({ ledger, cases, assumptions: { ...assumptions, q }, offerAmount, period, fixed })
    return plans.filter((p) => p.choices[label].action === 'offer')[0].result.total
  }
  const target = without.result.total
  if (costOffer(1) >= target) return null
  if (costOffer(0) <= target) return 0
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (costOffer(mid) > target) lo = mid
    else hi = mid
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000
}

export function datesForOpenCase(c, asOf, assumption) {
  return countsForWindow(asOf, assumption)
}
