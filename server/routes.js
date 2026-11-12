import express from 'express'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config, modes } from './config.js'
import { HttpError, parse, disputeIdSchema } from './http.js'
import { createSession, getSession } from './session.js'
import { buildSnapshot } from './snapshot.js'
import { buildSavings } from './savings.js'
import { buildStudioTables } from './studioData.js'
import { buildChecklist } from './domain/evidence.js'
import { createCard, editCard, rejectCard, approveCard, listCards, publicCard, ACTIONS } from './approvals.js'
import { studioLlm, agentRun } from './agent/routes.js'
import { draftWithClaude } from './agent/draft.js'
import { sourceOf, listRecordedAiRuns } from './agent/replay.js'
import { writeLimiter, planModelUse } from './demoLimits.js'
import { bannerFor } from './judge/banner.js'
import { DisputePool } from './judge/pool.js'
import { fileSandboxDispute } from './judge/filing.js'
import { SCENARIO } from './domain/scenario.js'
import { handleWebhook, webhookStatus } from './webhooks.js'

export const api = express.Router()
const here = path.dirname(fileURLToPath(import.meta.url))
const recorded = JSON.parse(readFileSync(path.join(here, 'data/recordedRun.json'), 'utf8'))
// Sandbox evidence (today's VERIFY.md results by id) and the recorded real model runs, for the Recorded run window.
const sandboxEvidence = JSON.parse(readFileSync(path.join(here, '../builtin/sandbox-evidence.json'), 'utf8'))
const aiRuns = listRecordedAiRuns()
export const pool = new DisputePool({ target: config.poolTarget, stateFile: config.stateFile, createFn: modes.paypal === 'sandbox' ? fileSandboxDispute : null })

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Session cookie: random id that only selects a private stand-in or a reservation. No secrets are stored in it.
api.use((req, res, next) => {
  const cookie = /(?:^|;\s*)dd_sid=([0-9a-f-]{36})/.exec(req.headers.cookie || '')
  let session = cookie ? getSession(cookie[1]) : null
  if (!session) {
    session = createSession()
    res.cookie('dd_sid', session.id, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 3_600_000, secure: req.secure })
  }
  req.session = session
  next()
})

api.get('/health', (_req, res) => res.json({ ok: true, modes, asOf: SCENARIO.asOf }))

async function stateOf(session) {
  const snap = await buildSnapshot(session)
  const simulated = session.simulated || new Set()
  const savings = buildSavings({ resolved: snap.queue.resolved, details: snap.details, simulated })
  const tables = buildStudioTables({ view: snap.view, queue: snap.queue, details: snap.details, savings, scenarios: session.scenarios || [], simulated })
  return {
    modes,
    sandboxCase: session.paypal.realIds?.[0] || null,
    banner: bannerFor({ mode: session.paypal.mode, claim: session.judge.claim || null, realIds: session.paypal.realIds }),
    view: snap.view,
    tables,
    savings,
    cards: listCards(session, snap.details),
    audit: session.audit.list().slice(-60),
    pool: pool.status(),
    webhooks: webhookStatus(),
    resolutionCenterUrl: 'https://www.sandbox.paypal.com/resolutioncenter',
    serverTime: new Date().toISOString(),
  }
}

api.get('/state', wrap(async (req, res) => res.json({ success: true, data: await stateOf(req.session) })))

const planBody = z.object({
  choices: z.record(z.string().max(4), z.object({ action: z.enum(['refund', 'offer', 'fight']) })).optional(),
  q: z.number().min(0).max(1).optional(),
  p: z.number().min(0).max(1).optional(),
  returnValueRatio: z.number().min(0).max(1).optional(),
  period: z.enum(['window', 'decOnly']).optional(),
  windowAssumption: z.enum(['a', 'b']).optional(),
  offerAmount: z.number().positive().max(10000).optional(),
  applyRecommended: z.boolean().optional(),
  reset: z.boolean().optional(),
})

api.post('/plan', wrap(async (req, res) => {
  const body = parse(planBody, req.body)
  const s = req.session
  if (body.reset) {
    s.plan.choices = null
  }
  for (const k of ['q', 'p', 'returnValueRatio', 'period', 'windowAssumption', 'offerAmount']) if (body[k] !== undefined) s.plan[k] = body[k]
  if (body.choices) s.plan.choices = { ...(s.plan.choices || {}), ...body.choices }
  if (body.applyRecommended) {
    const { view } = await buildSnapshot(s)
    s.plan.choices = view.recommended?.choices || null
  }
  s.plan.version += 1
  s.audit.add({ actor: 'seller', event: 'plan_changed', detail: { ...body } })
  res.json({ success: true, data: await stateOf(s) })
}))

api.get('/disputes/:id', wrap(async (req, res) => {
  const id = parse(disputeIdSchema, req.params.id)
  const snap = await buildSnapshot(req.session)
  const d = snap.details.get(id)
  if (!d) throw new HttpError(404, 'Dispute not found')
  const kase = snap.view.cases.find((c) => c.disputeId === id) || null
  const kind = d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' ? 'INR' : 'SNAD'
  const orderId = req.session.paypal.orderIdOf?.(id, d) ?? null
  res.json({
    success: true,
    data: {
      dispute: d,
      kind,
      case: kase,
      checklist: buildChecklist(d, kind, orderId),
      cards: listCards(req.session, snap.details).filter((c) => c.disputeId === id),
      writable: req.session.paypal.mode !== 'sandbox' || req.session.reserved.has(id),
      realSandbox: req.session.paypal.mode === 'sandbox' || Boolean(req.session.paypal.isReal?.(id)),
      nextChange: req.session.paypal.nextChangeOf?.(id) ?? null,
    },
  })
}))

const cardBody = z.object({ disputeId: disputeIdSchema, action: z.enum(ACTIONS), params: z.record(z.string(), z.any()).optional() })
const detailsFor = async (s) => (await buildSnapshot(s)).details

api.post('/approvals', writeLimiter, wrap(async (req, res) => {
  const body = parse(cardBody, req.body)
  const card = await createCard(req.session, { ...body, createdBy: 'seller' })
  res.status(201).json({ success: true, data: publicCard(card, (await detailsFor(req.session)).get(card.disputeId)) })
}))

// "Draft with Claude": the dispute-analyst reads the records and creates a card through draft_response (amount check included).
api.post('/approvals/draft', wrap(async (req, res) => {
  const body = parse(z.object({ disputeId: disputeIdSchema, action: z.enum(['send_message', 'provide_evidence', 'escalate']).default('send_message') }), req.body)
  const { forceMock, reason } = planModelUse(req)
  const meta = {}
  const out = await draftWithClaude(req.session, { ...body, forceMock, meta })
  const why = reason || meta.fallbackReason || ''
  const drafter = sourceOf(out.model, forceMock || meta.fallbackReason ? 'mock' : modes.llm, why)
  const card = { ...req.session.approvals.get(out.cardId), drafter }
  req.session.approvals.set(card.id, card)
  res.status(201).json({ success: true, data: { card: publicCard(card, (await detailsFor(req.session)).get(card.disputeId)), steps: out.steps, model: out.model, source: drafter.source, label: drafter.label, summary: out.summary } })
}))

api.patch('/approvals/:id', wrap(async (req, res) => {
  const body = parse(z.object({ params: z.record(z.string(), z.any()) }), req.body)
  const card = await editCard(req.session, req.params.id, body.params)
  res.json({ success: true, data: publicCard(card, (await detailsFor(req.session)).get(card.disputeId)) })
}))

api.post('/approvals/:id/approve', writeLimiter, wrap(async (req, res) => {
  const body = parse(z.object({ hash: z.string().length(64), token: z.string().min(8) }), req.body)
  const card = await approveCard(req.session, req.params.id, body)
  res.json({ success: true, data: publicCard(card, (await detailsFor(req.session)).get(card.disputeId)), state: await stateOf(req.session) })
}))

api.post('/approvals/:id/reject', wrap(async (req, res) => {
  const card = rejectCard(req.session, req.params.id)
  res.json({ success: true, data: publicCard(card, null) })
}))

// Sandbox-only stand-in for the buyer clicking "Accept" on an offer. In the real sandbox this needs the buyer web automation (VERIFY V9).
api.post('/sandbox/:id/buyer-accepts', writeLimiter, wrap(async (req, res) => {
  const id = parse(disputeIdSchema, req.params.id)
  const s = req.session
  if (!s.paypal.service || s.paypal.isReal?.(id)) throw new HttpError(501, 'Buyer acceptance needs the sandbox buyer automation, which is not enabled on this deployment. See VERIFY.md (V9).')
  try {
    s.paypal.service.buyerAcceptsOffer(id)
  } catch {
    throw new HttpError(409, 'There is no open offer on this case.')
  }
  s.audit.add({ actor: 'seller', event: 'sandbox_buyer_accepts', disputeId: id })
  s.plan.version += 1
  res.json({ success: true, data: await stateOf(s) })
}))

api.post('/judge/claim', wrap(async (req, res) => {
  const s = req.session
  if (s.paypal.service) {
    // Offline mode (and the stand-in part of sandbox recording mode): put two extra cases (one INR, one SNAD) into this visitor's private stand-in.
    if (!s.judge.claim) {
      const make = (kind, amount, item, message) => s.paypal.service.create({ kind, amount, item, reason: kind === 'INR' ? 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' : 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', buyerMessage: message, settled: true, createdAt: Date.now() - 3_600_000 })
      const a = make('INR', 29.9, 'Desk Lamp', 'Ordered two weeks ago, nothing arrived.')
      const b = make('SNAD', 52.25, 'Wool Blanket', 'The color and the material do not match the listing.')
      s.judge.claim = { layer: 1, cases: [{ id: a, kind: 'INR' }, { id: b, kind: 'SNAD' }] }
      s.judge.expiresAt = Date.now() + 24 * 3_600_000
    }
  } else {
    const claim = pool.claim(s.id)
    s.judge.claim = claim
    for (const c of claim.cases) s.reserved.add(c.id)
  }
  s.audit.add({ actor: 'seller', event: 'claim_cases', layer: s.judge.claim.layer })
  res.json({ success: true, data: await stateOf(s) })
}))

// Read-only checks for VERIFY.md (V3 transactions, V8 tracking): thin wrappers over the Agent Toolkit tools.
api.get('/verify/transactions', wrap(async (req, res) => {
  const end = new Date()
  const start = new Date(end.getTime() - 30 * 86_400_000)
  const iso = (d) => `${d.toISOString().slice(0, 19)}Z`
  res.json({ success: true, mode: req.session.paypal.mode, data: await req.session.paypal.listTransactions({ start_date: iso(start), end_date: iso(end) }) })
}))
api.get('/verify/tracking/:orderId', wrap(async (req, res) => {
  const orderId = parse(z.string().regex(/^[A-Za-z0-9-]{3,40}$/), req.params.orderId)
  res.json({ success: true, mode: req.session.paypal.mode, data: await req.session.paypal.getTracking({ order_id: orderId, ...(req.query.transaction_id ? { transaction_id: String(req.query.transaction_id).slice(0, 40) } : {}) }) })
}))

api.get('/judge/status', (_req, res) => res.json({ success: true, data: pool.status() }))
api.get('/recorded-run', (_req, res) => res.json({ success: true, data: { ...recorded, evidence: sandboxEvidence, aiRuns } }))
api.get('/audit', (req, res) => res.json({ success: true, data: req.session.audit.list() }))

api.post('/reset', wrap(async (req, res) => {
  const old = req.session
  const fresh = createSession()
  res.cookie('dd_sid', fresh.id, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 3_600_000, secure: req.secure })
  old.audit.add({ actor: 'seller', event: 'session_reset' })
  res.json({ success: true, data: await stateOf(fresh) })
}))

api.post('/webhooks/paypal', wrap(handleWebhook))
api.post('/studio/llm', studioLlm)
api.post('/agent/run', agentRun)

// show_scenario_comparison runs in the browser and only sends a comparison id. The rows come from the calculator
// result the server kept for that id, so numbers a model passes along are never stored.
api.post('/scenarios', wrap(async (req, res) => {
  const body = parse(z.object({ comparisonId: z.string().regex(/^cmp_[a-f0-9]{8}$/) }), req.body)
  const saved = req.session.comparisons?.get(body.comparisonId)
  if (!saved) throw new HttpError(404, 'Unknown comparison. Run compare_acceptance first and pass its comparison_id.')
  req.session.scenarios = saved.rows.map((r) => ({ id: `q${Math.round(r.q * 100)}`, acceptance: Math.round(r.q * 100), label: `${Math.round(r.q * 100)}% accept`, bestPlan: r.bestPlan, bestTotal: r.bestTotal, offerPlan: r.offerPlan, offerTotal: r.offerTotal, offerWins: r.offerWins ? 'offer wins' : 'refund wins' }))
  res.json({ success: true, data: { title: saved.title, scenarios: req.session.scenarios } })
}))

export function errorHandler(err, _req, res, _next) {
  const status = err.status || (err.name === 'ZodError' ? 400 : 500)
  if (status >= 500) console.error('[server error]', err.message)
  res.status(status).json({ success: false, message: status >= 500 ? 'Server error' : err.message, ...(err.extra || {}) })
}
