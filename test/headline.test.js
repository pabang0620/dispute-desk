import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../server/session.js'
import { buildSnapshot, loadQueue, asOfDate } from '../server/snapshot.js'
import { buildPlanView } from '../server/domain/planView.js'

// The headline must say what the recommended plan does with the offered case, never a fixed "refunding".
async function viewWith(overrides) {
  const s = createSession()
  const { queue } = await loadQueue(s)
  return buildPlanView({ plan: { ...s.plan, ...overrides }, ledger: s.ledger, queue, asOf: asOfDate() })
}

const total = (view, id) => view.plans.find((p) => p.id === id).total
const pick = (view, label) => view.recommended.choices[label].action

test('planner headline: offer looks cheaper per case, refund is cheaper for the account, from the same plan numbers', async () => {
  const { view } = await buildSnapshot(createSession())
  const h = view.headline
  assert.equal(h.account, Math.round((total(view, 'X') - view.recommended.total) * 100) / 100)
  assert.ok(h.perCase > 0 && h.account > 0)
  assert.equal(pick(view, 'A'), 'refund')
  assert.equal(h.action, 'refund')
  assert.match(h.text, /^Per case, the \$20 offer on A looks \$\d+\.\d\d cheaper\. For the account, refunding A is \$\d+\.\d\d cheaper and keeps you at \d\.\d\d%\.$/)
})

test('headline names fighting when the recommended plan fights the offered case', async () => {
  // High win chance, low acceptance, December only: case by case still offers on A, the account plan fights it.
  const view = await viewWith({ p: 0.8, q: 0.05, period: 'decOnly' })
  assert.equal(view.cases.find((c) => c.label === 'A').preset.action, 'offer')
  assert.equal(pick(view, 'A'), 'fight')
  const h = view.headline
  assert.equal(h.action, 'fight')
  assert.equal(h.account, Math.round((total(view, 'X') - view.recommended.total) * 100) / 100)
  assert.doesNotMatch(h.text, /refunding A/)
  assert.match(h.text, /looks \$\d+\.\d\d cheaper than refunding\. For the account, fighting A is \$\d+\.\d\d cheaper/)
  // This plan can cross 1.5%, so the sentence must not promise the seller stays under it.
  assert.ok(view.plans.find((p) => p.description === view.recommended.text).pHighVolume > 0)
  assert.match(h.text, /can still reach \d\.\d\d%\.$/)
})

test('no headline when the recommended plan keeps the offer', async () => {
  const view = await viewWith({ q: 0.8 })
  assert.equal(pick(view, 'A'), 'offer')
  assert.equal(view.headline, null)
})

test('no headline when case by case does not offer at all', async () => {
  const view = await viewWith({ p: 0, q: 0 })
  assert.ok(view.cases.every((c) => c.preset.action !== 'offer'))
  assert.equal(view.headline, null)
})

test('headline action always matches the recommended choice across the assumption grid', async () => {
  let shown = 0
  for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    for (const q of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
      for (const period of ['window', 'decOnly']) {
        const view = await viewWith({ p, q, period })
        if (!view.headline) continue
        shown += 1
        const label = view.headline.offerLabel
        assert.equal(view.headline.action, pick(view, label), `p=${p} q=${q} ${period}`)
        assert.match(view.headline.text, new RegExp(`${view.headline.action === 'refund' ? 'refunding' : 'fighting'} ${label} is`))
      }
    }
  }
  assert.ok(shown > 0)
})
