// Public demo guard: caps model turns per IP per hour and per day so the hosted demo cannot burn through credits.
// Over the cap, requests are answered by the offline stand-in instead of the paid model (the demo keeps working).
const PER_IP_HOUR = Number(process.env.CHAT_PER_IP_HOUR || 40)
const PER_DAY = Number(process.env.CHAT_PER_DAY || 300)
const HOUR_MS = 3_600_000

const hitsByIp = new Map()
let dayKey = ''
let dayCount = 0

/** Returns true when this request must use the offline stand-in. */
export function agentLimiter(req) {
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  if (today !== dayKey) {
    dayKey = today
    dayCount = 0
    hitsByIp.clear()
  }
  const recent = (hitsByIp.get(req.ip) || []).filter((t) => now - t < HOUR_MS)
  if (recent.length >= PER_IP_HOUR || dayCount >= PER_DAY) return true
  hitsByIp.set(req.ip, [...recent, now])
  dayCount += 1
  return false
}

// Write actions are limited too: 30 per hour overall (PLAN 11-1).
const WRITES_PER_HOUR = Number(process.env.WRITES_PER_HOUR || 30)
let writes = []
export function writeLimiter(_req, res, next) {
  const now = Date.now()
  writes = writes.filter((t) => now - t < HOUR_MS)
  if (writes.length >= WRITES_PER_HOUR) return res.status(429).json({ success: false, message: 'Too many PayPal actions this hour. Try the Recorded run.' })
  writes.push(now)
  next()
}
