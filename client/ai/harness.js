import { createAiHarness, directLlmRunner, clientToolRunner } from 'ag-studio'
import { claudeAdapter } from './claudeAdapter.js'
import { readFrames } from './sse.js'
import { saveScenarios, noteAiSource } from '../store.js'
import { applyScenarioComparison } from '../studio/scenarioWidget.js'

const adapter = claudeAdapter()

export const PROMPT_STARTERS = [
  { label: 'Buyer accepts $20?', prompt: 'What if the buyer is likely to accept $20?' },
  { label: 'Explain the plan', prompt: 'Explain the recommended plan and which assumptions it depends on.' },
  { label: 'What tables exist?', prompt: 'What tables and fields does this dashboard have available?' },
]

export const MODELS = [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }]

const ANALYST_DESCRIPTION =
  'Dispute analyst for the PayPal seller: answers what-if questions about buyer acceptance, win rates and the dispute-rate plan using the server calculators, and can add a comparison widget to the dashboard. Delegate any question about disputes, offers, refunds, fees or the 1.5% line to it.'

// dispute-analyst: Claude loop on our server; Studio executes the tools the stream leaves open (clientToolRunner).
function disputeAnalyst() {
  return clientToolRunner({
    id: 'dispute-analyst',
    name: 'Dispute analyst',
    description: ANALYST_DESCRIPTION,
    instructions: () => 'You work inside the Dispute Desk dashboard. The tables are disputes, outcomes, ratePlan, gauges and scenarios.',
    tools: (ctx) => {
      const { studio } = ctx
      const show = ctx.api.defineAiTool({
        name: 'show_scenario_comparison',
        description: 'Show a compare_acceptance result as a comparison widget on the dashboard. Pass only the comparison_id that compare_acceptance returned; the numbers are filled in by the server from its own calculation.',
        params: (s) =>
          s.object({
            comparison_id: s.string({ description: 'The comparison_id returned by compare_acceptance.' }),
            title: s.string({ description: 'Optional widget title.' }).optional(),
          }),
        execute: async (args, c) => {
          let saved
          try {
            saved = await saveScenarios(args.comparison_id)
          } catch (err) {
            return c.error(`${err.message} Run compare_acceptance first and use the comparison_id it returns.`)
          }
          const placed = applyScenarioComparison(ctx.api, args.title || saved?.title)
          return c.success(placed ? 'Comparison widget added to the dashboard.' : 'Comparison rows replaced; the widget already exists.', { rows: saved?.scenarios?.length ?? 0 })
        },
      })
      return [studio.viewSchema(), studio.executeQuery(), studio.addWidget(), show]
    },
    run: (input, ctx) => analystStream(input, ctx),
  })
}

async function* analystStream(input, ctx) {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    signal: ctx.signal,
    body: JSON.stringify({
      input: { threadId: input.threadId, runId: input.runId, messages: input.messages, tools: input.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) },
      instructions: ctx.instructions(),
    }),
  })
  for await (const frame of readFrames(res, ctx.signal)) {
    if (frame.kind === 'event') yield frame.event
    else if (frame.kind === 'source') noteAiSource(frame)
  }
}

/**
 * Studio's own five agents run on Claude through the adapter; our dispute-analyst joins the roster and the lead
 * can delegate to it (tools.delegateTo), so a chat question travels lead -> dispute-analyst -> server calculators -> widget.
 */
// VITE_ADAPTER_LEVEL=2 is fallback level 2 (PLAN 8-4): drop Studio's built-in agents and talk to the dispute-analyst alone.
const LEVEL = Number(import.meta.env.VITE_ADAPTER_LEVEL || 0)

export function buildHarness(api) {
  return createAiHarness(api, ({ builtIn }) => {
    if (LEVEL >= 2) return { agents: [disputeAnalyst()], primary: 'dispute-analyst', models: MODELS, promptStarters: PROMPT_STARTERS }
    const builtInRunners = Object.values(builtIn).map((definition) => {
      if (definition.id !== 'lead') return directLlmRunner({ ...definition, adapter })
      const baseTools = definition.tools
      const baseInstructions = definition.instructions
      return directLlmRunner({
        ...definition,
        adapter,
        instructions: (ctx, params) =>
          `${baseInstructions ? baseInstructions(ctx, params) : ''}\n\nQuestions about disputes, refunds, partial offers, fees, acceptance or win probability, or the 1.5% dispute-rate line belong to the dispute-analyst agent: delegate them with delegate_to. Do not invent numbers. After a delegation, do not repeat the analyst's answer: reply with one short sentence.`,
        tools: (ctx, params) => {
          const base = baseTools ? baseTools(ctx, params) : []
          return [...base.filter((t) => t.name !== 'delegate_to'), ctx.tools.delegateTo(['planning', 'data', 'page', 'widget', 'dispute-analyst'])]
        },
      })
    })
    return { agents: [...builtInRunners, disputeAnalyst()], primary: 'lead', models: MODELS, promptStarters: PROMPT_STARTERS }
  })
}
