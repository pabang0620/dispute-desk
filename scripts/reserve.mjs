// Record a dispute you created by hand before the deadline as reserved stock for judges (PLAN 11-1, layer 2).
//   STATE_FILE=./pool-state.json node scripts/reserve.mjs I PP-R-ABC-10200001 INR 41.37 2026-12-03T10:00:00Z
// bundle I = still an inquiry (do not escalate), bundle C = already escalated to a claim. The last argument is the reply deadline.
import 'dotenv/config'
import { DisputePool } from '../server/judge/pool.js'

const [bundle, id, kind, amount, dueIso] = process.argv.slice(2)
if (!process.env.STATE_FILE || !['I', 'C'].includes(bundle) || !/^PP-R-/.test(id || '') || !['INR', 'SNAD'].includes(kind) || !(Number(amount) > 0) || Number.isNaN(Date.parse(dueIso))) {
  console.error('Usage: STATE_FILE=... node scripts/reserve.mjs <I|C> <dispute id> <INR|SNAD> <amount> <due ISO time>')
  process.exit(1)
}
const pool = new DisputePool({ stateFile: process.env.STATE_FILE })
pool.addReserved({ id, kind, amount: Number(amount), bundle, dueAt: Date.parse(dueIso) })
console.log(`Reserved ${id} (bundle ${bundle}). Status:`, pool.status())
