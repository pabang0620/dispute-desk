// VERIFY R23: the four seller writes through the app's own approval cards, against a running app connected to the
// PayPal sandbox with reserved inquiry cases (scripts/reserve.mjs before the app starts; this script claims them).
//   node scripts/verify-writes.mjs <app url> <case for send_message> <case for make_offer> <case for escalate+evidence>
// Use a separate case for each part (observed: after a seller message the case waits for the buyer and PayPal drops
// make_offer). Pass - for a part you want to skip. Prints one line per step. Sandbox only; no secrets are read or printed.
const [base, msgCase, offerCase, escCase] = process.argv.slice(2)
const valid = (x) => /^PP-R-[A-Z]{3}-\d+$|^-$/.test(x || '')
if (!base || ![msgCase, offerCase, escCase].every(valid)) {
  process.stderr.write('Usage: node scripts/verify-writes.mjs <app url> <message case|-> <offer case|-> <escalate case|->\n')
  process.exit(1)
}
let cookie = ''
const out = (line) => process.stdout.write(`${new Date().toISOString().slice(11, 19)}Z ${line}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// A new case can take a few minutes to appear in the sandbox dispute list: null until then.
const detail = async (id) => (await call('GET', `/disputes/${id}`)).json.data?.dispute || null
const rels = (d) => d.links.map((l) => l.rel).filter((r) => r !== 'self')
const stateOf = (d) => (d ? `${d.dispute_life_cycle_stage}/${d.dispute_state}, links ${rels(d).join(',')}` : 'not listed yet')

async function waitFor(id, pred, label, maxMs = 8 * 60_000) {
  const t0 = Date.now()
  for (;;) {
    const d = await detail(id)
    if (d && pred(d)) {
      out(`${id} ${label} after ${Math.round((Date.now() - t0) / 1000)}s: ${stateOf(d)}`)
      return d
    }
    if (Date.now() - t0 > maxMs) {
      out(`${id} ${label} not reached in ${maxMs / 60000} min: ${stateOf(d)}`)
      return null
    }
    await sleep(15_000)
  }
}

async function cardAndApprove(id, action, params) {
  const made = await call('POST', '/approvals', { disputeId: id, action, params })
  if (made.status !== 201) {
    out(`${id} ${action} card: ${made.status} ${made.json.message}`)
    return null
  }
  const card = made.json.data
  const ok = await call('POST', `/approvals/${card.id}/approve`, { hash: card.hash, token: card.token })
  out(`${id} ${action}: approve ${ok.status} ${ok.json.data?.status || ok.json.message}`)
  return card
}

const actionable = (rel) => (d) => d.dispute_state === 'REQUIRED_ACTION' && rels(d).includes(rel)

// (3) send_message, then a second approval of the same card must answer 409.
async function message(id) {
  if (!(await waitFor(id, actionable('send_message'), 'message allowed'))) return
  const card = await cardAndApprove(id, 'send_message', { message: 'Thanks for reaching out. We are checking the order details and will reply here shortly.' })
  if (!card) return
  const again = await call('POST', `/approvals/${card.id}/approve`, { hash: card.hash, token: card.token })
  out(`${id} send_message second approval: ${again.status} ${again.json.message}`)
  const d = await detail(id)
  out(`${id} after message: ${stateOf(d)}; messages ${(d.messages || []).map((m) => `${m.posted_by}: ${m.content.slice(0, 40)}`).join(' | ')}`)
}

// (1) make_offer $20.
async function offer(id) {
  if (!(await waitFor(id, actionable('make_offer'), 'offer allowed'))) return
  if (!(await cardAndApprove(id, 'make_offer', { amount: 20 }))) return
  const d = await waitFor(id, (x) => Boolean(x.offer?.seller_offered_amount), 'offer recorded', 3 * 60_000)
  if (d) out(`${id} seller_offered_amount ${d.offer.seller_offered_amount.value} ${d.offer.seller_offered_amount.currency_code}`)
}

// (2) escalate, wait for the claim stage, then (4) provide_evidence with tracking.
async function escalateThenEvidence(id) {
  if (!(await waitFor(id, actionable('escalate'), 'escalate allowed'))) return
  if (!(await cardAndApprove(id, 'escalate', { note: 'The item was shipped with tracking; please review.' }))) return
  const d = await waitFor(id, (x) => x.dispute_life_cycle_stage === 'CHARGEBACK' && rels(x).includes('provide_evidence'), 'claim stage with provide_evidence', 12 * 60_000)
  if (!d) return
  out(`${id} requested evidence: ${(d.evidences || []).filter((e) => e.source === 'REQUESTED_FROM_SELLER').map((e) => e.evidence_type).join(',') || 'none listed'}`)
  await cardAndApprove(id, 'provide_evidence', { notes: 'Shipped with tracking. Carrier record attached.', trackingNumber: '9400111899223100000204', carrier: 'USPS' })
  out(`${id} after evidence: ${stateOf(await detail(id))}`)
}

await call('GET', '/state')
const claim = await call('POST', '/judge/claim')
out(`claim layer ${claim.json.data.banner.layer}: ${claim.json.data.banner.text}`)
if (msgCase !== '-') await message(msgCase)
if (offerCase !== '-') await offer(offerCase)
if (escCase !== '-') await escalateThenEvidence(escCase)
const audit = (await call('GET', '/audit')).json.data.filter((e) => /paypal_call/.test(e.event)).map((e) => `${e.disputeId} ${e.action} ${e.event}${e.issue ? ` ${e.issue}` : ''}`)
out(`audit: ${audit.join(' | ')}`)
