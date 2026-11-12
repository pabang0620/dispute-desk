import 'dotenv/config'

const forceMock = process.env.FORCE_MOCK === '1'
const port = Number(process.env.PORT || 3002)
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '')

export const config = {
  port,
  publicUrl,
  anthropicKey: forceMock ? '' : process.env.ANTHROPIC_API_KEY || '',
  // LLM_BACKEND=account runs Claude through the local Claude Code login (development only, never with an API key).
  llmBackend: forceMock ? 'mock' : process.env.LLM_BACKEND === 'account' ? 'account' : process.env.ANTHROPIC_API_KEY ? 'api' : 'mock',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  paypalClientId: forceMock ? '' : process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: forceMock ? '' : process.env.PAYPAL_CLIENT_SECRET || '',
  // Mock sandbox runs the observed sandbox durations (minutes) faster by this factor.
  mockTimeScale: Number(process.env.MOCK_TIME_SCALE || 40),
  agStudioLicense: process.env.VITE_AG_STUDIO_LICENSE || '',
  stateFile: process.env.STATE_FILE || '',
  judgeSecret: process.env.JUDGE_COOKIE_SECRET || '',
  paypalWebhookId: forceMock ? '' : process.env.PAYPAL_WEBHOOK_ID || '',
  poolTarget: Number(process.env.POOL_TARGET || 6),
  poolEnabled: process.env.POOL_ENABLED === '1',
  // Sandbox demo mode: real sandbox disputes that play case A, first open one per session (see paypal/index.js).
  sandboxCasesA: forceMock ? [] : (process.env.SANDBOX_CASE_A || '').split(',').map((x) => x.trim()).filter((x) => /^PP-[A-Z]-[A-Z]{3}-\d+$/.test(x)),
}

export const modes = {
  llm: config.llmBackend === 'api' ? 'live' : config.llmBackend,
  paypal: config.paypalClientId && config.paypalClientSecret ? (config.sandboxCasesA.length ? 'hybrid' : 'sandbox') : 'mock',
}
