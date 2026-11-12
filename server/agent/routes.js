import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { modelEvents } from './provider.js'
import { anthropicToAgUi, itemsToMessages, agUiToMessages, toAnthropicTools, toAnthropicToolChoice, outputItems } from './agui.js'
import { SERVER_TOOL_NAMES, serverToolSchemas, runServerTool } from './tools.js'
import { ANALYST_PROMPT } from './prompts.js'
import { HttpError, parse } from '../http.js'
import { agentLimiter } from '../demoLimits.js'
import { modes } from '../config.js'
import { sourceOf } from './replay.js'

const MAX_ROUNDS = 6

function openSse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

function abortOnClose(req, res) {
  const ctl = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) ctl.abort()
  })
  return ctl
}

const llmBody = z.object({
  input: z.array(z.any()).max(400),
  instructions: z.string().max(100_000).optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string().optional(), parameters: z.any().optional(), kind: z.string().optional() }).passthrough()).max(60).optional(),
  toolChoice: z.union([z.enum(['auto', 'none', 'required']), z.object({ name: z.string() })]).optional(),
  responseFormat: z.any().optional(),
  model: z.object({ id: z.string(), effort: z.string().optional() }).optional(),
})

/**
 * POST /api/studio/llm: the server half of the Claude adapter for Studio's agent framework (AgLlmAdapter.executeTurn).
 * Body: one AgLlmRequest. Response: server-sent events of AG-UI content events, then one `complete` frame.
 */
export async function studioLlm(req, res) {
  const body = parse(llmBody, req.body)
  const { system, messages } = itemsToMessages(body.input)
  const jsonMode = body.responseFormat?.type === 'json'
  const tools = toAnthropicTools(body.tools)
  if (jsonMode) tools.push({ name: 'respond', description: body.responseFormat.description || 'Return the structured answer.', input_schema: body.responseFormat.schema })
  const params = {
    system: [body.instructions, system].filter(Boolean).join('\n\n') || undefined,
    messages,
    tools: tools.length ? tools : undefined,
    tool_choice: jsonMode ? { type: 'tool', name: 'respond' } : toAnthropicToolChoice(body.toolChoice, tools),
  }
  const send = openSse(res)
  const ctl = abortOnClose(req, res)
  const sink = {}
  try {
    const forceMock = agentLimiter(req)
    let started = false
    for await (const ev of anthropicToAgUi(modelEvents(params, { signal: ctl.signal, forceMock }), sink)) {
      if (jsonMode) continue
      started = true
      send({ kind: 'event', event: ev })
    }
    if (jsonMode) {
      const use = sink.toolUses.find((u) => u.name === 'respond')
      sink.text = JSON.stringify(use?.input ?? {})
      sink.toolUses = []
      const id = `${sink.messageId}_json`
      send({ kind: 'event', event: { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' } })
      send({ kind: 'event', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: sink.text } })
      send({ kind: 'event', event: { type: 'TEXT_MESSAGE_END', messageId: id } })
    }
    void started
    // Which answered this turn: the model, a recorded real run, or the scripted stand-in. The screen shows it.
    send({ kind: 'source', ...sourceOf(sink.model, forceMock ? 'mock' : modes.llm) })
    send({
      kind: 'complete',
      response: {
        id: sink.messageId,
        createdAt: Date.now(),
        status: sink.stopReason === 'max_tokens' ? 'incomplete' : 'completed',
        ...(sink.stopReason === 'max_tokens' ? { incompleteDetails: { reason: 'max_output_tokens' } } : {}),
        output: outputItems(sink),
        model: sink.model,
        usage: { inputTokens: sink.usage?.input_tokens ?? 0, outputTokens: sink.usage?.output_tokens ?? 0 },
      },
    })
  } catch (err) {
    send({ kind: 'error', message: err.name === 'AbortError' ? 'cancelled' : `Model call failed: ${err.message}` })
  }
  res.end()
}

const MAX_THREADS = 20

function saveThread(session, threadId, entry) {
  if (!threadId || !session.agentThreads) return
  const threads = new Map(session.agentThreads)
  threads.delete(threadId)
  threads.set(threadId, entry)
  while (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value)
  session.agentThreads = threads
}

/**
 * Messages for this request. When Studio comes back with the results of the tools a previous request left open, the
 * saved history is continued with those results, so the model still sees its own server tool calls (for example the
 * compare_acceptance call whose comparison_id it passed on). Otherwise Studio's messages are converted as they are.
 */
export function resumeThread(session, input) {
  const fresh = agUiToMessages(input.messages)
  const saved = input.threadId ? session.agentThreads?.get(input.threadId) : null
  if (!saved) return fresh
  const byId = new Map((input.messages || []).filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m]))
  if (!saved.openIds.every((id) => byId.has(id))) return fresh
  const results = saved.openIds.map((id) => {
    const m = byId.get(id)
    return { type: 'tool_result', tool_use_id: id, content: m.error ? `Error: ${m.error}` : String(m.content), ...(m.error ? { is_error: true } : {}) }
  })
  const threads = new Map(session.agentThreads)
  threads.delete(input.threadId)
  session.agentThreads = threads
  return { system: saved.system, messages: [...saved.messages, { role: 'user', content: results }] }
}

const runBody = z.object({
  input: z.object({ messages: z.array(z.any()).max(400), tools: z.array(z.any()).max(60).optional(), threadId: z.string().optional(), runId: z.string().optional() }).passthrough(),
  instructions: z.string().max(100_000).optional(),
})

/**
 * POST /api/agent/run: the dispute-analyst loop. Claude runs here with the PayPal read tools and the plan calculators.
 * Tools Studio advertises (view_schema, execute_query, add_widget, show_scenario_comparison, complete_task) are left
 * unresolved in the stream so Studio executes them in the browser and calls this endpoint again (clientToolRunner).
 */
export async function agentRun(req, res) {
  const body = parse(runBody, req.body)
  const session = req.session
  const send = openSse(res)
  const ctl = abortOnClose(req, res)
  const emit = (event) => send({ kind: 'event', event })
  try {
    const forceMock = agentLimiter(req)
    const clientSchemas = (body.input.tools || []).filter((t) => !SERVER_TOOL_NAMES.has(t.name))
    const tools = [...serverToolSchemas(), ...toAnthropicTools(clientSchemas)]
    const clientNames = new Set(clientSchemas.map((t) => t.name))
    const { system, messages } = resumeThread(session, body.input)
    const systemText = [ANALYST_PROMPT, body.instructions, system].filter(Boolean).join('\n\n')
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const sink = {}
      for await (const ev of anthropicToAgUi(modelEvents({ system: systemText, messages, tools, tool_choice: { type: 'auto' } }, { signal: ctl.signal, forceMock }), sink)) emit(ev)
      messages.push({ role: 'assistant', content: sink.content })
      send({ kind: 'source', ...sourceOf(sink.model, forceMock ? 'mock' : modes.llm) })
      const calls = sink.toolUses
      if (!calls.length) break
      const results = []
      let waitingOnStudio = false
      for (const call of calls) {
        if (clientNames.has(call.name)) {
          waitingOnStudio = true
          continue
        }
        const out = await runServerTool(session, call.name, call.input)
        const content = JSON.stringify(out.ok ? out.result : { error: out.error })
        emit({ type: 'TOOL_CALL_RESULT', messageId: `res_${randomUUID().slice(0, 8)}`, toolCallId: call.id, content, role: 'tool' })
        results.push({ type: 'tool_result', tool_use_id: call.id, content, ...(out.ok ? {} : { is_error: true }) })
      }
      // A client tool is still open: end this request. Studio runs it and calls again with its results. Studio's history
      // keeps only the calls it ran, so the server keeps this run's full history (server tool calls and results) for that call.
      if (waitingOnStudio) {
        saveThread(session, body.input.threadId, { system, messages: [...messages], openIds: calls.filter((c) => clientNames.has(c.name)).map((c) => c.id) })
        break
      }
      messages.push({ role: 'user', content: results })
    }
  } catch (err) {
    send({ kind: 'event', event: { type: 'RUN_ERROR', message: err.name === 'AbortError' ? 'cancelled' : `Agent run failed: ${err.message}` } })
  }
  res.end()
}

export { HttpError }
