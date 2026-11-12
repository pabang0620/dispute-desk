import { config } from '../config.js'
import { createLivePaypal } from './live.js'
import { MockDisputeService } from './mockDisputes.js'
import { PayPalError } from './errors.js'
import { getStoreOrder, STORE_ORDERS } from '../data/storeOrders.js'
import { SCENARIO } from '../domain/scenario.js'

// One facade for both modes: with PayPal sandbox keys it calls the sandbox, without keys it runs the
// stateful stand-in that returns the same response shapes. Nothing else in the app knows which one it is.
function createMockPaypal({ skipLabels = [], base = Date.now() - 2 * 86_400_000 } = {}) {
  const service = new MockDisputeService({ scale: config.mockTimeScale })
  SCENARIO.openInquiries.forEach((c, i) => {
    if (!skipLabels.includes(c.label)) seedCase(service, c, base + i * 1000)
  })
  return {
    mode: 'mock',
    service,
    orderIdOf: (id, d) => service.disputes.get(id)?._orderId || matchByItem(d),
    // When the stand-in will make its next state change (observed sandbox duration / MOCK_TIME_SCALE).
    nextChangeOf: (id) => {
      const next = service.disputes.get(id)?._pending?.[0]
      return next ? { at: new Date(next.at).toISOString(), step: next.step, timeScale: service.scale } : null
    },
    listDisputes: async (args) => service.listDisputes(args),
    getDispute: async (id) => service.getDispute(id),
    act: async (id, action, payload, files) => service.act(id, action, payload, files),
    getOrder: async (orderId) => ({ id: orderId, source: 'demo store data', ...getStoreOrder(orderId) }),
    getTracking: async ({ order_id: orderId }) => ({ order_id: orderId, source: 'demo store data', tracker: getStoreOrder(orderId)?.tracking || null }),
    listTransactions: async () => ({ transaction_details: [], source: 'mock: sandbox sellers have no 3-month sales history' }),
  }
}

function seedCase(service, c, createdAt) {
  service.create({
    disputeId: c.disputeId,
    kind: c.kind,
    reason: c.reason,
    amount: c.amount,
    item: c.item,
    buyerMessage: c.buyerMessage,
    orderId: c.orderId,
    paymentMethod: c.paymentMethod,
    sellerProtectionEligible: c.sellerProtectionEligible,
    settled: true,
    createdAt,
  })
}

// Live sandbox disputes carry no store order id, so they are matched to demo store data by item name.
function matchByItem(d) {
  const name = d?.disputed_transactions?.[0]?.items?.[0]?.item_name
  return Object.values(STORE_ORDERS).find((o) => o.item === name)?.orderId || null
}

let liveClient = null
const live = () => (liveClient ||= { ...createLivePaypal({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret }), orderIdOf: (id, d) => matchByItem(d) })

// Sandbox demo mode (sandbox keys plus SANDBOX_CASE_A=<dispute id>[,<dispute id>...]): case A of the demo scenario is a
// real PayPal sandbox dispute filed with the same amount and item (SNAD, USD 66.12, Wool Blanket), so the refund runs
// against api-m.sandbox.paypal.com with real ids. Cases B and C stay in a private stand-in, so the plan numbers match
// the offline demo. Each session takes the first listed case that is still open and not used by another session's
// refund; when none is left, case A falls back to the stand-in and the screen says so.
const consumed = new Set()

export function createHybridPaypal(candidates, real = live()) {
  // Stand-in cases are created after the real case so the real one keeps label A (labels follow creation order).
  const mock = createMockPaypal({ skipLabels: ['A'], base: Date.now() })
  const approvedAt = new Map()
  let realId = null
  let picked = null
  const pick = () =>
    (picked ||= (async () => {
      for (const id of candidates) {
        if (consumed.has(id)) continue
        try {
          const d = await real.getDispute(id)
          // A fresh case is still under review for a few minutes; it is taken anyway and the card says what it waits for.
          if (d.dispute_state === 'RESOLVED') {
            consumed.add(id)
            continue
          }
          realId = id
          return
        } catch {
          // An id the sandbox does not know is skipped, never shown.
        }
      }
      const a = SCENARIO.openInquiries.find((c) => c.label === 'A')
      seedCase(mock.service, a, Date.now() - 60_000)
    })())
  const isReal = (id) => realId !== null && id === realId
  return {
    mode: 'hybrid',
    get realIds() {
      return realId ? [realId] : []
    },
    isReal,
    service: mock.service,
    orderIdOf: (id, d) => (isReal(id) ? matchByItem(d) : mock.orderIdOf(id, d)),
    // The real sandbox has no schedule: the screen shows the clock since approval and the measured duration (VERIFY R15).
    nextChangeOf: (id) => {
      if (!isReal(id)) return mock.nextChangeOf(id)
      const since = approvedAt.get(id)
      return since ? { live: true, since: new Date(since).toISOString(), step: 'resolve' } : null
    },
    listDisputes: async (args) => {
      await pick()
      const own = await mock.listDisputes(args)
      return { ...own, items: realId ? [...own.items, { dispute_id: realId }] : own.items }
    },
    getDispute: async (id) => (isReal(id) ? real.getDispute(id) : mock.getDispute(id)),
    act: async (id, action, payload, files) => {
      if (!isReal(id)) return mock.act(id, action, payload, files)
      if (consumed.has(id)) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE', 'Another session already acted on this sandbox case.')
      const out = await real.act(id, action, payload, files)
      if (action === 'accept_claim') consumed.add(id)
      approvedAt.set(id, Date.now())
      return out
    },
    getOrder: mock.getOrder,
    getTracking: mock.getTracking,
    listTransactions: mock.listTransactions,
  }
}

// The sandbox client itself (null without keys). Webhooks are verified with it in sandbox and in sandbox demo mode,
// where a session's client is the hybrid one (case A real, B and C stand-in) and has no verifyWebhook of its own.
export const sandboxPaypal = () => (config.paypalClientId && config.paypalClientSecret ? live() : null)

// Mock mode gives every visitor session its own simulator so one visitor's refund never changes another's demo.
// Sandbox mode shares one client; the approval layer limits writes to cases reserved for the session.
export function paypalForSession() {
  if (config.paypalClientId && config.paypalClientSecret) {
    if (config.sandboxCasesA.length) return createHybridPaypal(config.sandboxCasesA)
    return live()
  }
  return createMockPaypal()
}
