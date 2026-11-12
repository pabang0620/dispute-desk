import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { currentTurn } from './mockClaude.js'

// Recorded real model runs (builtin/recorded-runs/*.json). Each file holds one agent conversation recorded through
// LLM_BACKEND=account: the model's content at every step, the tool results it had seen at that step, and the time.
// Without a model, a turn whose question and server tool results match a recording replays the recorded model output,
// while every tool still runs live on the server. Anything that differs falls back to the scripted stand-in.
export const RUNS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../builtin/recorded-runs')
export const RECORDED_MODEL_PREFIX = 'recorded:'

const ID_KEY = /(^id$|_id$|Id$|^hash_prefix$|^token$)/
const TIME_KEY = /(date|time|remaining|^due$|deadline)/i
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/

export function agentKind(tools = []) {
  const names = new Set(tools.map((t) => t.name))
  if (names.has('compare_acceptance')) return 'analyst'
  if (names.has('draft_response')) return 'drafter'
  if (names.has('delegate_to')) return 'lead'
  return `studio-${createHash('sha256').update([...names].sort().join(',')).digest('hex').slice(0, 6)}`
}

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim()

export function runKey(kind, userText) {
  return `${kind}-${createHash('sha256').update(`${kind}\n${squash(userText)}`).digest('hex').slice(0, 10)}`
}

function stepOf(messages = []) {
  let start = 0
  messages.forEach((m, i) => {
    const hasText = Array.isArray(m.content) ? m.content.some((b) => b.type === 'text') : typeof m.content === 'string'
    if (m.role === 'user' && hasText) start = i
  })
  return messages.slice(start).filter((m) => m.role === 'assistant').length
}

const parseJson = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** Tool result without ids and timestamps, so a fresh session with the same state compares equal. */
export function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !ID_KEY.test(k) && !TIME_KEY.test(k)).map(([k, v]) => [k, normalize(v)]))
  }
  if (typeof value === 'string' && ISO_TIME.test(value)) return '<time>'
  return value
}

/** Pairs of recorded id -> current id, found at the same place in the recorded and the current tool result. */
export function idMap(recorded, current, out = new Map()) {
  if (Array.isArray(recorded) && Array.isArray(current)) {
    recorded.forEach((v, i) => idMap(v, current[i], out))
  } else if (recorded && current && typeof recorded === 'object' && typeof current === 'object') {
    for (const [k, v] of Object.entries(recorded)) {
      if (ID_KEY.test(k) && typeof v === 'string' && typeof current[k] === 'string' && v !== current[k]) out.set(v, current[k])
      else idMap(v, current[k], out)
    }
  }
  return out
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Does what the model sees now match what it saw when the run was recorded? Every tool result (server calculators and
 * Studio tools such as delegate_to, whose result is the analyst's answer) must be equal apart from ids and timestamps.
 */
export function matches(seenNow, seenThen) {
  if (seenNow.length !== seenThen.length) return false
  return seenNow.every((r, i) => {
    const t = seenThen[i]
    if (r.name !== t.name || Boolean(r.isError) !== Boolean(t.isError)) return false
    return sameJson(normalize(parseJson(r.content)), normalize(parseJson(t.content)))
  })
}

function substitute(input, ids) {
  let json = JSON.stringify(input ?? {})
  for (const [from, to] of ids) json = json.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1))
  return JSON.parse(json)
}

const cache = new Map()
function loadRun(dir, key) {
  const file = path.join(dir, `${key}.json`)
  if (!cache.has(file)) cache.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
  return cache.get(file)
}

export function clearReplayCache() {
  cache.clear()
}

/** The recorded model message for this turn, or null when no recording matches. */
export function replayTurn(params, { dir = RUNS_DIR } = {}) {
  const kind = agentKind(params.tools)
  const turn = currentTurn(params.messages)
  const run = loadRun(dir, runKey(kind, turn.userText))
  const step = run?.steps?.[stepOf(params.messages)]
  if (!step || !matches(turn.results, step.seen)) return null
  const ids = new Map()
  turn.results.forEach((r, i) => idMap(parseJson(step.seen[i].content), parseJson(r.content), ids))
  const content = step.content.map((b) => (b.type === 'tool_use' ? { ...b, id: `toolu_rec_${randomUUID().slice(0, 8)}`, input: substitute(b.input, ids) } : b))
  return {
    message: { id: `msg_rec_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: `${RECORDED_MODEL_PREFIX}${run.model}@${run.recordedOn}`, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } },
    ms: step.ms,
    run,
  }
}

/** Saves one real model turn (LLM_BACKEND=account with RECORD_LLM_RUNS=1). Re-running a step overwrites it. */
export function recordTurn(params, message, ms, { dir = RUNS_DIR, recordedOn = new Date().toISOString().slice(0, 10) } = {}) {
  const kind = agentKind(params.tools)
  const turn = currentTurn(params.messages)
  const key = runKey(kind, turn.userText)
  const file = path.join(dir, `${key}.json`)
  fs.mkdirSync(dir, { recursive: true })
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  const step = stepOf(params.messages)
  const entry = { step, seen: turn.results, content: message.content, ms }
  const steps = (prior?.steps || []).slice(0, step)
  steps[step] = entry
  const run = { key, agent: kind, model: message.model, backend: 'account (Claude Agent SDK, local Claude Code login)', recordedOn, userText: turn.userText, tools: (params.tools || []).map((t) => t.name), steps }
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`)
  cache.delete(file)
  return run
}

/** Label for a model id: the recorded-run label names the real model and the recording date. */
export function sourceOf(model, backend, reason = '') {
  const why = reason ? ` (${reason})` : ''
  if (typeof model === 'string' && model.startsWith(RECORDED_MODEL_PREFIX)) {
    const date = model.split('@')[1] || ''
    return { source: 'recorded', label: `Recorded run: Claude Sonnet, ${date}${why}` }
  }
  if (backend === 'account') return { source: 'account', label: 'Claude Sonnet (local account)' }
  if (backend === 'live') return { source: 'live', label: 'Anthropic API' }
  return { source: 'mock', label: `Rule-based stand-in (scripted, not a model)${why}` }
}

const AGENT_ORDER = { lead: 0, analyst: 1, drafter: 2 }
const AGENT_NAMES = { lead: 'Studio lead agent', analyst: 'dispute-analyst agent', drafter: 'Draft with Claude' }

/** Short summary of every recorded run for the screen: who, the question, tool calls in order, model time. */
export function listRecordedAiRuns(dir = RUNS_DIR) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => (AGENT_ORDER[a.agent] ?? 9) - (AGENT_ORDER[b.agent] ?? 9) || a.userText.localeCompare(b.userText))
    .map((r) => ({
      key: r.key,
      agent: AGENT_NAMES[r.agent] || r.agent,
      label: `Recorded run: Claude Sonnet, ${r.recordedOn}`,
      question: squash(r.userText).slice(0, 160),
      toolCalls: r.steps.flatMap((st) => st.content.filter((b) => b.type === 'tool_use').map((b) => b.name)),
      finalText: squash(r.steps.at(-1)?.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ')).slice(0, 300),
      seconds: Math.round(r.steps.reduce((sum, st) => sum + (st.ms || 0), 0) / 100) / 10,
    }))
}
