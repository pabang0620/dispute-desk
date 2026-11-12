import { useSyncExternalStore } from 'react'

// Small external store: the server state (/api/state) plus what is selected on screen.
// Widgets inside AG Studio read it with useStore(); the actions below call the server and refresh it.
let state = { loading: true, error: null, data: null, selectedId: null, busy: false, toast: null, drafts: {}, aiSource: null }
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function getState() {
  return state
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state))
}

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  const json = await res.json().catch(() => ({ success: false, message: `Server returned ${res.status}` }))
  if (!res.ok || json.success === false) {
    const err = new Error(json.message || `Request failed (${res.status})`)
    err.payload = json
    throw err
  }
  return json
}

export async function refresh() {
  try {
    const json = await call('GET', '/api/state')
    const data = json.data
    const keep = state.selectedId && data.tables.disputes.some((d) => d.id === state.selectedId)
    const firstOpen = data.view.cases?.[0]?.disputeId || null
    set({ data, loading: false, error: null, selectedId: keep ? state.selectedId : firstOpen })
  } catch (err) {
    set({ loading: false, error: err.message })
  }
}

function adopt(json) {
  const data = json.state || json.data
  if (data?.view) set({ data })
}

export async function run(fn, success) {
  set({ busy: true })
  try {
    const out = await fn()
    if (success) set({ toast: { kind: 'ok', text: success } })
    return out
  } catch (err) {
    set({ toast: { kind: 'error', text: err.message } })
    throw err
  } finally {
    set({ busy: false })
  }
}

export const select = (id) => set({ selectedId: id })
export const dismissToast = () => set({ toast: null })

export async function setPlan(patch) {
  const json = await run(() => call('POST', '/api/plan', patch))
  adopt(json)
}

export async function createCard(disputeId, action, params = {}) {
  const json = await run(() => call('POST', '/api/approvals', { disputeId, action, params }))
  await refresh()
  return json.data
}

// Which answered the last AI turn: the model, a recorded real run, or the scripted stand-in (sent by the server).
export function noteAiSource({ source, label }) {
  if (state.aiSource?.label === label) return
  set({ aiSource: { source, label } })
}

// "Draft with Claude": the server runs the dispute-analyst on the records and returns the card and the steps it took.
export async function draftWithClaude(disputeId, action = 'send_message') {
  const json = await run(() => call('POST', '/api/approvals/draft', { disputeId, action }), 'Claude drafted a card')
  set({ drafts: { ...state.drafts, [disputeId]: { steps: json.data.steps, model: json.data.model, source: json.data.source, label: json.data.label, cardId: json.data.card.id } } })
  noteAiSource({ source: json.data.source, label: json.data.label })
  await refresh()
  return json.data
}

export async function editCard(cardId, params) {
  const json = await run(() => call('PATCH', `/api/approvals/${cardId}`, { params }))
  await refresh()
  return json.data
}

export async function approveCard(card) {
  try {
    const json = await run(() => call('POST', `/api/approvals/${card.id}/approve`, { hash: card.hash, token: card.token }), 'Sent to PayPal')
    adopt(json)
    return json.data
  } finally {
    await refresh()
  }
}

export async function rejectCard(cardId) {
  await run(() => call('POST', `/api/approvals/${cardId}/reject`))
  await refresh()
}

export async function buyerAccepts(disputeId) {
  const json = await run(() => call('POST', `/api/sandbox/${disputeId}/buyer-accepts`), 'Sandbox buyer accepted the offer')
  adopt(json)
}

export async function claimCases() {
  const json = await run(() => call('POST', '/api/judge/claim'), 'Cases claimed')
  adopt(json)
}

export async function resetSession() {
  const json = await run(() => call('POST', '/api/reset'), 'Demo reset')
  adopt(json)
  set({ selectedId: json.data.view.cases?.[0]?.disputeId || null })
}

export async function loadDispute(id) {
  const json = await call('GET', `/api/disputes/${id}`)
  return json.data
}

export async function loadRecorded() {
  return (await call('GET', '/api/recorded-run')).data
}

// The server fills the scenarios table from the calculator result it kept for this id.
export async function saveScenarios(comparisonId) {
  const json = await call('POST', '/api/scenarios', { comparisonId })
  await refresh()
  return json.data
}

// Poll while something is in flight at PayPal (UNDER_REVIEW, resolving) so the screen follows the sandbox.
let timer = null
export function startPolling(ms = 2500) {
  if (timer) return
  timer = setInterval(() => {
    const d = state.data
    const waiting = d?.tables.disputes.some((x) => x.state === 'UNDER_PAYPAL_REVIEW')
    if (waiting) refresh()
  }, ms)
}
