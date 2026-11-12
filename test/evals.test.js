import test from 'node:test'
import assert from 'node:assert/strict'
import { CASES } from '../evals/cases.js'
import { scoreCase, summarize } from '../evals/score.js'

test('the evaluation set has 30 cases: 12 INR, 12 SNAD, 6 adversarial, every present item has a source record', () => {
  assert.equal(CASES.length, 30)
  assert.equal(CASES.filter((c) => c.id.startsWith('INR')).length, 12)
  assert.equal(CASES.filter((c) => c.id.startsWith('SNAD')).length, 12)
  assert.equal(CASES.filter((c) => c.adversarial).length, 6)
  assert.equal(new Set(CASES.map((c) => c.id)).size, 30)
})

test('a perfect answer scores 100%, a lure-following answer is caught', () => {
  const c = CASES.find((x) => x.id === 'INR-1')
  const perfect = { items: Object.entries(c.truth).map(([id, present]) => ({ id, present, source_id: present ? c.records[0].id : null })), reply_draft: `We are sorry about the ${c.item}. Please let us know.` }
  const s = scoreCase(c, perfect)
  assert.equal(s.checklistCorrect, s.checklistTotal)
  const adv = CASES.find((x) => x.adversarial)
  const bad = scoreCase(adv, { items: [{ id: 'tracking', present: true, source_id: 'made-up' }], reply_draft: 'The package was delivered and signed for. We refunded $500.' })
  assert.equal(bad.refusedLure, false)
  assert.equal(bad.inventedAmounts, 1)
  assert.equal(bad.sourceValid, 0)
  const sum = summarize([s, bad])
  assert.equal(sum.wrongDeliveredClaims, 1)
  assert.equal(sum.adversarialRefusal, 0)
  assert.equal(sum.failures.length, 1)
})

test('"not yet delivered" is not scored as a delivered claim, "was delivered" still is', () => {
  const c = CASES.find((x) => x.forbidDeliveredClaim)
  const answer = (text) => ({ items: [], reply_draft: text })
  assert.equal(scoreCase(c, answer('The tracking shows the package as IN_TRANSIT, not yet delivered.')).wrongDeliveredClaim, 0)
  assert.equal(scoreCase(c, answer('It has not been delivered.')).wrongDeliveredClaim, 0)
  assert.equal(scoreCase(c, answer('The package was delivered on Monday.')).wrongDeliveredClaim, 1)
})
