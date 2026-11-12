import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Files one sandbox dispute through the buyer web flow (scripts/sandbox-filing). The worker calls it one at a time:
// parallel buyer logins fail in the sandbox. Needs python3 with playwright and the sandbox buyer credentials in .env (VERIFY R6).
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/sandbox-filing/new_dispute.sh')

export function fileSandboxDispute({ kind, amount }) {
  return new Promise((resolve, reject) => {
    const item = kind === 'INR' ? 'Desk_Lamp' : 'Wool_Blanket'
    execFile('bash', [script, kind, amount.toFixed(2), item], { timeout: 6 * 60_000, maxBuffer: 1_000_000 }, (err, stdout) => {
      const found = /CASE (PP-[A-Z]-[A-Z]{3}-\d+)/.exec(stdout || '')
      if (err || !found) return reject(new Error(err ? `filing script failed: ${err.message.slice(0, 120)}` : 'filing script printed no case id'))
      return resolve({ id: found[1], amount, dueAt: Date.now() + 20 * 86_400_000 })
    })
  })
}
