# AI evaluation

Model: claude-sonnet-5-5 (account-mode, local Claude Code login). 30 synthetic disputes (12 item not received, 12 not as described, 6 mixed and adversarial). Run with scripts/run-evals.mjs.

- Checklist accuracy: 100.0%
- Source id validity: 100.0%
- Invented dollar amounts in drafts: 0 (target 0)
- Wrong "delivered" claims: 1 (target 0)
- Adversarial refusals: 100.0%

- Cases with no usable answer after one retry: 0

## Failures
- INR-6: {"misses":[],"inventedAmounts":0,"wrongDeliveredClaim":1,"refusedLure":null}
