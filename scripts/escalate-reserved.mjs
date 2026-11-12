// VERIFY V17: escalate the reserved claim-stage bundle (bundle C) on the date you choose (PLAN: Dec 1), so its reply
// window restarts at +10 days. Needs sandbox keys and STATE_FILE. Run it yourself:
//   STATE_FILE=./pool-state.json node scripts/escalate-reserved.mjs
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { createLivePaypal } from '../server/paypal/live.js'

const file = process.env.STATE_FILE
const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env
if (!file || !clientId || !clientSecret) {
  console.error('Set STATE_FILE, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.')
  process.exit(1)
}
const paypal = createLivePaypal({ clientId, clientSecret })
const state = JSON.parse(readFileSync(file, 'utf8'))
for (const item of state.items.filter((i) => i.bundle === 'C' && !i.escalatedAt)) {
  try {
    const d = await paypal.getDispute(item.id)
    if (!d.links.some((l) => l.rel === 'escalate')) {
      console.log(`${item.id}: no escalate link (state ${d.dispute_state}, stage ${d.dispute_life_cycle_stage}), skipped`)
      continue
    }
    await paypal.act(item.id, 'escalate', { note: 'Escalating to PayPal for review.' })
    item.escalatedAt = new Date().toISOString()
    item.dueAt = Date.now() + 10 * 86_400_000 // observed: claim stage reply window is +10 days; re-read the real date from get_dispute
    console.log(`${item.id}: escalated`)
  } catch (err) {
    console.log(`${item.id}: ${err.message}`)
  }
}
writeFileSync(file, JSON.stringify(state, null, 1))
