import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { replayTurn, recordTurn, sourceOf, idMap, matches, agentKind, RUNS_DIR } from '../server/agent/replay.js'
import { serverToolSchemas } from '../server/agent/tools.js'

const draftTools = serverToolSchemas().filter((t) => ['get_dispute_detail', 'get_store_order', 'draft_response'].includes(t.name))
const recordedDraft = () => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, fs.readdirSync(RUNS_DIR).find((f) => f.startsWith('drafter-'))), 'utf8'))

test('recorded real runs are in the app and name the model, the backend and the date', () => {
  const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))
  assert.ok(files.some((f) => f.startsWith('lead-')) && files.some((f) => f.startsWith('analyst-')) && files.some((f) => f.startsWith('drafter-')))
  for (const f of files) {
    const run = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'))
    assert.equal(run.model, 'claude-sonnet-5-5')
    assert.match(run.backend, /account/)
    assert.match(run.recordedOn, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(run.steps.every((s) => typeof s.ms === 'number' && Array.isArray(s.content)))
  }
})

test('a turn that matches a recording replays the recorded model output with a recorded-run label', () => {
  const run = recordedDraft()
  const hit = replayTurn({ tools: draftTools, messages: [{ role: 'user', content: [{ type: 'text', text: run.userText }] }] })
  assert.ok(hit)
  assert.equal(hit.message.content.find((b) => b.type === 'tool_use').name, 'get_dispute_detail')
  assert.match(hit.message.model, /^recorded:claude-sonnet-5-5@/)
  assert.equal(sourceOf(hit.message.model, 'mock').label, `Recorded run: Claude Sonnet, ${run.recordedOn}`)
})

test('a different question or different tool results fall back to the stand-in (no replay)', () => {
  const run = recordedDraft()
  assert.equal(replayTurn({ tools: draftTools, messages: [{ role: 'user', content: [{ type: 'text', text: `${run.userText} Also mention shipping.` }] }] }), null)
  const changed = [
    { role: 'user', content: [{ type: 'text', text: run.userText }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_dispute_detail', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ dispute_state: 'RESOLVED' }) }] },
  ]
  assert.equal(replayTurn({ tools: draftTools, messages: changed }), null)
  assert.equal(sourceOf('mock-claude', 'mock').source, 'mock')
  assert.match(sourceOf('mock-claude', 'mock').label, /not a model/)
})

test('ids made in this session replace the recorded ids in replayed tool inputs; ids and times do not break a match', () => {
  const ids = idMap({ comparison_id: 'cmp_old', rows: [{ q: 0.5 }] }, { comparison_id: 'cmp_new', rows: [{ q: 0.5 }] })
  assert.equal(ids.get('cmp_old'), 'cmp_new')
  const then = [{ name: 'compare_acceptance', content: JSON.stringify({ comparison_id: 'cmp_old', due: '2026-11-20T00:00:00Z', total: 84.52 }) }]
  assert.equal(matches([{ name: 'compare_acceptance', content: JSON.stringify({ comparison_id: 'cmp_new', due: '2026-12-20T00:00:00Z', total: 84.52 }) }], then), true)
  assert.equal(matches([{ name: 'compare_acceptance', content: JSON.stringify({ comparison_id: 'cmp_new', total: 99 }) }], then), false)
})

test('recording writes one file per agent conversation, step by step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-rec-'))
  try {
    const params = { tools: draftTools, messages: [{ role: 'user', content: [{ type: 'text', text: 'Draft a send_message for dispute X.' }] }] }
    const run = recordTurn(params, { model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 'a', name: 'get_dispute_detail', input: { dispute_id: 'X' } }] }, 1234, { dir, recordedOn: '2026-11-12' })
    assert.equal(run.agent, agentKind(draftTools))
    assert.equal(run.steps[0].ms, 1234)
    const hit = replayTurn(params, { dir })
    assert.equal(hit.message.content[0].input.dispute_id, 'X')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
