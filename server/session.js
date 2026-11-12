import { randomUUID } from 'node:crypto'
import { paypalForSession } from './paypal/index.js'
import { scenarioLedger, scenarioAssumptions, SCENARIO } from './domain/scenario.js'
import { createAudit } from './audit.js'

const MAX_SESSIONS = 300
const TTL_MS = 24 * 3_600_000
const sessions = new Map()

export function newPlanState() {
  const a = scenarioAssumptions()
  return {
    choices: null, // null = start from the case-by-case preset, then the seller toggles
    q: a.q,
    p: a.p,
    returnValueRatio: 0.5,
    period: a.period,
    windowAssumption: a.windowAssumption,
    offerAmount: SCENARIO.offerAmount,
    version: 1,
  }
}

export function createSession() {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]
    sessions.delete(oldest.id)
  }
  const session = {
    id: randomUUID(),
    createdAt: Date.now(),
    lastSeen: Date.now(),
    paypal: paypalForSession(),
    ledger: structuredClone(scenarioLedger()),
    plan: newPlanState(),
    approvals: new Map(),
    // dispute-analyst runs waiting on a Studio tool: the server keeps the full history (Studio drops server tool calls)
    agentThreads: new Map(),
    audit: createAudit(),
    reserved: new Set(),
    judge: { claimed: false, expiresAt: null },
    snapshotVersion: 0,
  }
  sessions.set(session.id, session)
  return session
}

export function getSession(id) {
  const s = id ? sessions.get(id) : null
  if (!s) return null
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(id)
    return null
  }
  s.lastSeen = Date.now()
  return s
}

export function sessionCount() {
  return sessions.size
}
