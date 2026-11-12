// The 3-month window is not fully specified in PayPal's text (help350 says "previous 3 calendar months").
// Assumption (a): a dispute created in month M is rated on claims escalated in the 3 full months before M.
// Assumption (b): the rolling window includes the current month (M-2 .. M).
// Both are shown on screen and can be switched.
function monthStart(y, m) {
  return new Date(Date.UTC(y, m, 1))
}

function iso(d) {
  return d.toISOString().slice(0, 10)
}

function lastDayOf(y, m) {
  return new Date(Date.UTC(y, m + 1, 0))
}

// A claim escalated on `dateIso` counts for disputes created in [from, to] and drops out the day after `to`.
export function countsForWindow(dateIso, assumption = 'a') {
  const d = new Date(`${dateIso}T00:00:00Z`)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const firstMonth = assumption === 'b' ? m : m + 1
  const lastMonth = firstMonth + 2
  const from = monthStart(y, firstMonth)
  const to = lastDayOf(y, lastMonth)
  const dropsOut = new Date(to.getTime() + 86400000)
  return { from: iso(from), to: iso(to), dropsOut: iso(dropsOut) }
}

// The window of claims that rates a dispute created in the month of `createdIso`.
export function claimWindowFor(createdIso, assumption = 'a') {
  const d = new Date(`${createdIso}T00:00:00Z`)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const firstMonth = assumption === 'b' ? m - 2 : m - 3
  const lastMonth = assumption === 'b' ? m : m - 1
  return { from: iso(monthStart(y, firstMonth)), to: iso(lastDayOf(y, lastMonth)) }
}
