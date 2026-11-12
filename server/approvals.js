import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HttpError, parse } from './http.js'
import { requestHash, sha256 } from './domain/hash.js'
import { paypalAmount } from './domain/money.js'
import { withLock } from './lock.js'
import { buildSnapshot } from './snapshot.js'
import { defaultDraft, validateDraftAmounts } from './domain/evidence.js'
import { getStoreOrder } from './data/storeOrders.js'
import { PayPalError } from './paypal/errors.js'

// Every PayPal write is a card that a person approves. The approval is tied to the sha256 of the exact request,
// so editing one word voids it. The model can create cards but cannot approve or send anything.
export const ACTIONS = ['send_message', 'provide_evidence', 'make_offer', 'accept_claim', 'escalate', 'provide_supporting_info', 'adjudicate', 'require_evidence']
export const SANDBOX_ONLY = new Set(['adjudicate', 'require_evidence'])
const WARN_MS = 2 * 3_600_000
const BLOCK_MS = 30 * 60_000
// In the last 30 minutes only evidence and accepting the claim go through; messages, offers and escalation do not.
const BLOCKED_NEAR_DEADLINE = new Set(['send_message', 'make_offer', 'escalate'])

const paramsSchemas = {
  send_message: z.object({ message: z.string().trim().min(1).max(2000) }),
  provide_evidence: z.object({
    notes: z.string().trim().max(2000).optional(),
    evidenceType: z.enum(['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'OTHER']).optional(),
    carrier: z.string().max(60).optional(),
    trackingNumber: z.string().max(60).optional(),
    fileName: z.string().max(100).optional(),
    fileText: z.string().max(20000).optional(),
  }),
  make_offer: z.object({ amount: z.number().positive().max(100000), note: z.string().trim().max(2000).optional() }),
  accept_claim: z.object({}).passthrough(),
  escalate: z.object({ note: z.string().trim().max(2000).optional() }),
  provide_supporting_info: z.object({ notes: z.string().trim().min(1).max(2000), fileText: z.string().max(20000).optional(), fileName: z.string().max(100).optional() }),
  adjudicate: z.object({}).passthrough(),
  require_evidence: z.object({}).passthrough(),
}

const LABELS = {
  send_message: 'Send message',
  provide_evidence: 'Submit evidence',
  make_offer: 'Offer a partial refund',
  accept_claim: 'Refund in full',
  escalate: 'Escalate to PayPal (fight)',
  provide_supporting_info: 'Provide supporting info',
  adjudicate: 'Sandbox: simulate PayPal decision (seller favour)',
  require_evidence: 'Sandbox: ask for more evidence',
}

export function buildRequest(action, rawParams, dispute) {
  const params = parse(paramsSchemas[action], rawParams ?? {})
  const files = []
  let payload
  if (action === 'send_message') payload = { message: params.message }
  else if (action === 'make_offer') {
    const max = Number(dispute.refund_details?.allowed_refund_amount?.value ?? dispute.dispute_amount.value)
    if (params.amount >= max) throw new HttpError(400, `An offer must be below the disputed amount of $${max.toFixed(2)}. Use a full refund instead.`)
    payload = { note: params.note || 'We can refund part of the price.', offer_amount: paypalAmount(params.amount), offer_type: 'REFUND' }
  } else if (action === 'accept_claim') {
    // Observed in the sandbox: JSON {"note":"refund_issued"} is accepted and resolves the case with a full refund.
    payload = { note: 'refund_issued' }
  } else if (action === 'escalate') payload = { note: params.note || 'Escalating to PayPal for review.' }
  else if (action === 'provide_evidence') {
    const requested = (dispute.evidences || []).filter((e) => e.source === 'REQUESTED_FROM_SELLER').map((e) => e.evidence_type)
    const stage = dispute.dispute_life_cycle_stage
    const evidenceType = params.evidenceType || (stage === 'CHARGEBACK' ? requested.find((t) => t === 'OTHER') || requested[0] : 'PROOF_OF_FULFILLMENT') || 'OTHER'
    if (stage === 'CHARGEBACK' && !requested.includes(evidenceType)) {
      throw new HttpError(400, `PayPal asks for ${requested.join(', ')} at this stage, not ${evidenceType}.`)
    }
    payload = { evidence_type: evidenceType, notes: params.notes || '' }
    if (params.trackingNumber) payload.tracking_info = [{ carrier_name: params.carrier || 'USPS', tracking_number: params.trackingNumber }]
    files.push(textFile(params.fileName || 'evidence.txt', params.fileText || params.notes || 'Evidence prepared in Dispute Desk'))
  } else if (action === 'provide_supporting_info') {
    payload = { notes: params.notes }
    if (params.fileText) files.push(textFile(params.fileName || 'supporting-info.txt', params.fileText))
  } else if (action === 'adjudicate') payload = { adjudication_outcome: 'SELLER_FAVOR' }
  else if (action === 'require_evidence') payload = { action: 'SELLER_EVIDENCE' }
  return { payload, files }
}

function textFile(name, text) {
  return { name, type: 'text/plain', data: Buffer.from(text, 'utf8') }
}

export function deadlineInfo(dispute, now = Date.now()) {
  const due = dispute.seller_response_due_date ? Date.parse(dispute.seller_response_due_date) : null
  if (!due) return { dueDate: null, remainingMs: null, warn: false, blocked: false }
  const remainingMs = due - now
  return { dueDate: dispute.seller_response_due_date, remainingMs, warn: remainingMs < WARN_MS, blocked: remainingMs < BLOCK_MS }
}

function publicCard(card, dispute) {
  const dl = dispute ? deadlineInfo(dispute) : { dueDate: null }
  return {
    id: card.id,
    disputeId: card.disputeId,
    action: card.action,
    label: LABELS[card.action],
    status: card.status,
    createdBy: card.createdBy,
    drafter: card.drafter || null,
    payload: card.payload,
    files: card.files.map((f) => ({ name: f.name, bytes: f.data.length })),
    draft: card.draft,
    hash: card.hash,
    hashShort: card.hash.slice(0, 8),
    token: card.token,
    summary: card.summary,
    sandboxSimulation: SANDBOX_ONLY.has(card.action),
    deadline: dl,
    notice: card.notice || null,
    approvedBy: card.approvedBy || null,
    approvedAt: card.approvedAt || null,
    result: card.result || null,
    updatedAt: card.updatedAt,
  }
}

function draftFor(action, payload) {
  if (action === 'send_message') return payload.message
  if (action === 'make_offer') return payload.note
  if (action === 'escalate') return payload.note
  if (action === 'provide_evidence') return payload.notes
  if (action === 'provide_supporting_info') return payload.notes
  return null
}

export function listCards(session, details) {
  return [...session.approvals.values()].map((c) => publicCard(c, details?.get(c.disputeId)))
}

export async function createCard(session, { disputeId, action, params, createdBy = 'seller' }) {
  if (!ACTIONS.includes(action)) throw new HttpError(400, `Unknown action ${action}`)
  const dispute = await session.paypal.getDispute(disputeId)
  const open = [...session.approvals.values()].find((c) => c.disputeId === disputeId && c.status === 'PENDING')
  if (open) throw new HttpError(409, `Case ${disputeId} already has an open approval card (${open.id}). Approve, edit or reject it first.`, { cardId: open.id })
  const order = getStoreOrder(session.paypal.orderIdOf?.(disputeId, dispute))
  const filled = withDefaultParams(action, params, dispute, order)
  const { payload, files } = buildRequest(action, filled, dispute)
  const card = {
    id: randomUUID().slice(0, 8),
    disputeId,
    action,
    createdBy,
    params: filled,
    payload,
    files,
    status: 'PENDING',
    hash: requestHash({ disputeId, action, payload, files }),
    token: randomBytes(12).toString('hex'),
    draft: draftFor(action, payload),
    summary: null,
    updatedAt: new Date().toISOString(),
  }
  session.approvals.set(card.id, card)
  session.audit.add({ actor: createdBy, event: 'card_created', cardId: card.id, disputeId, action, hash: card.hash })
  return card
}

function withDefaultParams(action, params = {}, dispute, order) {
  const amount = Number(dispute.dispute_amount.value)
  const kind = dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' ? 'INR' : 'SNAD'
  const item = dispute.disputed_transactions?.[0]?.items?.[0]?.item_name || 'item'
  if (action === 'send_message' && !params.message) return { ...params, message: defaultDraft({ kind, action, amount, item, order }) }
  if (action === 'make_offer') return { amount: params.amount, note: params.note || defaultDraft({ kind, action, amount, offerAmount: params.amount, item, order }) }
  if (action === 'provide_evidence') {
    const t = order?.tracking
    return { notes: params.notes ?? defaultDraft({ kind, action, amount, item, order }), trackingNumber: params.trackingNumber ?? (kind === 'INR' ? t?.number : undefined), carrier: params.carrier ?? t?.carrier, ...params }
  }
  if (action === 'escalate') return { note: params.note || defaultDraft({ kind, action, amount, item, order }) }
  if (action === 'accept_claim') return { ...params, note: undefined }
  return params
}

export async function editCard(session, cardId, params) {
  const card = mustCard(session, cardId)
  if (card.status !== 'PENDING') throw new HttpError(409, `Card is ${card.status}; only a pending card can be edited.`)
  const dispute = await session.paypal.getDispute(card.disputeId)
  const merged = { ...card.params, ...params }
  const { payload, files } = buildRequest(card.action, merged, dispute)
  const hash = requestHash({ disputeId: card.disputeId, action: card.action, payload, files })
  const changed = hash !== card.hash
  Object.assign(card, { params: merged, payload, files, hash, draft: draftFor(card.action, payload), token: randomBytes(12).toString('hex'), updatedAt: new Date().toISOString(), approvedBy: null, approvedAt: null })
  session.audit.add({ actor: 'seller', event: changed ? 'card_edited_approval_voided' : 'card_edit_no_change', cardId, disputeId: card.disputeId, hash })
  return card
}

export function rejectCard(session, cardId) {
  const card = mustCard(session, cardId)
  if (card.status !== 'PENDING') throw new HttpError(409, `Card is ${card.status}.`)
  card.status = 'REJECTED'
  card.updatedAt = new Date().toISOString()
  session.audit.add({ actor: 'seller', event: 'card_rejected', cardId, disputeId: card.disputeId })
  return card
}

function mustCard(session, id) {
  const card = session.approvals.get(id)
  if (!card) throw new HttpError(404, 'Approval card not found')
  return card
}

const REL = { send_message: 'send_message', provide_evidence: 'provide_evidence', make_offer: 'make_offer', accept_claim: 'accept_claim', escalate: 'escalate', provide_supporting_info: 'provide_supporting_info', adjudicate: 'adjudicate', require_evidence: 'require_evidence' }

export async function approveCard(session, cardId, { hash, token, approver = 'seller' }) {
  const card = mustCard(session, cardId)
  if (card.status !== 'PENDING') throw new HttpError(409, `Card is ${card.status}. An approval can be used once.`)
  if (hash !== card.hash) throw new HttpError(409, 'The request changed after you looked at it. Review the new version and approve again.')
  if (token !== card.token) throw new HttpError(409, 'This approval token is no longer valid. Reload the card.')
  if (session.paypal.mode === 'sandbox' && !session.reserved.has(card.disputeId)) {
    throw new HttpError(403, 'Writes are limited to the cases reserved for your session. Use "Claim my cases" first.')
  }
  return withLock(`dispute:${card.disputeId}`, async () => {
    // A concurrent approval may have used this card while we waited for the lock: check again inside it.
    if (card.status !== 'PENDING') throw new HttpError(409, `Card is ${card.status}. An approval can be used once.`)
    if (hash !== card.hash || token !== card.token) throw new HttpError(409, 'The request changed after you looked at it. Review the new version and approve again.')
    // Re-read the dispute right before sending: state, links and deadline may have moved since the card was made.
    const fresh = await session.paypal.getDispute(card.disputeId)
    const dl = deadlineInfo(fresh)
    if (dl.blocked && BLOCKED_NEAR_DEADLINE.has(card.action)) {
      session.audit.add({ actor: 'system', event: 'blocked_deadline', cardId, disputeId: card.disputeId, action: card.action })
      throw new HttpError(409, 'Less than 30 minutes to the PayPal deadline: messages and offers are blocked. Submit evidence or refund in full.')
    }
    if (!fresh.links.some((l) => l.rel === REL[card.action])) {
      card.status = 'INVALID'
      card.notice = 'PayPal no longer offers this action for the case. The case changed; the plan was recalculated.'
      card.updatedAt = new Date().toISOString()
      session.audit.add({ actor: 'system', event: 'card_invalidated_links_changed', cardId, disputeId: card.disputeId, action: card.action, links: fresh.links.map((l) => l.rel) })
      throw new HttpError(409, card.notice)
    }
    card.approvedBy = approver
    card.approvedAt = new Date().toISOString()
    session.audit.add({ actor: approver, event: 'approved', cardId, disputeId: card.disputeId, action: card.action, hash: card.hash })
    try {
      const response = await session.paypal.act(card.disputeId, card.action, card.payload, card.files)
      card.status = 'EXECUTED'
      card.result = { ok: true, response, at: new Date().toISOString() }
      card.notice = null
      session.plan.version += 1
      if (SANDBOX_ONLY.has(card.action)) (session.simulated ||= new Set()).add(card.disputeId)
      session.audit.add({ actor: 'system', event: 'paypal_call_ok', cardId, disputeId: card.disputeId, action: card.action, payloadSha: sha256(JSON.stringify(card.payload)) })
    } catch (err) {
      if (err instanceof PayPalError && err.issue === 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE') {
        // PayPal briefly refuses a second action while it reviews the first (sandbox: 422). Reopen the card for later.
        card.notice = 'PayPal is reviewing your last action. This reopens when PayPal allows the next step.'
        card.approvedBy = null
        card.approvedAt = null
        card.token = randomBytes(12).toString('hex')
      } else {
        card.status = 'FAILED'
        card.result = { ok: false, error: err.message }
      }
      card.updatedAt = new Date().toISOString()
      session.audit.add({ actor: 'system', event: 'paypal_call_failed', cardId, disputeId: card.disputeId, action: card.action, status: err.status, issue: err.issue })
      throw new HttpError(err.status && err.status < 500 ? 409 : 502, card.notice || `PayPal rejected the action: ${err.issue || err.message}`)
    }
    return card
  })
}

export function checkDraftText(text, allowedAmounts) {
  return validateDraftAmounts(text, allowedAmounts)
}

export { publicCard }
export async function cardsView(session) {
  const { details } = await buildSnapshot(session)
  return listCards(session, details)
}
