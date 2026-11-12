import { evaluatePlan, searchPlans, breakEvenAcceptance, planKey, declinedBranch } from './ratePlan.js'
import { countsForWindow, claimWindowFor } from './windows.js'
import { round2, pctString, toCents } from './money.js'
import { TIER } from './rules.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mdy = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const rangeText = (from, to) => `${mdy(from)} - ${mdy(to)}`

function gauge(r) {
  return { rate: r.rate, pct: pctString(r.rate), tier: r.tier }
}

function describeChoices(cases, choices, offerAmount) {
  return cases
    .map((c) => {
      const ch = choices[c.label]
      const word = ch.action === 'refund' ? 'Refund' : ch.action === 'fight' ? 'Fight' : `Offer $${offerAmount}`
      return `${word} ${c.label}`
    })
    .join(', ')
}

// The "case-by-case" plan: settle each case the cheapest way it can be settled; Seller Protection cases are fought.
export function caseByCasePlan(cases, assumptions, offerAmount, ledger, period) {
  const choices = {}
  for (const c of cases) {
    if (c.spEligible) {
      choices[c.label] = { action: 'fight' }
      continue
    }
    const refund = c.amount
    const offerOk = c.amount > offerAmount
    const fightExp = evaluatePlan({ ledger, cases, choices: allWith(cases, c.label, { action: 'fight' }), assumptions, offerAmount, period }).decisions[c.label].options.fight.expectedCost
    const offerExp = offerOk ? assumptions.q * offerAmount + (1 - assumptions.q) * fightExp : Infinity
    choices[c.label] = offerExp < refund ? { action: 'offer', amount: offerAmount } : { action: 'refund' }
  }
  return choices
}

function allWith(cases, label, choice) {
  return Object.fromEntries(cases.map((c) => [c.label, c.label === label ? choice : { action: 'fight' }]))
}

export function planInputs({ plan, ledger, queue }) {
  const cases = queue.inquiries.map((c) => ({
    label: c.label,
    disputeId: c.disputeId,
    kind: c.kind,
    amount: c.amount,
    tierAtCreation: c.tierAtCreation,
    paymentMethod: c.paymentMethod,
    spEligible: c.spEligible,
  }))
  const fullLedger = {
    ...ledger,
    countedClaims: [
      ...ledger.countedClaims,
      ...queue.claims.map((c) => ({ id: c.disputeId, label: `${c.kind} claim (sandbox)`, amount: c.amount, escalatedOn: c.escalatedOn, source: 'sandbox dispute' })),
    ],
  }
  const assumptions = { q: plan.q, p: plan.p, returnValueRatio: plan.returnValueRatio }
  return { cases, ledger: fullLedger, assumptions, offerAmount: plan.offerAmount, period: plan.period }
}

export function buildPlanView({ plan, ledger, queue, asOf }) {
  const { cases, ledger: fullLedger, assumptions, offerAmount, period } = planInputs({ plan, ledger, queue })
  if (cases.length === 0) {
    return emptyView({ plan, fullLedger, asOf, queue })
  }
  const preset = caseByCasePlan(cases, assumptions, offerAmount, fullLedger, period)
  const choices = {}
  for (const c of cases) {
    const picked = plan.choices?.[c.label]
    const canOffer = c.amount > offerAmount && !c.spEligible
    choices[c.label] = picked && (picked.action !== 'offer' || canOffer) ? (picked.action === 'offer' ? { action: 'offer', amount: offerAmount } : picked) : preset[c.label]
  }
  const run = (ch, per = period) => evaluatePlan({ ledger: fullLedger, cases, choices: ch, assumptions, offerAmount, period: per })
  const current = run(choices)
  const searched = searchPlans({ ledger: fullLedger, cases, assumptions, offerAmount, period })
  const best = searched[0]
  const fightAll = Object.fromEntries(cases.map((c) => [c.label, { action: 'fight' }]))
  // Y is the cheapest plan that never reaches the High Volume line (P(1.5%+) = 0). It is not always the overall
  // cheapest plan: with a high acceptance probability the offer plan wins on expected cost but is not account safe.
  const safe = searched.find((s) => s.result.pHighVolume < 1e-9) || [...searched].sort((a, b) => a.result.pHighVolume - b.result.pHighVolume || a.result.total - b.result.total)[0]
  const named = [
    { id: 'X', title: 'Case by case', choices: preset },
    { id: 'Y', title: 'Account safe', choices: safe.choices },
    { id: 'Z', title: 'Fight everything', choices: fightAll },
  ]
  const knownKeys = new Set(named.map((n) => planKey(n.choices)))
  const plans = [
    ...named.map((n) => planRow(n.id, n.title, n.choices, run(n.choices), cases, offerAmount)),
    ...searched.filter((s) => !knownKeys.has(s.key)).map((s) => planRow('ref', 'Other combination', s.choices, s.result, cases, offerAmount)),
  ]
  const bestText = describeChoices(cases, best.choices, offerAmount)
  const recommendedId = plans.find((p) => p.description === bestText)?.id || 'ref'
  const win = claimWindowFor(nextMonthStart(asOf), plan.windowAssumption)
  const breakEven = {}
  if (cases.length <= 8) {
    for (const c of cases) {
      if (c.amount <= offerAmount || c.spEligible) continue
      breakEven[c.label] = {
        window: breakEvenAcceptance({ ledger: fullLedger, cases, assumptions, offerAmount, period: 'window', label: c.label }),
        decOnly: breakEvenAcceptance({ ledger: fullLedger, cases, assumptions, offerAmount, period: 'decOnly', label: c.label }),
      }
    }
  }
  const otherPeriod = period === 'window' ? 'decOnly' : 'window'
  const otherBest = searchPlans({ ledger: fullLedger, cases, assumptions, offerAmount, period: otherPeriod })[0]
  const worst = current.worst
  return {
    asOf,
    ledgerSource: 'demo store ledger',
    store: { netSales: ledger.netSales3mo, salesCount: ledger.salesCount },
    assumptions: { q: plan.q, p: plan.p, returnValueRatio: plan.returnValueRatio, offerAmount, period, windowAssumption: plan.windowAssumption },
    appliesTo: { monthLabel: monthName(nextMonthStart(asOf)), windowText: rangeText(win.from, win.to), from: win.from, to: win.to },
    gauges: {
      counted: gauge(current.current),
      worst: gauge(worst),
      plan: {
        branches: current.branches.map((b) => ({ tag: b.tag, prob: b.prob, pct: pctString(b.rate), tier: b.tier, claims: round2(b.claims) })),
        pHighVolume: current.pHighVolume,
        tier: current.branches.some((b) => b.tier === TIER.HIGH_VOLUME) ? TIER.HIGH_VOLUME : TIER.STANDARD,
      },
      line: { pct: '1.50' },
    },
    counted: fullLedger.countedClaims.map((c) => ({ id: c.id, label: c.label, amount: c.amount, escalatedOn: c.escalatedOn, dropsOutOn: countsForWindow(c.escalatedOn, plan.windowAssumption).dropsOut })),
    cases: cases.map((c) => {
      const q = queue.inquiries.find((x) => x.label === c.label)
      const d = current.decisions[c.label]
      return {
        label: c.label,
        disputeId: c.disputeId,
        kind: c.kind,
        item: q.item,
        amount: c.amount,
        spEligible: c.spEligible,
        spSummary: q.spCheck.summary,
        choice: choices[c.label],
        preset: preset[c.label],
        canOffer: c.amount > offerAmount && !c.spEligible,
        dueDate: q.dueDate,
        counts: countsForWindow(asOf, plan.windowAssumption),
        options: roundOptions(d.options, c.amount),
        cheapestPerCase: d.cheapestPerCase,
        rules: d.rules,
        rateDeltaNow: choices[c.label].action === 'refund' ? 0 : c.amount,
        impact: impactFor(c, choices, run, offerAmount),
      }
    }),
    tierCost: { total: round2(current.tierCost.total), parts: current.tierCost.parts.map((p) => ({ key: p.key, count: p.count, unit: p.unit, subtotal: round2(p.subtotal) })), period, estimate: true },
    totals: { cases: round2(current.casesExpected), tier: round2(current.tierExpected), total: round2(current.total) },
    plans,
    recommended: { id: recommendedId, choices: best.choices, total: round2(best.result.total), text: describeChoices(cases, best.choices, offerAmount) },
    otherPeriod: { period: otherPeriod, bestKey: otherBest.key, bestTotal: round2(otherBest.result.total), changesAdvice: otherBest.key !== best.key },
    breakEven,
    sentence: composeSentence({ current, cases, best, preset, run, offerAmount, plan, asOf }),
    claimsStage: queue.claims.map((c) => ({ disputeId: c.disputeId, kind: c.kind, amount: c.amount, escalatedOn: c.escalatedOn, counts: countsForWindow(c.escalatedOn, plan.windowAssumption) })),
    version: plan.version,
  }
}

// What each action on this case does to the projected rate, holding the other cases at their current choice.
function impactFor(c, choices, run, offerAmount) {
  const out = {}
  const options = [['refund', { action: 'refund' }], ['fight', { action: 'fight' }]]
  if (c.amount > offerAmount && !c.spEligible) options.push(['offer', { action: 'offer', amount: offerAmount }])
  for (const [key, choice] of options) {
    const r = run({ ...choices, [c.label]: choice })
    out[key] = { branches: r.branches.map((b) => ({ tag: b.tag, prob: b.prob, pct: pctString(b.rate), tier: b.tier })), pHighVolume: r.pHighVolume }
  }
  return out
}

function emptyView({ plan, fullLedger, asOf, queue }) {
  return {
    asOf,
    ledgerSource: 'demo store ledger',
    empty: true,
    assumptions: { q: plan.q, p: plan.p, offerAmount: plan.offerAmount, period: plan.period, windowAssumption: plan.windowAssumption },
    cases: [],
    plans: [],
    counted: fullLedger.countedClaims,
    claimsStage: queue.claims,
    sentence: 'No open PayPal inquiries to plan.',
    version: plan.version,
  }
}

function planRow(id, title, choices, result, cases, offerAmount) {
  return {
    id,
    title,
    description: describeChoices(cases, choices, offerAmount),
    choices,
    total: round2(result.total),
    casesExpected: round2(result.casesExpected),
    tierExpected: round2(result.tierExpected),
    pHighVolume: result.pHighVolume,
    ratesPct: result.branches.map((b) => ({ tag: b.tag, pct: pctString(b.rate), tier: b.tier, prob: b.prob })),
  }
}

function roundOptions(o, amount) {
  return {
    refund: { cost: round2(o.refund.cost), rateDelta: 0 },
    offer: {
      offerAmount: o.offer.offerAmount,
      acceptCost: round2(o.offer.acceptCost),
      declineExpectedCost: round2(o.offer.declineExpectedCost),
      expectedCost: round2(o.offer.expectedCost),
      rateDeltaIfDeclined: amount,
    },
    fight: {
      sellerProtection: o.fight.sellerProtection,
      loseCost: round2(o.fight.loseCost),
      winCost: round2(o.fight.winCost),
      expectedCost: round2(o.fight.expectedCost),
      loseWithReturn: o.fight.loseWithReturn ?? null,
      winProbabilityShown: o.fight.winProbabilityShown,
      fee: o.fight.fee,
      rateDelta: amount,
    },
  }
}

function composeSentence({ current, cases, best, preset, run, offerAmount, plan, asOf }) {
  const month = monthName(nextMonthStart(asOf))
  const pct = (r) => pctString(r.rate)
  const bestRun = run(best.choices)
  const bestPct = bestRun.branches.map((b) => pctString(b.rate)).join(' / ')
  const parts = [
    `Counted so far for ${month}'s rate: ${pct(current.current)}%.`,
    `If all ${cases.length} open inquiries become claims: ${pct(current.worst)}%.`,
    `${describeChoices(cases, best.choices, offerAmount)}: projected ${bestPct}%, ${bestRun.pHighVolume === 0 ? 'under 1.5%' : 'with a chance of 1.5% or more'}.`,
  ]
  const offered = cases.find((c) => preset[c.label].action === 'offer')
  if (offered && best.choices[offered.label].action !== 'offer') {
    const declined = declinedBranch(run(preset).branches, offered.label)
    if (declined) {
      const w = countsForWindow(asOf, plan.windowAssumption)
      parts.push(`The cheaper-looking $${offerAmount} offer on ${offered.label} loses if the buyer declines, because the rate would reach ${pctString(declined.rate)}% for disputes created ${rangeText(w.from, w.to)}.`)
    }
  }
  return parts.join(' ')
}

const nextMonthStart = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}
const monthName = (iso) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(iso.slice(5, 7)) - 1]
export { toCents }
