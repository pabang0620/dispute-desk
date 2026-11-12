import { createHash } from 'node:crypto'

// Stable JSON: keys sorted so the same request always hashes the same.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function requestHash({ disputeId, action, payload, files = [] }) {
  const fileHashes = files.map((f) => ({ name: f.name, sha256: sha256(f.data) }))
  return sha256(stableStringify({ disputeId, action, payload, files: fileHashes }))
}
