import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'

// Local development only (LLM_BACKEND=account): one model turn through the Claude Agent SDK, which uses the developer's
// Claude Code login instead of an API key. It returns an Anthropic-shaped Message, so everything above provider.js
// (AG-UI conversion, the server tool loop, Studio's tools) is identical to the API path.
// The SDK runs its own agent loop, so each call is capped at one turn: tools are exposed with stub handlers, and
// the tool calls the model asks for are read from the assistant message and handed back to our own loop.
const SERVER = 'dd'
const PREFIX = `mcp__${SERVER}__`

export const ACCOUNT_LABEL = 'Claude Sonnet (local account)'

let sdk = null
async function loadSdk() {
  sdk ||= await import('@anthropic-ai/claude-agent-sdk')
  return sdk
}

/** The Claude Code process must not see an API key, or it would bill the API instead of the login. */
export function withoutApiKey(env = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = env
  return rest
}

function shapeOf(inputSchema) {
  try {
    const parsed = z.fromJSONSchema(inputSchema || { type: 'object', properties: {} })
    return parsed.shape ?? {}
  } catch {
    return {}
  }
}

export function buildMcpServer(agentSdk, tools) {
  const defs = (tools || []).map((t) => agentSdk.tool(t.name, t.description || t.name, shapeOf(t.input_schema), async () => ({ content: [{ type: 'text', text: 'Recorded. The caller runs the tool.' }] })))
  return agentSdk.createSdkMcpServer({ name: SERVER, version: '1.0.0', tools: defs })
}

const textOf = (content) => (typeof content === 'string' ? content : (content || []).map((b) => (b.type === 'text' ? b.text : '')).join(''))

/** Renders the conversation so far as a transcript, because every account call is a fresh single-turn session. */
export function transcriptOf(messages = []) {
  const lines = []
  for (const m of messages) {
    if (typeof m.content === 'string') {
      lines.push(`[${m.role}]\n${m.content}`)
      continue
    }
    for (const b of m.content || []) {
      if (b.type === 'text') lines.push(`[${m.role}]\n${b.text}`)
      else if (b.type === 'tool_use') lines.push(`[assistant called tool ${b.name} with input]\n${JSON.stringify(b.input)}`)
      else if (b.type === 'tool_result') lines.push(`[tool result${b.is_error ? ' (error)' : ''}]\n${textOf(b.content)}`)
    }
  }
  return `${lines.join('\n\n')}\n\n[now continue as the assistant: answer the latest user message, or use the latest tool results]`
}

function choiceNote(choice) {
  if (choice?.type === 'tool') return `You must answer by calling the tool ${choice.name}.`
  if (choice?.type === 'any') return 'You must answer by calling one of the tools.'
  return ''
}

const systemText = (system) => (Array.isArray(system) ? system.map((b) => b.text ?? b).join('\n\n') : system || '')

/** One model turn. `deps.sdk` lets tests inject a fake SDK. */
export async function accountMessage(params, { signal, sdk: injected } = {}) {
  const agentSdk = injected || (await loadSdk())
  const tools = params.tools || []
  const controller = new AbortController()
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  const stream = agentSdk.query({
    prompt: transcriptOf(params.messages),
    options: {
      model: config.anthropicModel,
      systemPrompt: [systemText(params.system), choiceNote(params.tool_choice)].filter(Boolean).join('\n\n'),
      tools: [],
      allowedTools: [`${PREFIX}*`],
      mcpServers: tools.length ? { [SERVER]: buildMcpServer(agentSdk, tools) } : {},
      maxTurns: 1,
      effort: 'medium',
      settingSources: [],
      persistSession: false,
      abortController: controller,
      // Without this the Claude Code process would pick up ANTHROPIC_API_KEY and bill the API.
      env: withoutApiKey(),
    },
  })
  const content = []
  let firstId = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  let failure = null
  try {
    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        const id = msg.message?.id
        firstId ||= id
        if (id && id !== firstId) continue
        for (const b of msg.message?.content || []) {
          if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text })
          else if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name.startsWith(PREFIX) ? b.name.slice(PREFIX.length) : b.name, input: b.input ?? {} })
        }
        if (msg.message?.usage) usage = { input_tokens: msg.message.usage.input_tokens ?? 0, output_tokens: msg.message.usage.output_tokens ?? 0 }
      } else if (msg.type === 'result' && msg.subtype !== 'success' && msg.subtype !== 'error_max_turns') {
        failure = msg.subtype
      }
    }
  } catch (err) {
    // The SDK reports the one-turn cap as an error after the tool call was already issued: that is the expected end.
    if (!content.length || !/maximum number of turns/i.test(err.message)) throw err
  }
  if (!content.length) throw new Error(`The account model returned nothing${failure ? ` (${failure})` : ''}. Check that Claude Code is logged in.`)
  return { id: firstId || `msg_account_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: config.anthropicModel, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage }
}
