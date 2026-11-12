import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../server/session.js'
import { createHybridPaypal } from '../server/paypal/index.js'
import { MockDisputeService } from '../server/paypal/mockDisputes.js'
import { buildSnapshot } from '../server/snapshot.js'
import { createCard, approveCard } from '../server/approvals.js'
import { bannerFor } from '../server/judge/banner.js'

// A fake "real sandbox": another stand-in holding one SNAD USD 66.12 Wool Blanket case with a sandbox-style id.
function fakeSandbox(id) {
  const service = new MockDisputeService({ scale: 1000 })
  service.create({ disputeId: id, kind: 'SNAD', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', amount: 66.12, item: 'Wool Blanket', buyerMessage: 'Wrong material.', settled: true, createdAt: Date.now() - 3_600_000 })
  const calls = []
  return {
    calls,
    getDispute: async (x) => service.getDispute(x),
    act: async (x, action, payload, files) => {
      calls.push(action)
      return service.act(x, action, payload, files)
    },
  }
}

const viewOf = async (s) => {
  const { view } = await buildSnapshot(s)
  return { gauges: JSON.stringify(view.gauges), labels: view.cases.map((c) => `${c.label}:${c.kind}:${c.amount}`).join() }
}

test('sandbox demo mode: the real case plays A and the plan numbers equal the offline demo', async () => {
  const offline = await viewOf(createSession())
  const real = fakeSandbox('PP-R-TST-10300001')
  const s = createSession()
  s.paypal = createHybridPaypal(['PP-R-TST-10300001'], real)
  const hybrid = await viewOf(s)
  assert.equal(hybrid.labels, offline.labels)
  assert.equal(hybrid.gauges, offline.gauges)
  assert.deepEqual(s.paypal.realIds, ['PP-R-TST-10300001'])
  assert.match(bannerFor({ mode: 'hybrid', claim: null, realIds: s.paypal.realIds }).text, /real PayPal sandbox dispute \(PP-R-TST-10300001\)/)
})

test('sandbox demo mode: approving the refund on A goes to the real client, B stays on the stand-in, and A is used once', async () => {
  const id = 'PP-R-TST-10300002'
  const real = fakeSandbox(id)
  const s = createSession()
  s.paypal = createHybridPaypal([id], real)
  await buildSnapshot(s)
  const card = await createCard(s, { disputeId: id, action: 'accept_claim', params: {} })
  await approveCard(s, card.id, { hash: card.hash, token: card.token })
  assert.deepEqual(real.calls, ['accept_claim'])
  assert.equal(s.paypal.nextChangeOf(id).live, true)
  const b = 'PP-R-CLK-10200002'
  const cardB = await createCard(s, { disputeId: b, action: 'accept_claim', params: {} })
  await approveCard(s, cardB.id, { hash: cardB.hash, token: cardB.token })
  assert.deepEqual(real.calls, ['accept_claim'], 'case B never reaches the sandbox')

  // A second visitor no longer gets the used case: A falls back to the stand-in and the banner says so.
  const other = createSession()
  other.paypal = createHybridPaypal([id], real)
  const v = await viewOf(other)
  assert.deepEqual(other.paypal.realIds, [])
  assert.match(v.labels, /^A:SNAD:66.12/)
  assert.match(bannerFor({ mode: 'hybrid', claim: null, realIds: [] }).text, /all|every prepared real sandbox case/)
})

test('sandbox demo mode: an id the sandbox does not know is skipped', async () => {
  const real = fakeSandbox('PP-R-TST-10300003')
  const s = createSession()
  s.paypal = createHybridPaypal(['PP-R-NOP-10399999', 'PP-R-TST-10300003'], real)
  await buildSnapshot(s)
  assert.deepEqual(s.paypal.realIds, ['PP-R-TST-10300003'])
})
