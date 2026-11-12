import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCaseOptions } from '../server/domain/decision.js'
import { sellerProtectionCheck } from '../server/domain/sellerProtection.js'
import { TIER } from '../server/domain/rules.js'
import { stableStringify, requestHash } from '../server/domain/hash.js'
import { buildSavings } from '../server/savings.js'

const asm = { q: 0.5, p: 0.4 }

test('P8 Standard tier: fee waived under $30 and for Seller Protection, reimbursed on a win, $15 on a loss', () => {
  const big = computeCaseOptions({ label: 'X', amount: 100, kind: 'SNAD' }, asm, { offerAmount: 20 })
  assert.equal(big.options.fight.loseCost, 115)
  assert.equal(big.options.fight.winCost, 0)
  const small = computeCaseOptions({ label: 'X', amount: 29.99, kind: 'SNAD' }, asm, { offerAmount: 20 })
  assert.equal(small.options.fight.loseCost, 29.99)
})

test('P6 High Volume tier: $30 even when the seller wins, Seller Protection is not counted', () => {
  const hv = computeCaseOptions({ label: 'X', amount: 100, kind: 'INR', tierAtCreation: TIER.HIGH_VOLUME }, asm, { offerAmount: 20, spEligible: true })
  assert.equal(hv.options.fight.sellerProtection, false)
  assert.equal(hv.options.fight.winCost, 30)
  assert.equal(hv.options.fight.loseCost, 130)
  assert.equal(hv.options.fight.expectedCost, 0.6 * 130 + 0.4 * 30)
})

test('P1/P9 card (ACDC) transactions use the $20 chargeback fee and no dispute fee', () => {
  const acdc = computeCaseOptions({ label: 'X', amount: 100, kind: 'INR', paymentMethod: 'ACDC' }, asm, { offerAmount: 20 })
  assert.equal(acdc.options.fight.loseCost, 120)
  assert.ok(acdc.rules.some((r) => /chargeback fee \$20/.test(r)))
})

test('P12 not-as-described: expected cost assumes no return, the returned-item value is shown beside it', () => {
  const o = computeCaseOptions({ label: 'A', amount: 66.12, kind: 'SNAD' }, { ...asm, returnValueRatio: 0.5 }, { offerAmount: 20 })
  assert.equal(o.options.fight.loseCost, 81.12)
  assert.equal(o.options.fight.loseWithReturn, 48.06)
  assert.equal(computeCaseOptions({ label: 'C', amount: 41.37, kind: 'INR' }, asm, {}).options.fight.loseWithReturn, null)
})

test('P11 Seller Protection check: item not received, PayPal-filed, delivered, address match, physical, Standard tier', () => {
  const base = { kind: 'INR', filedWith: 'PAYPAL', tracking: { status: 'DELIVERED' }, transactionAddress: '18 Alder Row, Portland, OR', shipToAddress: '18 alder row portland or', physical: true, tier: TIER.STANDARD }
  assert.equal(sellerProtectionCheck(base).eligible, true)
  assert.equal(sellerProtectionCheck({ ...base, kind: 'SNAD' }).eligible, false)
  assert.equal(sellerProtectionCheck({ ...base, filedWith: 'ISSUER' }).eligible, false)
  assert.equal(sellerProtectionCheck({ ...base, tracking: { status: 'IN_TRANSIT' } }).eligible, false)
  assert.equal(sellerProtectionCheck({ ...base, shipToAddress: '1 Other Street' }).eligible, false)
  assert.equal(sellerProtectionCheck({ ...base, physical: false }).eligible, false)
  const hv = sellerProtectionCheck({ ...base, tier: TIER.HIGH_VOLUME })
  assert.equal(hv.eligible, false)
  assert.equal(hv.mayNotApply, true)
})

test('stable hash ignores key order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } }), stableStringify({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }))
  assert.equal(requestHash({ disputeId: 'x', action: 'a', payload: { n: 1, m: 2 } }), requestHash({ disputeId: 'x', action: 'a', payload: { m: 2, n: 1 } }))
})

test('Saved vs Advised keeps sandbox simulations apart from real results', () => {
  const resolved = [
    { disputeId: 'D1', kind: 'SNAD', amount: 66.12, outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', outcome_reason: 'SELLER_ISSUED_REFUND' } },
    { disputeId: 'D2', kind: 'SNAD', amount: 55, outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR', outcome_reason: 'INELIGIBLE_BUYER_PROTECTION_POLICY' } },
  ]
  const details = new Map([['D1', { dispute_outcome: { amount_refunded: { value: '66.12' } } }], ['D2', { dispute_outcome: {} }]])
  const s = buildSavings({ resolved, details, simulated: new Set(['D2']) })
  assert.equal(s.totals.feeAvoided, 15)
  assert.equal(s.totals.keptOutOfRate, 66.12)
  assert.equal(s.simulatedTotals.keptRevenue, 55)
  assert.equal(s.rows.find((r) => r.disputeId === 'D2').simulation, true)
})
