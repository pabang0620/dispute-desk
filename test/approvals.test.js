import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../server/session.js'
import { createCard, editCard, approveCard, rejectCard, deadlineInfo, buildRequest } from '../server/approvals.js'
import { requestHash } from '../server/domain/hash.js'
import { HttpError } from '../server/http.js'

const A = 'PP-R-BLK-10200001'
const C = 'PP-R-LMP-10200003'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const approve = (s, card) => approveCard(s, card.id, { hash: card.hash, token: card.token })

test('nothing reaches PayPal until the card is approved', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'accept_claim', params: {} })
  assert.equal(card.status, 'PENDING')
  assert.equal((await s.paypal.getDispute(A)).dispute_state, 'REQUIRED_ACTION')
  assert.equal(s.audit.list().some((e) => e.event === 'paypal_call_ok'), false)
})

test('approval is bound to the sha256 of the request: editing one word voids the hash and needs a new approval', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'send_message', params: { message: 'We will refund you today.' } })
  const stale = { hash: card.hash, token: card.token }
  const before = card.hash
  await editCard(s, card.id, { message: 'We will refund you tomorrow.' })
  assert.notEqual(card.hash, before)
  await assert.rejects(() => approveCard(s, card.id, stale), (e) => e instanceof HttpError && e.status === 409 && /changed/.test(e.message))
  assert.equal((await s.paypal.getDispute(A)).messages.length, 1, 'the old approval sent nothing')
  await approve(s, card)
  assert.equal(card.status, 'EXECUTED')
  assert.equal((await s.paypal.getDispute(A)).messages.at(-1).content, 'We will refund you tomorrow.')
  assert.ok(s.audit.list().some((e) => e.event === 'card_edited_approval_voided'))
})

test('the hash covers the exact request body: same input gives the same hash', async () => {
  const d = await createSession().paypal.getDispute(A)
  const one = buildRequest('make_offer', { amount: 20, note: 'x' }, d)
  const two = buildRequest('make_offer', { amount: 20, note: 'x' }, d)
  const h = (r) => requestHash({ disputeId: A, action: 'make_offer', ...r })
  assert.equal(h(one), h(two))
  assert.notEqual(h(one), h(buildRequest('make_offer', { amount: 21, note: 'x' }, d)))
})

test('an approval is used once: a second approve on an executed card is refused', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'accept_claim', params: {} })
  await approve(s, card)
  await assert.rejects(() => approve(s, card), (e) => e.status === 409)
  assert.equal(s.audit.list().filter((e) => e.event === 'paypal_call_ok').length, 1)
})

test('wrong token is refused; one open card per dispute', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'accept_claim', params: {} })
  await assert.rejects(() => approveCard(s, card.id, { hash: card.hash, token: 'not-the-token' }), (e) => e.status === 409)
  await assert.rejects(() => createCard(s, { disputeId: A, action: 'escalate', params: {} }), (e) => e.status === 409 && /already has an open/.test(e.message))
  rejectCard(s, card.id)
  const again = await createCard(s, { disputeId: A, action: 'escalate', params: {} })
  assert.equal(again.status, 'PENDING')
})

test('race: two approvals on two cards for one dispute are serialised by the dispute lock, only one PayPal call goes out', async () => {
  const s = createSession()
  const one = await createCard(s, { disputeId: A, action: 'accept_claim', params: {} })
  // A second card on the same dispute needs the first to be closed; simulate two clients approving the same card at once.
  const results = await Promise.allSettled([approve(s, one), approve(s, one), approve(s, one)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(s.audit.list().filter((e) => e.event === 'paypal_call_ok').length, 1)
  // The losers must not overwrite the card that already executed (REVIEW_2 G9).
  assert.equal(one.status, 'EXECUTED')
  assert.equal(one.result.ok, true)
  assert.equal(s.audit.list().some((e) => e.event === 'card_invalidated_links_changed'), false)
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.status, 409)
})

test('before sending, the dispute is re-read: if PayPal no longer lists the action the card is invalidated and nothing is sent', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'make_offer', params: { amount: 20 } })
  s.paypal.service.act(A, 'send_message', { message: 'direct call elsewhere' }) // someone else acted: PayPal now reviews the case
  await assert.rejects(() => approve(s, card), (e) => e.status === 409 && /no longer offers/.test(e.message))
  assert.equal(card.status, 'INVALID')
  assert.equal((await s.paypal.getDispute(A)).offer.seller_offered_amount, undefined)
  assert.ok(s.audit.list().some((e) => e.event === 'card_invalidated_links_changed'))
})

test('deadline guard: under 2 hours warns, under 30 minutes blocks messages and offers but not evidence or refund', async () => {
  const s = createSession()
  const d = await s.paypal.getDispute(C)
  assert.equal(deadlineInfo(d, Date.parse(d.seller_response_due_date) - 3 * 3_600_000).warn, false)
  assert.equal(deadlineInfo(d, Date.parse(d.seller_response_due_date) - 90 * 60_000).warn, true)
  assert.equal(deadlineInfo(d, Date.parse(d.seller_response_due_date) - 90 * 60_000).blocked, false)
  assert.equal(deadlineInfo(d, Date.parse(d.seller_response_due_date) - 10 * 60_000).blocked, true)
  // put the dispute inside the last 30 minutes
  const rec = s.paypal.service.disputes.get(C)
  rec.seller_response_due_date = new Date(Date.now() + 10 * 60_000).toISOString()
  const msg = await createCard(s, { disputeId: C, action: 'send_message', params: { message: 'hi' } })
  await assert.rejects(() => approve(s, msg), (e) => e.status === 409 && /30 minutes/.test(e.message))
  assert.ok(s.audit.list().some((e) => e.event === 'blocked_deadline'))
  rejectCard(s, msg.id)
  const ev = await createCard(s, { disputeId: C, action: 'provide_evidence', params: {} })
  await approve(s, ev)
  assert.equal(ev.status, 'EXECUTED')
})

test('while PayPal reviews the last action its links disappear, so the next card is invalidated and nothing is sent', async () => {
  const s = createSession()
  const first = await createCard(s, { disputeId: A, action: 'send_message', params: { message: 'one' } })
  await approve(s, first)
  const second = await createCard(s, { disputeId: A, action: 'accept_claim', params: {} })
  await assert.rejects(() => approve(s, second), (e) => e.status === 409)
  assert.equal(second.status, 'INVALID', 'links are gone while PayPal reviews, so the card is invalidated before the call')
})

test('model-written text cannot invent amounts; evidence for a claim stage must use a requested type', async () => {
  const s = createSession()
  const d = await s.paypal.getDispute(A)
  assert.throws(() => buildRequest('provide_evidence', { evidenceType: 'PROOF_OF_FULFILLMENT' }, { ...d, dispute_life_cycle_stage: 'CHARGEBACK', evidences: [{ source: 'REQUESTED_FROM_SELLER', evidence_type: 'OTHER' }] }), (e) => e.status === 400)
  assert.throws(() => buildRequest('make_offer', { amount: 66.12 }, d), (e) => e.status === 400, 'an offer must be below the disputed amount')
})

test('sandbox-only actions are marked and recorded as simulations', async () => {
  const s = createSession()
  const id = 'PP-R-BLK-10200001'
  s.paypal.service.act(id, 'escalate', { note: 'x' })
  await sleep(1)
  s.paypal.service.clock = () => Date.now() + 40 * 60_000 * 20 // jump forward in simulated time
  s.paypal.service.scale = 1
  const d = await s.paypal.getDispute(id)
  assert.equal(d.dispute_life_cycle_stage, 'CHARGEBACK')
  s.paypal.service.act(id, 'provide_evidence', { evidence_type: 'OTHER', notes: 'pdf' }, [{ name: 'e.pdf', data: Buffer.from('x') }])
  s.paypal.service.clock = () => Date.now() + 80 * 60_000 * 20
  const card = await createCard(s, { disputeId: id, action: 'adjudicate', params: {} })
  await approve(s, card)
  assert.ok(s.simulated.has(id))
})

test('mock sessions are isolated: refunding in one session does not change another', async () => {
  const s1 = createSession()
  const s2 = createSession()
  const card = await createCard(s1, { disputeId: A, action: 'accept_claim', params: {} })
  await approve(s1, card)
  assert.equal((await s1.paypal.getDispute(A)).dispute_state, 'UNDER_PAYPAL_REVIEW')
  assert.equal((await s2.paypal.getDispute(A)).dispute_state, 'REQUIRED_ACTION')
})

test('the default Send message draft does not claim a refund that has not been made (REVIEW_2 G8)', async () => {
  const s = createSession()
  const card = await createCard(s, { disputeId: A, action: 'send_message', params: {} })
  assert.doesNotMatch(card.draft, /refund/i)
  assert.match(card.draft, /looking into/)
  const refund = await createCard(s, { disputeId: C, action: 'accept_claim', params: {} })
  assert.equal(refund.draft, null, 'a refund card has no message that could be sent before the refund')
})
