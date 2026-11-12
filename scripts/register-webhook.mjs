// One-time setup for VERIFY V7: registers the CUSTOMER.DISPUTE.* webhook for PUBLIC_URL on your sandbox app.
// Run it yourself after reviewing it: node scripts/register-webhook.mjs
import 'dotenv/config'

const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PUBLIC_URL: url } = process.env
if (!id || !secret || !url || !url.startsWith('https://')) {
  console.error('Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and an https PUBLIC_URL first.')
  process.exit(1)
}
const base = 'https://api-m.sandbox.paypal.com'
const tokenRes = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
const { access_token: token } = await tokenRes.json()
const res = await fetch(`${base}/v1/notifications/webhooks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: `${url.replace(/\/$/, '')}/api/webhooks/paypal`, event_types: [{ name: 'CUSTOMER.DISPUTE.CREATED' }, { name: 'CUSTOMER.DISPUTE.UPDATED' }, { name: 'CUSTOMER.DISPUTE.RESOLVED' }] }),
})
const body = await res.json()
console.log(res.status, body.id ? `webhook id ${body.id}: put it in PAYPAL_WEBHOOK_ID` : JSON.stringify(body))
