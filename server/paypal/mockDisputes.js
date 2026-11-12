import { PayPalError, notAllowed } from './errors.js'
import { paypalAmount } from '../domain/money.js'

// Stateful stand-in for the PayPal Disputes v1 API. Response bodies follow the sandbox responses recorded in
// review/dispute_probe/RESULT.md (calls.log) and the Disputes v1 reference: same field names, state names,
// link relations, 422/400 behaviour and stage changes. Durations are the observed sandbox durations divided by `scale`.
const BASE = 'https://api-m.sandbox.paypal.com/v1/customer/disputes'
const MIN = 60_000
const DAY = 86_400_000

export const SANDBOX_DURATIONS = Object.freeze({
  settle: 3.5 * MIN, // new dispute becomes actionable
  review: 0.75 * MIN, // after a message / evidence / offer the dispute is briefly UNDER_REVIEW
  refund: 2 * MIN, // accept-claim to RESOLVED
  offerAccepted: 4 * MIN,
  escalate: 3 * MIN, // escalate to CHARGEBACK stage
  adjudicateLink: 12 * MIN, // after chargeback evidence the adjudicate link appears
  adjudicate: 4 * MIN,
  requireEvidence: 0.15 * MIN,
})

const LINKS = {
  send_message: ['send-message', 'POST'],
  provide_evidence: ['provide-evidence', 'POST'],
  make_offer: ['make-offer', 'POST'],
  accept_claim: ['accept-claim', 'POST'],
  escalate: ['escalate', 'POST'],
  provide_supporting_info: ['provide-supporting-info', 'POST'],
  adjudicate: ['adjudicate', 'POST'],
  require_evidence: ['require-evidence', 'POST'],
}

const ACTION_REL = {
  send_message: 'send_message',
  provide_evidence: 'provide_evidence',
  make_offer: 'make_offer',
  accept_claim: 'accept_claim',
  escalate: 'escalate',
  provide_supporting_info: 'provide_supporting_info',
  adjudicate: 'adjudicate',
  require_evidence: 'require_evidence',
}

const rid = (n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789') =>
  Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')

export class MockDisputeService {
  constructor({ clock = () => Date.now(), scale = 1 } = {}) {
    this.clock = clock
    this.scale = scale
    this.disputes = new Map()
    this.counter = 10200000
  }

  d(ms) {
    return ms / this.scale
  }

  // ---- seeding (the sandbox needs a buyer web flow for this; the mock creates it directly) ----
  create(spec) {
    const now = this.clock()
    const id = spec.disputeId || `PP-R-${rid(3, 'ABCDEFGHJKLMNPQRSTUVWXYZ')}-${++this.counter}`
    const sellerTxn = spec.sellerTransactionId || rid(17)
    const settled = spec.settled === true
    const amount = paypalAmount(spec.amount)
    const created = spec.createdAt ?? now
    const item = {
      item_name: spec.item,
      item_description: spec.item,
      item_quantity: '1',
      reason: spec.reason,
      item_type: 'PRODUCT',
      ...(spec.kind === 'SNAD' ? { notes: spec.buyerMessage } : {}),
    }
    const dispute = {
      dispute_id: id,
      create_time: new Date(created).toISOString(),
      update_time: new Date(created).toISOString(),
      disputed_transactions: [
        {
          buyer_transaction_id: rid(17),
          seller_transaction_id: sellerTxn,
          create_time: new Date(created - 14 * DAY).toISOString(),
          transaction_status: 'HELD',
          gross_amount: amount,
          buyer: { email: 'sb-buyer-demo@personal.example.com', payer_id: rid(13), name: spec.buyerName || 'John Doe' },
          seller: { email: 'sb-seller-demo@business.example.com', merchant_id: rid(13), name: spec.sellerName || 'Test Store' },
          items: [item],
          seller_protection_eligible: Boolean(spec.sellerProtectionEligible),
          ...(spec.sellerProtectionEligible ? { seller_protection_type: 'EXPANDED_SELLER_PROTECTION' } : {}),
        },
      ],
      reason: spec.reason,
      status: 'UNDER_REVIEW',
      dispute_amount: amount,
      dispute_state: 'UNDER_PAYPAL_REVIEW',
      fund_movements: [
        { party: 'SELLER', amount: paypalAmount(Math.max(spec.amount - 1.91, 0)), initiated_time: new Date(created + MIN).toISOString(), type: 'DEBIT', reason: 'HOLD_PLACED' },
      ],
      dispute_life_cycle_stage: 'INQUIRY',
      dispute_channel: 'INTERNAL',
      messages: [{ posted_by: 'BUYER', time_posted: new Date(created).toISOString(), content: spec.buyerMessage }],
      extensions: { merchant_contacted: false, buyer_contacted_time: new Date(created - 1000).toISOString() },
      evidences: [
        { evidence_type: 'CREATE', notes: spec.buyerMessage, source: 'SUBMITTED_BY_BUYER', date: new Date(created).toISOString(), dispute_life_cycle_stage: 'INQUIRY' },
      ],
      offer: { buyer_requested_amount: amount },
      refund_details: { allowed_refund_amount: amount },
      links: [],
      _kind: spec.kind,
      _paymentMethod: spec.paymentMethod || 'PAYPAL',
      _pending: [],
      _rels: ['self'],
      _orderId: spec.orderId,
    }
    this.disputes.set(id, dispute)
    this.schedule(dispute, created + this.d(SANDBOX_DURATIONS.settle), 'inquirySellerTurn')
    this.materialize(dispute)
    if (settled) {
      for (const p of dispute._pending) this.apply(dispute, p)
      dispute._pending = []
    }
    return id
  }

  // ---- state machine ----
  schedule(d, at, step, arg) {
    d._pending.push({ at, step, arg })
    d._pending.sort((a, b) => a.at - b.at)
  }

  materialize(d) {
    const now = this.clock()
    while (d._pending.length && d._pending[0].at <= now) this.apply(d, d._pending.shift())
    d.links = d._rels.map((rel) => (rel === 'self' ? link(d.dispute_id, '', 'self', 'GET') : link(d.dispute_id, `/${LINKS[rel][0]}`, rel, 'POST')))
  }

  setState(d, patch, rels, at) {
    Object.assign(d, patch, { update_time: new Date(at ?? this.clock()).toISOString() })
    d._rels = rels
  }

  apply(d, { at, step, arg }) {
    const inr = d._kind === 'INR'
    const due = (days) => new Date(at + days * DAY).toISOString()
    if (step === 'inquirySellerTurn') {
      const requested = inr ? [{ evidence_type: 'PROOF_OF_FULFILLMENT', source: 'REQUESTED_FROM_SELLER', date: new Date(at).toISOString() }] : []
      d.evidences = [...d.evidences, ...requested]
      d.seller_response_due_date = due(20) // observed: creation + 20 days
      d.allowed_response_options = inr
        ? { accept_claim: { accept_claim_types: ['PARTIAL_REFUND', 'REFUND'] }, make_offer: { offer_types: ['REFUND'] } }
        : { accept_claim: { accept_claim_types: ['PARTIAL_REFUND', 'REFUND_WITH_RETURN', 'REFUND'] }, make_offer: { offer_types: ['REFUND', 'REFUND_WITH_RETURN'] } }
      const rels = inr ? ['self', 'accept_claim', 'provide_evidence', 'send_message', 'escalate', 'make_offer'] : ['self', 'accept_claim', 'send_message', 'escalate', 'make_offer']
      this.setState(d, { status: 'WAITING_FOR_SELLER_RESPONSE', dispute_state: 'REQUIRED_ACTION' }, rels, at)
    } else if (step === 'buyerTurn') {
      delete d.allowed_response_options
      delete d.seller_response_due_date
      const rels = ['self', 'accept_claim', 'escalate', 'send_message']
      this.setState(d, { status: 'WAITING_FOR_BUYER_RESPONSE', dispute_state: 'REQUIRED_OTHER_PARTY_ACTION' }, rels, at)
    } else if (step === 'chargebackSellerTurn') {
      // Observed: item-not-received asks for fulfilment proof too; not-as-described asks only for refund proof or other.
      const types = inr ? ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'OTHER'] : ['PROOF_OF_REFUND', 'OTHER']
      d.evidences = [...d.evidences, ...types.map((t) => ({ evidence_type: t, source: 'REQUESTED_FROM_SELLER', date: new Date(at).toISOString() }))]
      d.seller_response_due_date = due(10)
      d.allowed_response_options = { accept_claim: { accept_claim_types: ['REFUND', 'PARTIAL_REFUND'] } }
      d.dispute_life_cycle_stage = 'CHARGEBACK'
      this.setState(d, { status: 'WAITING_FOR_SELLER_RESPONSE', dispute_state: 'REQUIRED_ACTION' }, ['self', 'accept_claim', 'provide_evidence'], at)
    } else if (step === 'adjudicateLink') {
      this.setState(d, {}, ['self', 'accept_claim', 'require_evidence', 'adjudicate', 'provide_supporting_info'], at)
    } else if (step === 'requireEvidence') {
      d.seller_response_due_date = due(3) // observed: back to waiting with +3 days
      this.setState(d, { status: 'WAITING_FOR_SELLER_RESPONSE', dispute_state: 'REQUIRED_ACTION' }, ['self', 'accept_claim', 'provide_evidence'], at)
    } else if (step === 'resolve') {
      this.resolve(d, arg, at)
    }
  }

  resolve(d, outcome, at) {
    delete d.allowed_response_options
    delete d.seller_response_due_date
    const iso = new Date(at).toISOString()
    d.dispute_outcome = outcome.refunded
      ? { outcome_code: outcome.code, outcome_reason: outcome.reason, amount_refunded: paypalAmount(outcome.refunded) }
      : { outcome_code: outcome.code, outcome_reason: outcome.reason }
    if (outcome.refunded) {
      d.money_movements = [
        { affected_party: 'SELLER', amount: paypalAmount(outcome.refunded), initiated_time: iso, type: 'DEBIT', reason: 'DISPUTE_SETTLEMENT' },
        { affected_party: 'BUYER', amount: paypalAmount(outcome.refunded), initiated_time: iso, type: 'CREDIT', reason: 'DISPUTE_SETTLEMENT' },
      ]
      d.refund_details = { allowed_refund_amount: d.dispute_amount, transactions: [{ id: rid(17), gross_amount: paypalAmount(outcome.refunded), create_time: iso }] }
    } else {
      d.adjudications = [{ type: 'DENY_BUYER', adjudication_time: iso, reason: outcome.reason, dispute_life_cycle_stage: d.dispute_life_cycle_stage }]
    }
    this.setState(d, { status: 'RESOLVED', dispute_state: 'RESOLVED' }, ['self'], at)
  }

  underReview(d, thenStep, delay, extra = {}) {
    const now = this.clock()
    this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW', ...extra }, ['self'], now)
    d._pending = []
    this.schedule(d, now + this.d(delay), thenStep)
  }

  // ---- API surface ----
  getDispute(id) {
    const d = this.disputes.get(id)
    if (!d) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Requested resource ID was not found.')
    this.materialize(d)
    return publicView(d)
  }

  listDisputes({ dispute_state: state, page_size = 50 } = {}) {
    const items = []
    for (const d of this.disputes.values()) {
      this.materialize(d)
      if (state && d.dispute_state !== state) continue
      items.push(summary(d))
    }
    items.sort((a, b) => b.create_time.localeCompare(a.create_time))
    const self = `${BASE}?page_size=${page_size}`
    return {
      items: items.slice(0, page_size),
      links: [
        { href: self, rel: 'self', method: 'GET', encType: 'application/json' },
        { href: self, rel: 'first', method: 'GET', encType: 'application/json' },
      ],
    }
  }

  act(id, action, payload = {}, files = []) {
    const d = this.disputes.get(id)
    if (!d) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Requested resource ID was not found.')
    this.materialize(d)
    const rel = ACTION_REL[action]
    if (!rel) throw new PayPalError(400, 'INVALID_REQUEST', 'INVALID_ACTION')
    if (!d._rels.includes(rel)) {
      // Observed: adjudicate and require-evidence answer 400 without a link, everything else 422.
      throw notAllowed(action === 'adjudicate' || action === 'require_evidence' ? 400 : 422)
    }
    const now = this.clock()
    const iso = new Date(now).toISOString()
    const stage = d.dispute_life_cycle_stage
    if (action === 'send_message') {
      if (!payload.message) throw new PayPalError(400, 'INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER')
      d.messages = [...(d.messages || []), { posted_by: 'SELLER', time_posted: iso, content: payload.message }]
      this.underReview(d, 'buyerTurn', SANDBOX_DURATIONS.review)
    } else if (action === 'provide_evidence') {
      const type = payload.evidence_type || (payload.evidences?.[0]?.evidence_type) || 'OTHER'
      const requested = d.evidences.filter((e) => e.source === 'REQUESTED_FROM_SELLER').map((e) => e.evidence_type)
      if (stage === 'CHARGEBACK' && !requested.includes(type)) throw new PayPalError(400, 'INVALID_REQUEST', 'EVIDENCE_TYPE_IS_NOT_ALLOWED')
      d.evidences = [
        ...d.evidences,
        {
          evidence_type: type,
          ...(payload.tracking_info ? { evidence_info: { tracking_info: payload.tracking_info } } : {}),
          ...(files.length ? { documents: files.map((f) => ({ name: f.name, url: `https://api-m.sandbox.paypal.com/v2/content/documents/DIS-010-${rid(8)}/files/1/download` })) } : {}),
          notes: payload.notes || '',
          source: 'SUBMITTED_BY_SELLER',
          date: iso,
          action_info: { action: 'PROVIDE_EVIDENCE' },
          dispute_life_cycle_stage: stage,
        },
      ]
      if (stage === 'CHARGEBACK') {
        this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, ['self'], now)
        d._pending = [{ at: now + this.d(SANDBOX_DURATIONS.adjudicateLink), step: 'adjudicateLink' }]
      } else this.underReview(d, 'buyerTurn', SANDBOX_DURATIONS.review)
    } else if (action === 'provide_supporting_info') {
      d.evidences = [...d.evidences, { evidence_type: 'OTHER', notes: payload.notes || '', source: 'SUBMITTED_BY_SELLER', date: iso, action_info: { action: 'PROVIDE_SUPPORTING_INFO' }, dispute_life_cycle_stage: stage }]
      const keepLinks = d._rels
      this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, keepLinks, now)
    } else if (action === 'make_offer') {
      const x = Number(payload.offer_amount?.value)
      const max = Number(d.refund_details.allowed_refund_amount.value)
      if (!(x > 0) || x > max) throw new PayPalError(400, 'INVALID_REQUEST', 'INVALID_OFFER_AMOUNT')
      d.offer = { ...d.offer, seller_offered_amount: paypalAmount(x), history: [{ offer_time: iso, actor: 'SELLER', event_type: 'ADJUSTED', offer_type: payload.offer_type || 'REFUND', offer_amount: paypalAmount(x), notes: payload.note }] }
      d._offered = x
      this.underReview(d, 'buyerTurn', SANDBOX_DURATIONS.review)
    } else if (action === 'accept_claim') {
      const full = Number(d.dispute_amount.value)
      d.evidences = [...d.evidences, { evidence_type: 'OTHER', notes: payload.note || 'refund_issued', source: 'SUBMITTED_BY_SELLER', date: iso, action_info: { action: 'ACCEPT_CLAIM', response_option: payload.accept_claim_type || 'REFUND' }, dispute_life_cycle_stage: stage }]
      this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, ['self'], now)
      d._pending = [{ at: now + this.d(SANDBOX_DURATIONS.refund), step: 'resolve', arg: { code: 'RESOLVED_BUYER_FAVOUR', reason: 'SELLER_ISSUED_REFUND', refunded: full } }]
    } else if (action === 'escalate') {
      d.evidences = [...d.evidences, { evidence_type: 'OTHER', notes: payload.note || 'Escalating to PayPal for review.', source: 'SUBMITTED_BY_SELLER', date: iso, action_info: { action: 'ESCALATE' }, dispute_life_cycle_stage: 'INQUIRY' }]
      this.underReview(d, 'chargebackSellerTurn', SANDBOX_DURATIONS.escalate)
    } else if (action === 'adjudicate') {
      if (payload.adjudication_outcome !== 'SELLER_FAVOR') throw new PayPalError(400, 'INVALID_REQUEST', 'INVALID_PARAMETER_VALUE')
      this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, ['self'], now)
      d._pending = [{ at: now + this.d(SANDBOX_DURATIONS.adjudicate), step: 'resolve', arg: { code: 'RESOLVED_SELLER_FAVOUR', reason: 'INELIGIBLE_BUYER_PROTECTION_POLICY' } }]
    } else if (action === 'require_evidence') {
      this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, ['self'], now)
      d._pending = [{ at: now + this.d(SANDBOX_DURATIONS.requireEvidence), step: 'requireEvidence' }]
    }
    this.materialize(d)
    // Observed response of the action endpoints: a link to the dispute detail.
    return { links: [{ href: `${BASE}/${id}`, rel: 'detail', method: 'GET', encType: 'application/json' }] }
  }

  // ---- sandbox buyer automation stand-ins (the real sandbox needs a browser flow for these) ----
  buyerAcceptsOffer(id) {
    const d = this.disputes.get(id)
    this.materialize(d)
    if (!d._offered || d.dispute_state === 'RESOLVED') throw notAllowed(422)
    const now = this.clock()
    this.setState(d, { status: 'UNDER_REVIEW', dispute_state: 'UNDER_PAYPAL_REVIEW' }, ['self'], now)
    d._pending = [{ at: now + this.d(SANDBOX_DURATIONS.offerAccepted), step: 'resolve', arg: { code: 'RESOLVED_BUYER_FAVOUR', reason: 'INQUIRY_OFFER_PARTIAL_REFUND', refunded: d._offered } }]
    this.materialize(d)
  }

  buyerEscalates(id) {
    const d = this.disputes.get(id)
    this.materialize(d)
    this.underReview(d, 'chargebackSellerTurn', SANDBOX_DURATIONS.escalate)
    this.materialize(d)
  }
}

function link(id, path, rel, method) {
  return { href: `${BASE}/${id}${path}`, rel, method, encType: 'application/json' }
}

function publicView(d) {
  const out = {}
  for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = structuredClone(v)
  return out
}

function summary(d) {
  const keys = ['dispute_id', 'create_time', 'update_time', 'reason', 'status', 'dispute_state', 'dispute_amount', 'dispute_life_cycle_stage', 'dispute_channel']
  return {
    ...Object.fromEntries(keys.map((k) => [k, structuredClone(d[k])])),
    links: [{ href: `${BASE}/${d.dispute_id}`, rel: 'self', method: 'GET', encType: 'application/json' }],
  }
}
