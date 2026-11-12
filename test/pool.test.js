import test from 'node:test'
import assert from 'node:assert/strict'
import { DisputePool } from '../server/judge/pool.js'
import { bannerFor } from '../server/judge/banner.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

function make(opts = {}) {
  let t = Date.parse('2026-12-02T10:00:00Z')
  let n = 0
  const created = []
  const pool = new DisputePool({ clock: () => t, createFn: async ({ kind, amount }) => { created.push({ kind, amount }); n += 1; return { id: `PP-R-NEW-${n}`, amount, dueAt: t + 20 * DAY } }, ...opts })
  return { pool, advance: (ms) => { t += ms }, created, now: () => t }
}

test('the worker creates one dispute at a time up to the target, with distinct amounts', async () => {
  const { pool, created } = make({ target: 3 })
  for (let i = 0; i < 5; i += 1) await pool.tick()
  assert.equal(created.length, 3)
  assert.equal(new Set(created.map((c) => c.amount)).size, 3)
  assert.equal((await pool.tick()).did, 'full')
})

test('three failures in a row pause the worker for an hour; more than 5 failures a day switch it off until tomorrow', async () => {
  let fail = true
  const { pool, advance } = make({ createFn: async () => { if (fail) throw new Error('login failed'); return { id: 'PP-R-OK-1' } }, target: 6 })
  for (let i = 0; i < 3; i += 1) await pool.tick()
  assert.equal((await pool.tick()).did, 'paused')
  advance(HOUR + 1)
  for (let i = 0; i < 3; i += 1) await pool.tick()
  assert.equal(pool.status().paused, true)
  advance(HOUR + 1)
  await pool.tick()
  assert.equal((await pool.tick()).did, 'disabled_today')
  advance(DAY)
  fail = false
  assert.equal((await pool.tick()).did, 'created')
})

test('READY cases within 48 hours of the deadline are retired and replaced', async () => {
  const { pool, advance } = make({ target: 1 })
  await pool.tick()
  assert.equal(pool.status().ready, 1)
  advance(19 * DAY + 2 * HOUR)
  const r = await pool.tick()
  assert.equal(r.did, 'created')
  assert.equal(pool.state.items.filter((i) => i.status === 'RETIRED').length, 1)
})

test('claim: bundle I (inquiry) first, then the live pool, then bundle C (already claims); layer 3 when empty', async () => {
  const { pool, now } = make({ target: 2 })
  await pool.tick()
  await pool.tick()
  pool.addReserved({ id: 'PP-R-RES-I1', kind: 'INR', amount: 41.37, bundle: 'I', dueAt: now() + 2 * DAY })
  pool.addReserved({ id: 'PP-R-RES-I2', kind: 'SNAD', amount: 66.12, bundle: 'I', dueAt: now() + 2 * DAY })
  pool.addReserved({ id: 'PP-R-RES-C1', kind: 'INR', amount: 30, bundle: 'C', dueAt: now() + 9 * DAY })
  const first = pool.claim('judge-1')
  assert.deepEqual(first.cases.map((c) => c.id).sort(), ['PP-R-RES-I1', 'PP-R-RES-I2'])
  assert.equal(first.layer, 2)
  assert.equal(first.claimStage, false)
  assert.equal(pool.claim('judge-1').again, true, 'the same visitor gets the same cases back')
  const second = pool.claim('judge-2')
  assert.equal(second.layer, 1, 'live pool next')
  assert.ok(second.cases.every((c) => c.bundle === 'live'))
  const third = pool.claim('judge-3')
  assert.equal(third.claimStage, true, 'only bundle C is left')
  assert.equal(pool.claim('judge-4').layer, 3)
})

test('state survives a restart; a creation interrupted by the restart is not trusted', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'pool-'))
  const file = join(dir, 'pool.json')
  const a = make({ stateFile: file, target: 2 })
  await a.pool.tick()
  a.pool.state.items.push({ id: 'PP-R-HALF-1', kind: 'INR', amount: 1, bundle: 'live', dueAt: a.now() + DAY, status: 'CREATING' })
  a.pool.save()
  const b = make({ stateFile: file, target: 2 })
  assert.equal(b.pool.state.items.length, 2)
  assert.equal(b.pool.state.items.find((i) => i.id === 'PP-R-HALF-1').status, 'RETIRED')
  assert.equal(b.pool.state.items.filter((i) => i.status === 'READY').length, 1)
  writeFileSync(file, 'not json')
  assert.equal(make({ stateFile: file }).pool.state.items.length, 0, 'a corrupt state file starts empty instead of crashing')
  rmSync(dir, { recursive: true })
})

test('the banner always says which path the visitor is on', () => {
  assert.equal(bannerFor({ mode: 'mock', claim: null }).layer, 0)
  assert.equal(bannerFor({ mode: 'sandbox', claim: null }).writes, false)
  assert.equal(bannerFor({ mode: 'sandbox', claim: { layer: 3, cases: [] } }).layer, 3)
  assert.match(bannerFor({ mode: 'sandbox', claim: { layer: 2, claimStage: true } }).text, /already a claim/)
})

test('mock banner says when practice cases were added (REVIEW_2 G11)', () => {
  assert.match(bannerFor({ mode: 'mock', claim: { layer: 1 } }).text, /2 more practice cases/)
  assert.doesNotMatch(bannerFor({ mode: 'mock', claim: null }).text, /practice cases/)
})
