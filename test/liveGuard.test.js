import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveGuard } from '../server/liveGuard.js'
import { sourceOf } from '../server/agent/replay.js'

test('live guard: per-IP hourly cap releases after the hour (fake clock)', () => {
  let t = Date.UTC(2026, 10, 13, 10, 0, 0)
  const guard = createLiveGuard({ perIpHour: 2, perDay: 100, now: () => t })
  assert.equal(guard.tryAcquire('1.1.1.1'), true)
  assert.equal(guard.tryAcquire('1.1.1.1'), true)
  assert.equal(guard.tryAcquire('1.1.1.1'), false)
  assert.equal(guard.tryAcquire('2.2.2.2'), true)
  t += 3_600_001
  assert.equal(guard.tryAcquire('1.1.1.1'), true)
})

test('live guard: per-day cap covers all IPs and resets the next day', () => {
  let t = Date.UTC(2026, 10, 13, 10, 0, 0)
  const guard = createLiveGuard({ perIpHour: 10, perDay: 3, now: () => t })
  for (const ip of ['a', 'b', 'c']) assert.equal(guard.tryAcquire(ip), true)
  assert.equal(guard.tryAcquire('d'), false)
  t += 24 * 3_600_000
  assert.equal(guard.tryAcquire('d'), true)
})

test('source labels carry the honest reason', () => {
  assert.match(sourceOf('mock', 'mock', 'live limit reached').label, /^Rule-based stand-in.*\(live limit reached\)$/)
  assert.match(sourceOf('recorded:x@2026-11-12', 'live', 'live API unavailable').label, /^Recorded run.*\(live API unavailable\)$/)
})
