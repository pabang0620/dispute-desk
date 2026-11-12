import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { mockMessage } from './mockClaude.js'
import { accountMessage } from './accountModel.js'
import { replayTurn, recordTurn } from './replay.js'
import { requiredOf, safeParams, calledRequired, NO_TOOL_REASON } from './toolChoice.js'

// One place that talks to a model. With ANTHROPIC_API_KEY it calls the Anthropic Messages API; with LLM_BACKEND=account
// it runs one turn through the local Claude Code login (accountModel.js); without either it
// uses mockClaude, which returns Anthropic-shaped messages. Everything above this file is identical in both modes.
let client = null

/** Tests swap in a fake model client. */
export function setClientForTests(fake) {
  client = fake
}

function getClient() {
  client ||= new Anthropic({ apiKey: config.anthropicKey })
  return client
}

// Level 1 fallback (PLAN 8-4): STREAM_MODEL=0 asks for the whole message and replays it as events.
const STREAM = process.env.STREAM_MODEL !== '0'
// Replay recorded real runs without a model (tests turn it off with LLM_REPLAY=0). Recording is opt-in on the account backend.
const REPLAY = process.env.LLM_REPLAY !== '0'
const RECORD = process.env.RECORD_LLM_RUNS === '1'
const REPLAY_PAUSE_MS = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Yields Anthropic raw stream events (message_start, content_block_start, content_block_delta, content_block_stop,
 * message_delta, message_stop) for one model turn.
 */
export async function* modelEvents(params, { signal, forceMock = false, meta = {} } = {}) {
  const required = params.tools?.length ? requiredOf(params.tool_choice) : null
  if (!required || forceMock || config.llmBackend === 'mock') {
    yield* rawEvents(safeParams(params, required), { signal, forceMock, meta })
    return
  }
  // A required tool: buffer the turn, check the tool was called, retry once with the instruction repeated, then fall back.
  for (const repeat of [false, true]) {
    const events = []
    for await (const ev of rawEvents(safeParams(params, required, repeat), { signal, forceMock, meta })) events.push(ev)
    if (meta.fallbackReason || calledRequired(events, required)) {
      yield* events
      return
    }
  }
  meta.fallbackReason = NO_TOOL_REASON
  yield* offlineTurn(params)
}

async function* rawEvents(params, { signal, forceMock = false, meta = {} } = {}) {
  if (forceMock || config.llmBackend === 'mock') {
    yield* offlineTurn(params)
    return
  }
  if (config.llmBackend === 'account') {
    const started = Date.now()
    const message = await accountMessage(params, { signal })
    if (RECORD) recordTurn(params, message, Date.now() - started)
    yield* syntheticEvents(message)
    return
  }
  if (config.llmBackend === 'api') {
    yield* liveTurn(params, { signal, meta })
    return
  }
  const body = { model: config.anthropicModel, max_tokens: 4096, ...params }
  if (STREAM) {
    const stream = await getClient().messages.create({ ...body, stream: true }, { signal })
    for await (const ev of stream) yield ev
    return
  }
  const message = await getClient().messages.create(body, { signal })
  yield* syntheticEvents(message)
}

async function* offlineTurn(params) {
  const hit = REPLAY ? replayTurn(params) : null
  if (hit) {
    await sleep(Math.min(hit.ms || 0, REPLAY_PAUSE_MS))
    yield* syntheticEvents(hit.message)
    return
  }
  yield* syntheticEvents(await mockMessage(params))
}

export const LIVE_ERROR_REASON = 'live API unavailable'
const LIVE_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60_000)

/**
 * One turn on the Anthropic API. Any API failure (network, 4xx/5xx, timeout, credit) before the answer starts is
 * replaced by the recorded run or the stand-in, and meta.fallbackReason tells the caller. The raw error is never passed on.
 */
async function* liveTurn(params, { signal, meta }) {
  const body = { model: config.anthropicModel, max_tokens: 4096, ...params }
  const options = { signal, timeout: LIVE_TIMEOUT_MS, maxRetries: 1 }
  let started = false
  try {
    if (STREAM) {
      const stream = await getClient().messages.create({ ...body, stream: true }, options)
      for await (const ev of stream) {
        started = true
        yield ev
      }
    } else {
      const message = await getClient().messages.create(body, options)
      started = true
      yield* syntheticEvents(message)
    }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err
    if (started) throw new Error('The live answer was cut off. Run the action again to use the recorded run.')
    meta.fallbackReason = LIVE_ERROR_REASON
    yield* offlineTurn(params)
  }
}

const chunk = (text, size) => (text.length ? text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) : [])

/** Replay a complete Message as the stream events the API would have sent. */
export async function* syntheticEvents(message) {
  yield { type: 'message_start', message: { ...message, content: [], stop_reason: null } }
  let index = 0
  for (const block of message.content) {
    if (block.type === 'text') {
      yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
      for (const part of chunk(block.text, 28)) yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } }
    } else if (block.type === 'tool_use') {
      yield { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }
      const json = JSON.stringify(block.input ?? {})
      for (const part of chunk(json, 40)) yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } }
    } else {
      continue
    }
    yield { type: 'content_block_stop', index }
    index += 1
  }
  yield { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage || { output_tokens: 0 } }
  yield { type: 'message_stop' }
}
