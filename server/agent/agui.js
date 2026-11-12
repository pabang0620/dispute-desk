import { randomUUID } from 'node:crypto'

// Conversion between AG Studio's AG-UI vocabulary and the Anthropic Messages API.

const NAME_RE = /[^a-zA-Z0-9_-]/g

export function toAnthropicTools(schemas = []) {
  return schemas.map((t) => ({
    name: t.name.replace(NAME_RE, '_').slice(0, 64),
    description: t.description || t.name,
    input_schema: normalizeSchema(t.parameters),
  }))
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const { $schema, ...rest } = schema
  return rest.type === 'object' ? rest : { type: 'object', properties: {}, ...rest }
}

export function toAnthropicToolChoice(choice, tools) {
  if (!tools.length || choice === 'none') return undefined
  if (choice === 'required') return { type: 'any' }
  if (choice && typeof choice === 'object') return { type: 'tool', name: choice.name }
  return { type: 'auto' }
}

function parseArgs(text) {
  try {
    const v = JSON.parse(text || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// Studio conversation items (Responses-style) -> Anthropic messages.
export function itemsToMessages(items = []) {
  const system = []
  const raw = []
  for (const item of items) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      if (item.role === 'system') system.push(text)
      else raw.push({ role: 'user', blocks: [{ type: 'text', text }] })
    } else if (item.type === 'message' && item.kind === 'output') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal || '')).join('')
      if (text) raw.push({ role: 'assistant', blocks: [{ type: 'text', text }] })
    } else if (item.type === 'function_call') {
      raw.push({ role: 'assistant', blocks: [{ type: 'tool_use', id: item.callId, name: item.name.replace(NAME_RE, '_'), input: parseArgs(item.arguments) }] })
      if (item.result !== undefined) raw.push({ role: 'user', blocks: [{ type: 'tool_result', tool_use_id: item.callId, content: String(item.result) }] })
    } else if (item.type === 'function_call_output') {
      raw.push({ role: 'user', blocks: [{ type: 'tool_result', tool_use_id: item.callId, content: String(item.output) }] })
    }
  }
  return { system: system.join('\n\n'), messages: repair(raw) }
}

// AG-UI run messages -> Anthropic messages.
export function agUiToMessages(messages = []) {
  const system = []
  const raw = []
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') system.push(m.content)
    else if (m.role === 'user') raw.push({ role: 'user', blocks: [{ type: 'text', text: m.content }] })
    else if (m.role === 'assistant') {
      const blocks = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls || []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name.replace(NAME_RE, '_'), input: parseArgs(tc.function.arguments) })
      if (blocks.length) raw.push({ role: 'assistant', blocks })
    } else if (m.role === 'tool') {
      raw.push({ role: 'user', blocks: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.error ? `Error: ${m.error}` : String(m.content), ...(m.error ? { is_error: true } : {}) }] })
    }
  }
  return { system: system.join('\n\n'), messages: repair(raw) }
}

// Merge same-role neighbours, make every tool_use answered, and start with a user turn (the API requires all three).
function repair(raw) {
  const merged = []
  for (const m of raw) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) last.blocks.push(...m.blocks)
    else merged.push({ role: m.role, blocks: [...m.blocks] })
  }
  const out = []
  for (let i = 0; i < merged.length; i += 1) {
    const m = merged[i]
    if (m.role === 'assistant') {
      const uses = m.blocks.filter((b) => b.type === 'tool_use')
      const next = merged[i + 1]
      const answered = new Set((next?.role === 'user' ? next.blocks : []).filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id))
      const missing = uses.filter((u) => !answered.has(u.id))
      out.push(m)
      if (missing.length) {
        const fill = missing.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'No result was recorded for this call.', is_error: true }))
        if (next?.role === 'user') next.blocks = [...fill, ...next.blocks]
        else merged.splice(i + 1, 0, { role: 'user', blocks: fill })
      }
    } else {
      // tool_results must lead a user turn and reference an existing tool_use
      const prev = out[out.length - 1]
      const known = new Set((prev?.role === 'assistant' ? prev.blocks : []).filter((b) => b.type === 'tool_use').map((b) => b.id))
      const blocks = m.blocks.filter((b) => b.type !== 'tool_result' || known.has(b.tool_use_id))
      blocks.sort((a, b) => (a.type === 'tool_result' ? -1 : 0) - (b.type === 'tool_result' ? -1 : 0))
      if (blocks.length) out.push({ role: 'user', blocks })
    }
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out.map((m) => ({ role: m.role, content: m.blocks }))
}

/**
 * Anthropic stream events -> AG-UI events. `sink` receives the consolidated output items and stop reason once the
 * turn ends. Tool calls stream as TOOL_CALL_START / TOOL_CALL_ARGS (JSON deltas) / TOOL_CALL_END.
 */
export async function* anthropicToAgUi(events, sink = {}) {
  const blocks = new Map()
  let messageId = `msg_${randomUUID().slice(0, 8)}`
  let stopReason = null
  let usage = {}
  let model
  for await (const ev of events) {
    if (ev.type === 'message_start') {
      messageId = ev.message.id || messageId
      model = ev.message.model
      usage = { ...usage, ...ev.message.usage }
    } else if (ev.type === 'content_block_start') {
      const b = ev.content_block
      if (b.type === 'text') {
        const id = `${messageId}_${ev.index}`
        blocks.set(ev.index, { type: 'text', id, text: '' })
        yield { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }
      } else if (b.type === 'tool_use') {
        blocks.set(ev.index, { type: 'tool_use', id: b.id, name: b.name, json: '' })
        yield { type: 'TOOL_CALL_START', toolCallId: b.id, toolCallName: b.name, parentMessageId: messageId }
      }
    } else if (ev.type === 'content_block_delta') {
      const blk = blocks.get(ev.index)
      if (!blk) continue
      if (ev.delta.type === 'text_delta') {
        blk.text += ev.delta.text
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId: blk.id, delta: ev.delta.text }
      } else if (ev.delta.type === 'input_json_delta') {
        blk.json += ev.delta.partial_json
        yield { type: 'TOOL_CALL_ARGS', toolCallId: blk.id, delta: ev.delta.partial_json }
      }
    } else if (ev.type === 'content_block_stop') {
      const blk = blocks.get(ev.index)
      if (!blk) continue
      blk.done = true
      yield blk.type === 'text' ? { type: 'TEXT_MESSAGE_END', messageId: blk.id } : { type: 'TOOL_CALL_END', toolCallId: blk.id }
    } else if (ev.type === 'message_delta') {
      stopReason = ev.delta?.stop_reason ?? stopReason
      usage = { ...usage, ...ev.usage }
    }
  }
  const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
  sink.messageId = messageId
  sink.stopReason = stopReason
  sink.usage = usage
  sink.model = model
  sink.toolUses = ordered.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: parseArgs(b.json) }))
  sink.text = ordered.filter((b) => b.type === 'text').map((b) => b.text).join('')
  sink.content = ordered.map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: parseArgs(b.json) }))
}

/** Output items in the shape of AgLlmResponse.output. */
export function outputItems(sink) {
  const items = []
  if (sink.text) {
    items.push({ id: sink.messageId, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: sink.text, annotations: [] }] })
  }
  for (const u of sink.toolUses) {
    items.push({ id: `fc_${u.id}`, kind: 'output', type: 'function_call', callId: u.id, name: u.name, arguments: JSON.stringify(u.input), status: 'completed' })
  }
  return items
}
