import test from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIO, scenarioLedger, scenarioCases, scenarioAssumptions } from '../server/domain/scenario.js'
import { evaluatePlan, searchPlans, breakEvenAcceptance, tierCostEstimate } from '../server/domain/ratePlan.js'
import { computeCaseOptions } from '../server/domain/decision.js'
import { countsForWindow } from '../server/domain/windows.js'
import { TIER, tierFor } from '../server/domain/rules.js'

const ledger = scenarioLedger()
const cases = scenarioCases()
const assumptions = scenarioAssumptions()
const offerAmount = SCENARIO.offerAmount
const pct = (r) => (r * 100).toFixed(2)
const money = (v) => (Math.round(v * 100) / 100).toFixed(2)

const PLAN_X = { A: { action: 'offer', amount: offerAmount }, B: { action: 'refund' }, C: { action: 'fight' } }
const PLAN_Y = { A: { action: 'refund' }, B: { action: 'refund' }, C: { action: 'fight' } }
const PLAN_Z = { A: { action: 'fight' }, B: { action: 'fight' }, C: { action: 'fight' } }
const run = (choices, extra = {}) => evaluatePlan({ ledger, cases, choices, assumptions, offerAmount, ...extra })

test('7-3 rates: counted so far 1.30%, worst case 1.82% (High Volume)', () => {
  const r = run(PLAN_Y)
  assert.equal(pct(r.current.rate), '1.30')
  assert.equal(r.current.tier, TIER.STANDARD)
  assert.equal(pct(r.worst.rate), '1.82')
  assert.equal(r.worst.tier, TIER.HIGH_VOLUME)
  assert.equal(money(r.worst.rate * 24000), '437.89')
})

test('7-3 plan Y: refund A and B, fight C keeps the projection at 1.47% Standard', () => {
  const r = run(PLAN_Y)
  assert.equal(r.branches.length, 1)
  assert.equal(pct(r.branches[0].rate), '1.47')
  assert.equal(r.branches[0].tier, TIER.STANDARD)
  assert.equal(money(r.branches[0].claims), '353.37')
  assert.equal(r.pHighVolume, 0)
})

test('7-3 plan X: a declined offer on A reaches 1.75% High Volume, accepted stays 1.47%', () => {
  const r = run(PLAN_X)
  const accepted = r.branches.find((b) => b.tag === 'A:accepted')
  const declined = r.branches.find((b) => b.tag === 'A:declined')
  assert.equal(pct(accepted.rate), '1.47')
  assert.equal(pct(declined.rate), '1.75')
  assert.equal(declined.tier, TIER.HIGH_VOLUME)
  assert.equal(r.pHighVolume, 0.5)
})

test('7-3 other combinations: C+B claims is 1.55%, C+A is 1.75%', () => {
  const cb = run({ A: { action: 'refund' }, B: { action: 'fight' }, C: { action: 'fight' } })
  assert.equal(pct(cb.branches[0].rate), '1.55')
  assert.equal(cb.branches[0].tier, TIER.HIGH_VOLUME)
  const ca = run({ A: { action: 'fight' }, B: { action: 'refund' }, C: { action: 'fight' } })
  assert.equal(pct(ca.branches[0].rate), '1.75')
})

test('7-3 per-case expected costs', () => {
  const a = computeCaseOptions(cases[0], assumptions, { offerAmount })
  assert.equal(money(a.options.refund.expectedCost), '66.12')
  assert.equal(money(a.options.fight.loseCost), '81.12')
  assert.equal(money(a.options.fight.expectedCost), '48.67')
  assert.equal(money(a.options.offer.expectedCost), '34.34')
  assert.equal(a.cheapestPerCase, 'offer', 'per case the $20 offer looks cheapest')
  const b = computeCaseOptions(cases[1], assumptions, { offerAmount })
  assert.equal(money(b.options.refund.expectedCost), '18.40')
  assert.equal(money(b.options.fight.loseCost), '18.40', 'under $30 the standard fee is waived')
  assert.equal(money(b.options.fight.expectedCost), '11.04')
  const c = computeCaseOptions(cases[2], assumptions, { offerAmount, spEligible: true })
  assert.equal(c.options.fight.sellerProtection, true)
  assert.equal(c.options.fight.winProbabilityShown, false)
  assert.equal(c.options.fight.expectedCost, 0)
})

test('7-3 tier cost estimate is $150 for the window and $50 for December only', () => {
  assert.equal(tierCostEstimate(ledger.pastDisputes, 'window').total, 150)
  const parts = tierCostEstimate(ledger.pastDisputes, 'window').parts
  assert.deepEqual(parts.map((p) => p.subtotal), [0, 90, 60])
  assert.equal(money(tierCostEstimate(ledger.pastDisputes, 'decOnly').total), '50.00')
})

test('7-3 plan totals X 127.74, Y 84.52, Z 209.71', () => {
  assert.equal(money(run(PLAN_X).total), '127.74')
  assert.equal(money(run(PLAN_X).casesExpected), '52.74')
  assert.equal(money(run(PLAN_X).tierExpected), '75.00')
  assert.equal(money(run(PLAN_Y).total), '84.52')
  assert.equal(money(run(PLAN_Z).total), '209.71')
  assert.equal(money(run(PLAN_Z).casesExpected), '59.71')
})

test('7-3 reference combinations 227.16, 195.38, 217.07', () => {
  assert.equal(money(run({ A: { action: 'refund' }, B: { action: 'fight' }, C: { action: 'fight' } }).total), '227.16')
  assert.equal(money(run({ A: { action: 'offer', amount: offerAmount }, B: { action: 'fight' }, C: { action: 'fight' } }).total), '195.38')
  assert.equal(money(run({ A: { action: 'fight' }, B: { action: 'refund' }, C: { action: 'fight' } }).total), '217.07')
})

test('7-3 plan Y is cheaper than X by 43.22 and than Z by 125.19, and is the best of all combinations', () => {
  const x = run(PLAN_X).total
  const y = run(PLAN_Y).total
  const z = run(PLAN_Z).total
  assert.equal(money(x - y), '43.22')
  assert.equal(money(z - y), '125.19')
  const plans = searchPlans({ ledger, cases, assumptions, offerAmount, fixed: { C: { action: 'fight' } } })
  assert.equal(plans[0].key, 'A:refund B:refund C:fight')
  assert.equal(plans.length, 6)
})

test('7-3 acceptance probability q: break-even at 0.742, and q = 0.8 makes the offer win at 74.13', () => {
  const q = breakEvenAcceptance({ ledger, cases, assumptions, offerAmount, period: 'window', label: 'A', fixed: { C: { action: 'fight' } } })
  assert.equal(q, 0.742)
  const high = evaluatePlan({ ledger, cases, choices: PLAN_X, assumptions: { ...assumptions, q: 0.8 }, offerAmount })
  assert.equal(money(high.total), '74.13')
  assert.ok(high.total < run(PLAN_Y).total)
  const plans = searchPlans({ ledger, cases, assumptions: { ...assumptions, q: 0.8 }, offerAmount, fixed: { C: { action: 'fight' } } })
  assert.equal(plans[0].key, 'A:offer20 B:refund C:fight')
})

test('7-3 period December only: tier cost 50, X 77.74 wins, break-even q 0.414', () => {
  const x = run(PLAN_X, { period: 'decOnly' })
  assert.equal(money(x.total), '77.74')
  assert.equal(money(run(PLAN_Y, { period: 'decOnly' }).total), '84.52')
  assert.equal(money(run(PLAN_Z, { period: 'decOnly' }).total), '109.71')
  const plans = searchPlans({ ledger, cases, assumptions, offerAmount, period: 'decOnly', fixed: { C: { action: 'fight' } } })
  assert.equal(plans[0].key, 'A:offer20 B:refund C:fight')
  const q = breakEvenAcceptance({ ledger, cases, assumptions, offerAmount, period: 'decOnly', label: 'A', fixed: { C: { action: 'fight' } } })
  assert.equal(q, 0.414)
})

test('7-2 refunds excluded from net sales: Y 1.48%, declined X 1.75% (conclusion unchanged)', () => {
  const y = run(PLAN_Y, { denominator: 'netMinusPlannedRefunds' })
  assert.equal(pct(y.branches[0].rate), '1.48')
  const x = run(PLAN_X, { denominator: 'netMinusPlannedRefunds' })
  assert.equal(pct(x.branches.find((b) => b.tag === 'A:declined').rate), '1.75')
})

test('7-2 3-month window: escalated in Nov counts Dec 1 to Feb 28, drops out Mar 1 (assumption a)', () => {
  assert.deepEqual(countsForWindow('2026-11-12', 'a'), { from: '2026-12-01', to: '2027-02-28', dropsOut: '2027-03-01' })
  assert.deepEqual(countsForWindow('2026-12-01', 'a'), { from: '2027-01-01', to: '2027-03-31', dropsOut: '2027-04-01' })
  assert.deepEqual(countsForWindow('2026-11-12', 'b'), { from: '2026-11-01', to: '2027-01-31', dropsOut: '2027-02-01' })
})

test('P4: High Volume needs more than 100 sales and a rate of 1.5% or more', () => {
  assert.equal(tierFor({ claimsCents: 1500, salesCents: 100000, salesCount: 101 }).tier, TIER.HIGH_VOLUME)
  assert.equal(tierFor({ claimsCents: 1499, salesCents: 100000, salesCount: 101 }).tier, TIER.STANDARD)
  assert.equal(tierFor({ claimsCents: 5000, salesCents: 100000, salesCount: 100 }).tier, TIER.STANDARD)
})

test('scenario.json expected block matches the code', () => {
  const e = SCENARIO.expected
  const y = run(PLAN_Y)
  assert.equal(pct(y.current.rate), e.ratesPct.counted)
  assert.equal(pct(y.worst.rate), e.ratesPct.worst)
  assert.equal(money(run(PLAN_X).total), money(e.planTotals.X))
})
