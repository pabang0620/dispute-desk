// Live Claude protection: caps on model runs (per client IP per hour, per host per day) with an injectable clock.
// A "run" is one user-triggered agent action. Over the cap the caller answers from the recorded run or the stand-in.
const HOUR_MS = 3_600_000

export function createLiveGuard({ perIpHour = 10, perDay = 150, now = Date.now } = {}) {
  const hitsByIp = new Map()
  let dayKey = ''
  let dayCount = 0
  return {
    /** Returns true and counts one run when the caps allow a live call, otherwise false. */
    tryAcquire(ip) {
      const t = now()
      const today = new Date(t).toISOString().slice(0, 10)
      if (today !== dayKey) {
        dayKey = today
        dayCount = 0
      }
      const recent = (hitsByIp.get(ip) || []).filter((x) => t - x < HOUR_MS)
      if (recent.length >= perIpHour || dayCount >= perDay) {
        hitsByIp.set(ip, recent)
        return false
      }
      hitsByIp.set(ip, [...recent, t])
      dayCount += 1
      return true
    },
  }
}

const positive = (v, d) => (Number(v) > 0 ? Number(v) : d)
export const liveGuard = createLiveGuard({
  perIpHour: positive(process.env.LLM_LIVE_PER_IP_HOUR, 10),
  perDay: positive(process.env.LLM_LIVE_PER_DAY, 150),
})
