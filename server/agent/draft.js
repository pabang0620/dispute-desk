import { modelEvents } from './provider.js'
import { anthropicToAgUi } from './agui.js'
import { serverToolSchemas, runServerTool } from './tools.js'
import { ANALYST_PROMPT } from './prompts.js'
import { HttpError } from '../http.js'

const MAX_ROUNDS = 6
const DRAFT_TOOLS = new Set(['get_dispute_detail', 'get_store_order', 'draft_response'])
const DRAFT_ACTIONS = ['send_message', 'provide_evidence', 'escalate']

const TASK = (disputeId, action) =>
  `Draft a ${action} for dispute ${disputeId}. First read the dispute with get_dispute_detail and the demo store order with get_store_order. ` +
  `Use the store order id from the checklist item "order" (its source id looks like order:JH-1042, so the order id is JH-1042, not the dispute id). Then call draft_response with action "${action}", the checklist items exactly as get_dispute_detail returned them (id, present, source_id) and your text. ` +
  'Write the text only from facts in those records. The only dollar amounts you may use are the disputed amount and the offer amount the tools returned; the server rejects any other amount. ' +
  'If draft_response returns an error, fix the text and call it again. Nothing is sent: the seller reviews and approves the card.'

/**
 * "Draft with Claude": the dispute-analyst reads the dispute and the store order, then creates an approval card with
 * its draft through draft_response. The same server tools and the same amount check as in the chat. Returns the card id
 * and the tool calls Claude made so the screen can show the work.
 */
export async function draftWithClaude(session, { disputeId, action, signal, forceMock, meta = {} }) {
  if (!DRAFT_ACTIONS.includes(action)) throw new HttpError(400, `Drafting supports ${DRAFT_ACTIONS.join(', ')}`)
  const tools = serverToolSchemas().filter((t) => DRAFT_TOOLS.has(t.name))
  const messages = [{ role: 'user', content: [{ type: 'text', text: TASK(disputeId, action) }] }]
  const steps = []
  let model = null
  let lastError = null
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const sink = {}
    const events = modelEvents({ system: ANALYST_PROMPT, messages, tools, tool_choice: { type: 'auto' } }, { signal, forceMock: forceMock || Boolean(meta.fallbackReason), meta })
    for await (const ev of anthropicToAgUi(events, sink)) void ev
    model = sink.model
    messages.push({ role: 'assistant', content: sink.content })
    if (!sink.toolUses.length) break
    const results = []
    for (const call of sink.toolUses) {
      const out = DRAFT_TOOLS.has(call.name) ? await runServerTool(session, call.name, call.input) : { ok: false, error: `Tool ${call.name} is not available for drafting.` }
      steps.push({ tool: call.name, ok: out.ok, ...(out.ok ? {} : { error: out.error }) })
      if (!out.ok) lastError = out.error
      if (out.ok && call.name === 'draft_response') return { cardId: out.result.card_id, steps, model, summary: sink.text || null }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out.ok ? out.result : { error: out.error }), ...(out.ok ? {} : { is_error: true }) })
    }
    messages.push({ role: 'user', content: results })
  }
  throw new HttpError(422, `Claude did not produce a draft${lastError ? `: ${lastError}` : '.'}`)
}
