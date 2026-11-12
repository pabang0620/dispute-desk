import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai'
import { PayPalError } from './errors.js'

// Live sandbox client. Reads go through the PayPal Agent Toolkit; seller actions the toolkit does not have
// (message, evidence, offer, escalate, supporting info, adjudicate, require evidence) call the Disputes v1 REST API.
const API_BASE = 'https://api-m.sandbox.paypal.com'
const ACTIONS = {
  orders: { get: true },
  shipment: { get: true, create: true },
  disputes: { list: true, get: true },
  transactions: { list: true },
}

const PATHS = {
  send_message: ['send-message', 'multipart'],
  provide_evidence: ['provide-evidence', 'multipart'],
  provide_supporting_info: ['provide-supporting-info', 'multipart'],
  make_offer: ['make-offer', 'json'],
  accept_claim: ['accept-claim', 'json'],
  escalate: ['escalate', 'json'],
  adjudicate: ['adjudicate', 'json'],
  require_evidence: ['require-evidence', 'json'],
}

export function createLivePaypal({ clientId, clientSecret }) {
  // The toolkit defaults to the LIVE PayPal API unless context.sandbox is true.
  const toolkit = new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: ACTIONS, context: { sandbox: true } } })
  let token = { value: null, expires: 0 }
  let counter = 0

  async function accessToken() {
    if (token.value && Date.now() < token.expires - 60_000) return token.value
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PayPalError(401, 'AUTHENTICATION_FAILURE', 'OAUTH_FAILED', `PayPal oauth failed (${res.status})`)
    const data = await res.json()
    token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
    return token.value
  }

  async function toolkitCall(name, args) {
    counter += 1
    const result = await toolkit.handleToolCall({ id: `call_${counter}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const parsed = JSON.parse(result.content)
    if (parsed?.error) throw new PayPalError(502, 'TOOLKIT_ERROR', 'TOOLKIT_CALL_FAILED', typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error))
    return parsed
  }

  async function post(id, action, payload, files) {
    const [path, kind] = PATHS[action]
    const headers = { Authorization: `Bearer ${await accessToken()}` }
    let body
    if (kind === 'multipart') {
      // The sandbox expects the JSON body in a multipart part named "input" (RESULT.md).
      body = new FormData()
      body.append('input', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'input.json')
      files.forEach((f, i) => body.append(`file${i + 1}`, new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name))
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload)
    }
    const res = await fetch(`${API_BASE}/v1/customer/disputes/${encodeURIComponent(id)}/${path}`, { method: 'POST', headers, body })
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) throw new PayPalError(res.status, data.name || 'ERROR', data.details?.[0]?.issue || 'UNKNOWN', data.message)
    return data
  }

  // POST /v1/notifications/verify-webhook-signature (VERIFY V7). Returns true only for verification_status SUCCESS.
  async function verifyWebhook({ headers, event, webhookId }) {
    const res = await fetch(`${API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: event,
      }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok && data.verification_status === 'SUCCESS'
  }

  return {
    mode: 'sandbox',
    verifyWebhook,
    listDisputes: (args = {}) => toolkitCall('list_disputes', { page_size: 50, ...args }),
    getDispute: (id) => toolkitCall('get_dispute', { dispute_id: id }),
    act: (id, action, payload = {}, files = []) => post(id, action, payload, files),
    getOrder: (orderId) => toolkitCall('get_order', { order_id: orderId }),
    getTracking: (args) => toolkitCall('get_shipment_tracking', args),
    listTransactions: (args = {}) => toolkitCall('list_transactions', args),
  }
}
