import test from 'node:test'
import assert from 'node:assert/strict'
import { MockDisputeService, SANDBOX_DURATIONS } from '../server/paypal/mockDisputes.js'
import { PayPalError } from '../server/paypal/errors.js'

function setup() {
  let t = 1_800_000_000_000
  const svc = new MockDisputeService({ clock: () => t })
  const advance = (ms) => { t += ms }
  const mk = (kind = 'INR', amount = 41.37) =>
    svc.create({ kind, amount, item: 'Desk Lamp', reason: kind === 'INR' ? 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' : 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', buyerMessage: 'Nothing arrived.' })
  return { svc, advance, mk }
}

test('response shape matches the recorded sandbox dispute (fields, states, links)', () => {
  const { svc, advance, mk } = setup()
  const id = mk()
  assert.match(id, /^PP-R-[A-Z]{3}-\d+$/)
  let d = svc.getDispute(id)
  assert.equal(d.dispute_state, 'UNDER_PAYPAL_REVIEW')
  assert.equal(d.status, 'UNDER_REVIEW')
  assert.deepEqual(d.links.map((l) => l.rel), ['self'])
  advance(SANDBOX_DURATIONS.settle + 1000)
  d = svc.getDispute(id)
  assert.equal(d.dispute_state, 'REQUIRED_ACTION')
  assert.equal(d.status, 'WAITING_FOR_SELLER_RESPONSE')
  assert.deepEqual(d.links.map((l) => l.rel), ['self', 'accept_claim', 'provide_evidence', 'send_message', 'escalate', 'make_offer'])
  for (const key of ['dispute_id', 'create_time', 'update_time', 'disputed_transactions', 'reason', 'dispute_amount', 'dispute_life_cycle_stage', 'dispute_channel', 'messages', 'evidences', 'offer', 'refund_details', 'allowed_response_options', 'seller_response_due_date']) assert.ok(key in d, key)
  assert.equal(d.dispute_amount.value, '41.37')
  assert.equal(d.disputed_transactions[0].gross_amount.currency_code, 'USD')
  assert.equal(d.links[1].href.endsWith(`/v1/customer/disputes/${id}/accept-claim`), true)
  assert.deepEqual(d.allowed_response_options.make_offer.offer_types, ['REFUND'])
  assert.equal(Date.parse(d.seller_response_due_date) - Date.parse(d.create_time) > 19 * 86_400_000, true, 'inquiry reply window is about 20 days')
})

test('list response has items with summary fields and self links', () => {
  const { svc, advance, mk } = setup()
  mk()
  advance(SANDBOX_DURATIONS.settle + 1000)
  const list = svc.listDisputes({ page_size: 50 })
  assert.equal(list.items.length, 1)
  assert.ok(list.items[0].dispute_state && list.items[0].dispute_life_cycle_stage)
  assert.equal(list.items[0].disputed_transactions, undefined)
  assert.equal(list.links[0].rel, 'self')
  assert.equal(svc.listDisputes({ dispute_state: 'RESOLVED' }).items.length, 0)
})

test('a second action while PayPal reviews the first returns 422 ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE', () => {
  const { svc, advance, mk } = setup()
  const id = mk()
  advance(SANDBOX_DURATIONS.settle + 1000)
  const res = svc.act(id, 'send_message', { message: 'Hello' })
  assert.equal(res.links[0].rel, 'detail')
  assert.equal(svc.getDispute(id).dispute_state, 'UNDER_PAYPAL_REVIEW')
  assert.throws(() => svc.act(id, 'send_message', { message: 'Again' }), (e) => e instanceof PayPalError && e.status === 422 && e.issue === 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE')
  advance(SANDBOX_DURATIONS.review + 1000)
  assert.equal(svc.getDispute(id).dispute_state, 'REQUIRED_OTHER_PARTY_ACTION')
  assert.equal(svc.getDispute(id).messages.at(-1).posted_by, 'SELLER')
})

test('accept-claim (JSON note) resolves with SELLER_ISSUED_REFUND and the full amount', () => {
  const { svc, advance, mk } = setup()
  const id = mk()
  advance(SANDBOX_DURATIONS.settle + 1000)
  svc.act(id, 'accept_claim', { note: 'refund_issued' })
  advance(SANDBOX_DURATIONS.refund + 1000)
  const d = svc.getDispute(id)
  assert.equal(d.dispute_state, 'RESOLVED')
  assert.equal(d.dispute_outcome.outcome_code, 'RESOLVED_BUYER_FAVOUR')
  assert.equal(d.dispute_outcome.outcome_reason, 'SELLER_ISSUED_REFUND')
  assert.equal(d.dispute_outcome.amount_refunded.value, '41.37')
  assert.deepEqual(d.links.map((l) => l.rel), ['self'])
})

test('partial offer: buyer accepts, RESOLVED with INQUIRY_OFFER_PARTIAL_REFUND and the offered amount', () => {
  const { svc, advance, mk } = setup()
  const id = mk('SNAD', 66.12)
  advance(SANDBOX_DURATIONS.settle + 1000)
  svc.act(id, 'make_offer', { note: 'partial', offer_amount: { currency_code: 'USD', value: '20.00' }, offer_type: 'REFUND' })
  advance(SANDBOX_DURATIONS.review + 1000)
  svc.buyerAcceptsOffer(id)
  advance(SANDBOX_DURATIONS.offerAccepted + 1000)
  const d = svc.getDispute(id)
  assert.equal(d.dispute_outcome.outcome_reason, 'INQUIRY_OFFER_PARTIAL_REFUND')
  assert.equal(d.dispute_outcome.amount_refunded.value, '20.00')
  assert.throws(() => svc.act(id, 'make_offer', { offer_amount: { value: '90.00' } }), PayPalError)
})

test('fight path: escalate -> CHARGEBACK stage, evidence type must be requested, adjudicate link appears ~12 min later', () => {
  const { svc, advance, mk } = setup()
  const id = mk('SNAD', 55)
  advance(SANDBOX_DURATIONS.settle + 1000)
  svc.act(id, 'escalate', { note: 'Escalating' })
  advance(SANDBOX_DURATIONS.escalate + 1000)
  let d = svc.getDispute(id)
  assert.equal(d.dispute_life_cycle_stage, 'CHARGEBACK')
  assert.deepEqual(d.links.map((l) => l.rel), ['self', 'accept_claim', 'provide_evidence'])
  assert.ok(Date.parse(d.seller_response_due_date) > Date.parse(d.update_time) + 9 * 86_400_000, 'claim stage reply window is about 10 days')
  assert.throws(() => svc.act(id, 'adjudicate', { adjudication_outcome: 'SELLER_FAVOR' }), (e) => e.status === 400)
  assert.throws(() => svc.act(id, 'provide_evidence', { evidence_type: 'PROOF_OF_FULFILLMENT' }), (e) => e.status === 400 && e.issue === 'EVIDENCE_TYPE_IS_NOT_ALLOWED')
})

test('fight path continues: OTHER+PDF evidence, adjudicate link, SELLER_FAVOR ending', () => {
  let t = 1_800_000_000_000
  const svc = new MockDisputeService({ clock: () => t })
  const id = svc.create({ kind: 'SNAD', amount: 55, item: 'Wall Clock', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', buyerMessage: 'wrong material' })
  t += SANDBOX_DURATIONS.settle + 1000
  svc.act(id, 'escalate', { note: 'x' })
  t += SANDBOX_DURATIONS.escalate + 1000
  assert.throws(() => svc.act(id, 'provide_evidence', { evidence_type: 'PROOF_OF_FULFILLMENT' }), (e) => e.issue === 'EVIDENCE_TYPE_IS_NOT_ALLOWED')
  svc.act(id, 'provide_evidence', { evidence_type: 'OTHER', notes: 'photos' }, [{ name: 'evidence.pdf', data: Buffer.from('x') }])
  t += SANDBOX_DURATIONS.review + 1000
  assert.deepEqual(svc.getDispute(id).links.map((l) => l.rel), ['self'], 'no adjudicate link yet')
  assert.throws(() => svc.act(id, 'adjudicate', { adjudication_outcome: 'SELLER_FAVOR' }), (e) => e.status === 400)
  t += SANDBOX_DURATIONS.adjudicateLink
  assert.ok(svc.getDispute(id).links.some((l) => l.rel === 'adjudicate'))
  svc.act(id, 'adjudicate', { adjudication_outcome: 'SELLER_FAVOR' })
  t += SANDBOX_DURATIONS.adjudicate + 1000
  const d = svc.getDispute(id)
  assert.equal(d.dispute_outcome.outcome_code, 'RESOLVED_SELLER_FAVOUR')
  assert.equal(d.dispute_outcome.outcome_reason, 'INELIGIBLE_BUYER_PROTECTION_POLICY')
})

test('require-evidence puts the dispute back to waiting with +3 days', () => {
  let t = 1_800_000_000_000
  const svc = new MockDisputeService({ clock: () => t })
  const id = svc.create({ kind: 'INR', amount: 40, item: 'Lamp', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', buyerMessage: 'x' })
  t += SANDBOX_DURATIONS.settle + 1000
  svc.act(id, 'escalate', {})
  t += SANDBOX_DURATIONS.escalate + 1000
  svc.act(id, 'provide_evidence', { evidence_type: 'OTHER' })
  t += SANDBOX_DURATIONS.review + SANDBOX_DURATIONS.adjudicateLink + 1000
  svc.act(id, 'require_evidence', { action: 'SELLER_EVIDENCE' })
  t += SANDBOX_DURATIONS.requireEvidence + 1000
  const d = svc.getDispute(id)
  assert.equal(d.status, 'WAITING_FOR_SELLER_RESPONSE')
  const days = (Date.parse(d.seller_response_due_date) - t) / 86_400_000
  assert.ok(days > 2.9 && days <= 3.01)
})

test('unknown dispute returns 404 RESOURCE_NOT_FOUND', () => {
  const { svc } = setup()
  assert.throws(() => svc.getDispute('PP-R-AAA-1'), (e) => e.status === 404)
})
