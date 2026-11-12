import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// Judge demo paths (PLAN 11-1). Layer 0 needs nothing from here. This pool serves layers 1 and 2:
//   layer 1: a live pool of sandbox disputes the worker refills one at a time
//   layer 2: reserved stock created by hand before the deadline: bundle I (still an inquiry) and bundle C (already a claim)
// If nothing is available the visitor gets layer 3 (recorded run + local setup). The pool never throws at a visitor.
const HOUR = 3_600_000
const DAY = 86_400_000

export class DisputePool {
  constructor({ createFn = null, clock = () => Date.now(), target = 6, maxPerDay = 20, maxFailStreak = 3, maxFailsPerDay = 5, pauseMs = HOUR, retireWithinMs = 48 * HOUR, stateFile = '' } = {}) {
    Object.assign(this, { createFn, clock, target, maxPerDay, maxFailStreak, maxFailsPerDay, pauseMs, retireWithinMs, stateFile })
    this.state = { items: [], failStreak: 0, pausedUntil: 0, dayKey: '', createdToday: 0, failsToday: 0, lastSuccessAt: null, disabledToday: false }
    this.busy = false
    this.load()
  }

  load() {
    if (this.stateFile && existsSync(this.stateFile)) {
      try {
        this.state = { ...this.state, ...JSON.parse(readFileSync(this.stateFile, 'utf8')) }
        // A restart can interrupt a creation: anything still being created is not trusted.
        this.state.items = this.state.items.map((i) => (i.status === 'CREATING' ? { ...i, status: 'RETIRED' } : i))
      } catch {
        this.state.items = []
      }
    }
  }

  save() {
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify(this.state, null, 1))
  }

  addReserved({ id, kind, amount, bundle, dueAt }) {
    this.state.items.push({ id, kind, amount, bundle, dueAt, status: 'READY', reserved: true })
    this.save()
  }

  rollDay(now) {
    const key = new Date(now).toISOString().slice(0, 10)
    if (key !== this.state.dayKey) Object.assign(this.state, { dayKey: key, createdToday: 0, failsToday: 0, disabledToday: false })
  }

  counts(now = this.clock()) {
    const live = this.state.items.filter((i) => !i.reserved)
    const ready = (b) => this.state.items.filter((i) => i.bundle === b && i.status === 'READY' && i.dueAt > now).length
    return { ready: live.filter((i) => i.status === 'READY' && i.dueAt > now).length, creating: live.filter((i) => i.status === 'CREATING' || i.status === 'SETTLING').length, bundleI: ready('I'), bundleC: ready('C') }
  }

  /** One refill step. Returns what happened so the caller can log it. Only one creation runs at a time. */
  async tick() {
    const now = this.clock()
    this.rollDay(now)
    for (const i of this.state.items) if (!i.reserved && i.status === 'READY' && i.dueAt - now < this.retireWithinMs) i.status = 'RETIRED'
    if (!this.createFn || this.busy) return { did: 'idle' }
    if (now < this.state.pausedUntil) return { did: 'paused' }
    if (this.state.disabledToday) return { did: 'disabled_today' }
    const c = this.counts(now)
    if (c.ready + c.creating >= this.target) return { did: 'full' }
    if (this.state.createdToday >= this.maxPerDay) return { did: 'daily_cap' }
    this.busy = true
    const kind = c.ready % 2 === 0 ? 'INR' : 'SNAD'
    const amount = 20 + ((this.state.createdToday * 7) % 60) + (this.state.createdToday % 5) / 100 + 0.17 // distinct amounts: the buyer UI picks the payment by amount
    try {
      const made = await this.createFn({ kind, amount: Number(amount.toFixed(2)) })
      this.state.items.push({ id: made.id, kind, amount: made.amount ?? amount, bundle: 'live', dueAt: made.dueAt ?? now + 20 * DAY, status: 'READY' })
      Object.assign(this.state, { failStreak: 0, createdToday: this.state.createdToday + 1, lastSuccessAt: new Date(now).toISOString() })
      return { did: 'created', id: made.id }
    } catch (err) {
      this.state.failStreak += 1
      this.state.failsToday += 1
      if (this.state.failStreak >= this.maxFailStreak) Object.assign(this.state, { pausedUntil: now + this.pauseMs, failStreak: 0 })
      // Repeated buyer-login failures are never retried hammer-style: past the daily limit the pool stays off until tomorrow.
      if (this.state.failsToday > this.maxFailsPerDay) this.state.disabledToday = true
      return { did: 'failed', error: err.message }
    } finally {
      this.busy = false
      this.save()
    }
  }

  /** Two cases for a visitor: one item-not-received and one not-as-described, from the best layer available. */
  claim(sessionId, now = this.clock()) {
    const mine = this.state.items.filter((i) => i.assignedTo === sessionId && i.assignedUntil > now)
    if (mine.length) return { layer: mine[0].reserved ? 2 : 1, cases: mine, again: true }
    const pick = (kind, preds) => {
      for (const pred of preds) {
        const found = this.state.items.find((i) => i.kind === kind && i.status === 'READY' && !i.assignedTo && i.dueAt > now && pred(i))
        if (found) return found
      }
      return null
    }
    // Bundle I (inquiry stage) first, then the live pool, then bundle C (already claims).
    const order = [(i) => i.bundle === 'I', (i) => i.bundle === 'live', (i) => i.bundle === 'C']
    const inr = pick('INR', order)
    const snad = pick('SNAD', order)
    const cases = [inr, snad].filter(Boolean)
    if (!cases.length) return { layer: 3, cases: [] }
    for (const c of cases) Object.assign(c, { status: 'ASSIGNED', assignedTo: sessionId, assignedUntil: now + DAY })
    this.save()
    const layer = cases.every((c) => c.bundle === 'live') ? 1 : 2
    return { layer, cases, claimStage: cases.some((c) => c.bundle === 'C') }
  }

  status() {
    const now = this.clock()
    return { ...this.counts(now), paused: now < this.state.pausedUntil, disabledToday: this.state.disabledToday, lastSuccessAt: this.state.lastSuccessAt, createdToday: this.state.createdToday }
  }
}
