import { config, modes } from './config.js'
import { pool } from './routes.js'
import { createApp } from './app.js'

createApp().listen(config.port, () => {
  console.log(`Dispute Desk listening on port ${config.port}, public URL ${config.publicUrl}`)
  console.log(`Modes: Claude=${modes.llm} PayPal=${modes.paypal}`)
})

// The refill worker only runs when a sandbox is connected and the operator turned it on (POOL_ENABLED=1).
if (config.poolEnabled && modes.paypal === 'sandbox') {
  setInterval(() => pool.tick().catch(() => {}), 60_000)
}
