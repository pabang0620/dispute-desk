// Append-only audit log per session. Every card, approval, rejection, PayPal call and blocked action lands here.
export function createAudit() {
  const entries = []
  return {
    add(event) {
      const entry = { id: entries.length + 1, at: new Date().toISOString(), ...event }
      entries.push(entry)
      return entry
    },
    list: () => entries.map((e) => ({ ...e })),
  }
}
