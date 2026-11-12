// Per-key async mutex so two money actions on the same dispute never overlap (same idea as CartPilot withOrderLock).
const tails = new Map()

export async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const tail = prev.then(() => gate)
  tails.set(key, tail)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}
