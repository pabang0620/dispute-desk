export const usd = (v) => `$${(Math.round(Number(v) * 100) / 100).toFixed(2)}`
export const pct = (v) => `${Number(v).toFixed(2)}%`
export const KIND_LABEL = { INR: 'Item not received', SNAD: 'Not as described', OTHER: 'Other' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function shortDate(iso) {
  if (!iso) return ''
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
}
export function rangeText(w) {
  return `${shortDate(w.from)} - ${shortDate(w.to)}`
}
export function untilText(ms) {
  if (ms == null) return 'no deadline'
  if (ms <= 0) return 'overdue'
  const h = ms / 3_600_000
  return h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(ms / 60000))}m`
}

export const LLM_LABEL = { live: 'Anthropic API', account: 'Claude Sonnet (local account)', mock: 'offline stand-in' }
