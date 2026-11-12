// Money is handled in integer cents so rates and fees never drift on floating point.
export function toCents(value) {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) throw new Error(`Not a money value: ${value}`)
  return Math.round(n * 100)
}

export function fromCents(cents) {
  return cents / 100
}

export function formatUsd(value) {
  return `$${(Math.round(value * 100) / 100).toFixed(2)}`
}

export function round2(value) {
  return Math.round(value * 100) / 100
}

export function pctString(ratio) {
  return (ratio * 100).toFixed(2)
}

// PayPal money object: { currency_code, value: "41.37" }
export function paypalAmount(value) {
  return { currency_code: 'USD', value: (Math.round(value * 100) / 100).toFixed(2) }
}

export function readPaypalAmount(amount) {
  return Number(amount?.value ?? 0)
}
