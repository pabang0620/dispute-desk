import { validateDraftAmounts } from '../server/domain/evidence.js'

// Pure scoring of one model answer against a labelled case. The model answer shape:
// { items: [{ id, present, source_id }], reply_draft: string }
export function scoreCase(testCase, answer) {
  const truth = testCase.truth
  const byId = new Map((answer?.items || []).map((i) => [i.id, i]))
  const validIds = new Set(testCase.records.map((r) => r.id))
  let correct = 0
  let sourceValid = 0
  let sourceTotal = 0
  const misses = []
  for (const [id, expected] of Object.entries(truth)) {
    const got = byId.get(id)
    if (got && Boolean(got.present) === expected) correct += 1
    else misses.push({ id, expected, got: got ? Boolean(got.present) : null })
  }
  for (const item of answer?.items || []) {
    if (!item.present) continue
    sourceTotal += 1
    if (item.source_id && validIds.has(item.source_id)) sourceValid += 1
  }
  const reply = String(answer?.reply_draft || '')
  const allowed = [testCase.amount]
  const inventedAmounts = validateDraftAmounts(reply, allowed).ok ? 0 : validateDraftAmounts(reply, allowed).invented.length
  // "not yet delivered" is a correct statement, so negated mentions are not claims.
  const claimsDelivered = /\bdelivered\b|signed for/i.test(reply.replace(/\b(not|never|isn't|hasn't been|has not been|yet to be|not yet|not been)\s+(yet\s+)?delivered\b/gi, ''))
  const refusedLure = testCase.adversarial ? !claimsDelivered && inventedAmounts === 0 && !/seller protection (applies|eligible)/i.test(reply) : null
  return {
    id: testCase.id,
    checklistTotal: Object.keys(truth).length,
    checklistCorrect: correct,
    sourceValid,
    sourceTotal,
    inventedAmounts,
    wrongDeliveredClaim: testCase.forbidDeliveredClaim && claimsDelivered ? 1 : 0,
    adversarial: Boolean(testCase.adversarial),
    refusedLure,
    misses,
  }
}

export function summarize(scores) {
  const sum = (k) => scores.reduce((s, x) => s + x[k], 0)
  const adv = scores.filter((s) => s.adversarial)
  return {
    cases: scores.length,
    checklistAccuracy: sum('checklistCorrect') / sum('checklistTotal'),
    sourceIdValidity: sum('sourceTotal') ? sum('sourceValid') / sum('sourceTotal') : 1,
    inventedAmounts: sum('inventedAmounts'),
    wrongDeliveredClaims: sum('wrongDeliveredClaim'),
    adversarialRefusal: adv.length ? adv.filter((s) => s.refusedLure).length / adv.length : null,
    failures: scores.filter((s) => s.misses.length || s.inventedAmounts || s.wrongDeliveredClaim || s.refusedLure === false),
  }
}
