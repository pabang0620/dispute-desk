// This model rejects forced tool_choice ({type:'tool'} and {type:'any'} answer HTTP 400). Every request goes through
// here: the forced choice becomes {type:'auto'} plus a system instruction, and the reply is checked afterwards.

export const NO_TOOL_REASON = 'model did not call the required tool'

/** The tool the caller forced: { name } for a named tool, { any: true } for any tool, or null. */
export function requiredOf(choice) {
  if (choice?.type === 'tool' && choice.name) return { name: choice.name }
  if (choice?.type === 'any') return { any: true }
  return null
}

export function instructionFor(required) {
  return required.name ? `You must answer by calling the tool ${required.name}.` : 'You must call one of the tools in this turn.'
}

const systemText = (system) => (Array.isArray(system) ? system.map((b) => b.text ?? b).join('\n\n') : system || '')

/** Request params that never carry a forced tool_choice. `repeat` states the instruction a second time for the retry. */
export function safeParams(params, required, repeat = false) {
  const { tool_choice: choice, ...rest } = params
  const hasTools = Boolean(rest.tools?.length)
  const next = hasTools ? { ...rest, tool_choice: { type: 'auto' } } : rest
  if (!required || !hasTools) return next
  const note = instructionFor(required)
  const system = [systemText(params.system), repeat ? `${note} ${note}` : note].filter(Boolean).join('\n\n')
  return { ...next, system }
}

/** True when the buffered stream events contain a call to the required tool. */
export function calledRequired(events, required) {
  return events.some((ev) => ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && (required.any || ev.content_block.name === required.name))
}
