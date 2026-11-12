import { config } from './config.js'
import { sandboxPaypal } from './paypal/index.js'
import { HttpError } from './http.js'

// PayPal webhooks CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED (PLAN 5, VERIFY V7). Only a verified event is accepted.
// Without a webhook the app polls instead; it never trusts an unsigned request.
const WATCHED = new Set(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'])
const recent = []

export const webhookStatus = () => ({ enabled: Boolean(config.paypalWebhookId && config.paypalClientId), count: recent.length, last: recent.at(-1) || null })

export async function handleWebhook(req, res) {
  const client = sandboxPaypal()
  if (!config.paypalWebhookId || !client?.verifyWebhook) {
    throw new HttpError(501, 'Webhooks need a PayPal sandbox app and PAYPAL_WEBHOOK_ID. The app polls the Disputes API instead.')
  }
  const event = req.body
  if (!event || typeof event !== 'object' || !WATCHED.has(event.event_type)) throw new HttpError(400, 'Not a dispute webhook event')
  const ok = await client.verifyWebhook({ headers: req.headers, event, webhookId: config.paypalWebhookId })
  if (!ok) throw new HttpError(401, 'Webhook signature verification failed')
  recent.push({ type: event.event_type, disputeId: event.resource?.dispute_id || null, at: new Date().toISOString() })
  if (recent.length > 50) recent.shift()
  res.json({ success: true })
}
