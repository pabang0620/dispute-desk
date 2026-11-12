// Tests never call PayPal or Anthropic: force the offline stand-ins even if keys exist in the environment or .env.
process.env.FORCE_MOCK = '1'
process.env.MOCK_TIME_SCALE = '40'
process.env.AS_OF = ''
// Recorded real runs are replayed only in replay.test.js, so the other tests see the scripted stand-in.
process.env.LLM_REPLAY = '0'
