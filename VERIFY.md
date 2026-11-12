# VERIFY: checks against the real PayPal sandbox

The app was built against the offline stand-in; the items below were then run against the PayPal sandbox on 2026-11-12 and each one carries its result (PASS, PARTIAL, FAIL, SKIPPED or NOT RUN) with the ids that prove it. R21 was run through a Claude Code account (no API key). The app code has a real call path for each item, and the offline stand-in covers the same path in tests. Each item says which calls to make, in what order, what you should see, and what the app does if it fails. Run them yourself, with your own sandbox keys, after reading the calls. Items are numbered like the plan (R-numbers) so the plan, the video notes and this list stay aligned.

Setup for all items: `cp .env.example .env`, fill `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox), then `npm run build && npm start`. The header chip should say "PayPal: sandbox".

## R3. list_transactions on the sandbox seller

- **Result: PASS 2026-11-12 (re-run after the Transaction Search scope was granted on the sandbox app). `GET /api/verify/transactions` in sandbox mode answered 200 in about 1.8 s with 98 `transaction_details` for the last 30 days, for example capture 3KR23759SF469520Y (T0006, USD 66.12) and its refund 15Y38875AS5348512 (T1107, USD -66.12, paypal_reference_id 3KR23759SF469520Y), which is the R15 refund. Transactions from the last few hours were not listed yet (Transaction Search lags). The first run the same day was FAIL 403 (scope missing). The app has no transactions panel; the planner keeps the demo store ledger as its denominator.**

- Call: open `GET /api/verify/transactions` in the browser (Agent Toolkit `list_transactions`, last 30 days).
- Expect: 200 with `transaction_details`. A sandbox seller has only a few transactions.
- Use: shows the real integration path works. The planner's denominator stays the demo store ledger either way.
- If it fails: the transactions panel stays out. Nothing else depends on it.

## R6. Hosted headless buyer login and filing (judge path 1)

- **Result: PASS 2026-11-12 (sandbox, hosted-machine step not tested). `npm run dispute:new INR 41.37 Desk_Lamp` took 2m10s and printed PP-R-VBD-10199646. It showed in `/api/state` about 4 minutes later as UNDER_PAYPAL_REVIEW, stage CHARGEBACK, with accept_claim/adjudicate/require_evidence links by 01:16Z (not an inquiry). `SNAD 66.12` filed PP-R-JZX-10199650 (INQUIRY): UNDER_PAYPAL_REVIEW at about 3 min, REQUIRED_ACTION with escalate/accept_claim/make_offer/send_message links at 3m36s. Note: the `auto` row pick by amount failed twice on the shared buyer account (dashboard list crowded by other apps); filing by buyer txn id worked. Script fix: `file_dispute_ui.py` used a fixed date 11/10/2026 which PayPal rejects, now uses today's date in America/Los_Angeles.**

- Calls, on the hosting machine: `npm run dispute:new INR 41.37 Desk_Lamp`, wait 3 to 4 minutes, then `GET /api/state` and look for the new dispute with `REQUIRED_ACTION`.
- Expect: a case id `PP-R-...` printed by the script, and the dispute actionable after 3 to 4 minutes.
- If it fails (captcha, login page that does not advance): leave `POOL_ENABLED=0` and use judge path 2 (reserved stock) and 3 (recorded run). The worker already stops itself after 3 failures in a row (pause 1 hour) and switches off for the day after more than 5 failures.

## R7. Webhook CUSTOMER.DISPUTE.* with signature verification

- **Result: SKIPPED 2026-11-12: needs a public https URL. A person must set PUBLIC_URL, run `npm run register-webhook`, set PAYPAL_WEBHOOK_ID, restart, file a dispute and read `data.webhooks`.**

- Calls: set `PUBLIC_URL` to your https URL, run `npm run register-webhook`, put the printed id in `PAYPAL_WEBHOOK_ID`, restart. File a dispute (R6). Then `GET /api/state` and read `data.webhooks`.
- Expect: `count` goes up and `last.type` is `CUSTOMER.DISPUTE.CREATED` or `UPDATED`. An unsigned `POST /api/webhooks/paypal` must return 401.
- If it fails: the app keeps polling the Disputes API (the screen refreshes every few seconds while PayPal reviews a case).

## R8. Shipment tracking for a captured order

- **Result: PASS 2026-11-12. Order 0LK31272JJ185121J, capture 68149047RF671243Y, tracker created with `POST /v2/checkout/orders/{id}/track` (DHL, TRK41370001). `GET /api/verify/tracking/0LK31272JJ185121J?transaction_id=68149047RF671243Y` returned the tracker with status SHIPPED, carrier DHL. Keep `paypal-shipment-tracking` in Built with.**

- Calls: create a tracker for a sandbox capture (Agent Toolkit `create_shipment_tracking` or the Orders tracking REST call), then `GET /api/verify/tracking/<order id>?transaction_id=<capture id>`.
- Expect: the tracker with carrier, number and status.
- If it fails: the checklist uses the demo store tracking, labelled "demo store data", and the evidence call carries `tracking_info` (observed to return 200). Remove `paypal-shipment-tracking` from "Built with" in the Devpost text.

## R9. Sandbox buyer accepts an offer (for the "buyer accepts" button)

- **Result: SKIPPED 2026-11-12: not automated (button answers 501 on sandbox). Leave the scene out of the video.**

- Calls: approve a `make_offer` card on an inquiry-stage case, then drive the buyer side of the Resolution Center (Accept, Confirm) with a headless browser as the sandbox buyer.
- Expect: RESOLVED with `INQUIRY_OFFER_PARTIAL_REFUND` about 4 minutes later (observed once).
- Status: **not automated.** On a sandbox deployment the button answers 501. Only the offline stand-in has it. Leave this scene out of the video unless you automate and confirm it.

## R10. State of a sandbox dispute past its reply deadline

- **Result: SKIPPED 2026-11-12: needs a case past its deadline (inquiries close after about 20 days). A person must re-read an old inquiry after its seller_response_due_date (PP-R-JZX style cases from 2026-11-12 are due 2026-12-02).**

- Call: re-read an old inquiry with `GET /api/disputes/<id>` after its `seller_response_due_date`.
- Expect: unknown (the plan has only a search summary saying an unescalated inquiry closes after 20 days).
- The pool already retires cases within 48 hours of the deadline and drops anything RESOLVED or CLOSED on the next read.

## R24. Sandbox demo mode: the judge walkthrough refund on a real sandbox case

- **Result: PASS 2026-11-12.** `npm run case-a:new` filed PP-R-KKG-10199698 (SNAD, USD 66.12, Wool Blanket; order 8RB09382CE3816059, capture 4R454656F08437022) at 06:08:20Z. The app ran with `SANDBOX_CASE_A=PP-R-KKG-10199698` (header chip "PayPal: sandbox for case A (PP-R-KKG-10199698), stand-in for B and C", Decision Card chip "real PayPal sandbox case"). The planner showed the same numbers as the offline demo (1.30% / 1.82% / 1.47% / 1.75%). A headless browser clicked Refund $66.12 at 06:11:46Z (the case became actionable about 3.5 minutes after filing), Approve & refund at 06:11:50Z, and the card showed RESOLVED_BUYER_FAVOUR / SELLER_ISSUED_REFUND, refunded $66.12; PayPal's update_time was 06:14:03Z (2m13s). No page errors. Screenshots `final_shots/sb_01..05_*.png`.
- Calls: see README "Sandbox demo mode". Each refund uses up one case; list several ids for a hosted demo.
- If it fails: leave `SANDBOX_CASE_A` empty; the offline demo and the Recorded run stay.

## R15. Full refund (accept-claim) on a not-as-described inquiry

- **Result: PASS 2026-11-12. SNAD inquiry PP-R-JZX-10199650 (USD 66.12): Refund in full card approved at 01:25:44Z, UNDER_PAYPAL_REVIEW, then RESOLVED at 01:27:23Z (about 1m40s) with RESOLVED_BUYER_FAVOUR / SELLER_ISSUED_REFUND, amount_refunded 66.12.**

- Calls: on a SNAD inquiry, create a "Refund in full" card, approve it, watch `UNDER_PAYPAL_REVIEW` then `RESOLVED`.
- Expect: `RESOLVED_BUYER_FAVOUR` / `SELLER_ISSUED_REFUND` in about 2 minutes. Only item-not-received cases were measured (HOV with JSON, CNJ with multipart).
- If it fails: use an item-not-received case for the full-refund scene and recompute the demo scenario with that case in the A slot (`server/data/scenario.json`, then `npm test` shows what moves).

## R17. Reserved stock: escalate on the chosen date, and extend with require-evidence

- **Result: PARTIAL 2026-11-12. Reserve step (`reserve.mjs I`/`C`) worked. Require-evidence PASS once: PP-R-VBD-10199646 (CHARGEBACK) went UNDER_PAYPAL_REVIEW then WAITING_FOR_SELLER_RESPONSE/REQUIRED_ACTION in about 30 s, due date 2026-11-15T14:59:59Z (+3 days), links accept_claim and provide_evidence. Repeated require-evidence not tested. Escalate on a chosen date (`escalate-reserved.mjs`) not run: no spare reserved case, a person must run it on the chosen date.**

- Calls: `STATE_FILE=./pool-state.json node scripts/reserve.mjs C <dispute id> INR 41.37 <due ISO>` for hand-made cases, then on the chosen date `STATE_FILE=./pool-state.json node scripts/escalate-reserved.mjs`. Later, on a claim-stage case with an adjudicate link, use the sandbox button "Sandbox: ask for more evidence".
- Expect: escalate returns 200 and the case moves to CHARGEBACK after about 3 minutes with a reply window of +10 days. Require-evidence returned the case to waiting with +3 days (observed once).
- If repeated require-evidence does not keep extending: tell judges in the Testing instructions that claim-stage cases may be gone after about Dec 11 and point to the Recorded run.

## R18. Worker restart keeps the queue

- **Result: SKIPPED 2026-11-12: needs the pool worker to create cases through the buyer web UI (about 2 minutes each, outside the buyer lock wrapper) and a restart. A person must run it with POOL_ENABLED=1.**

- Calls: with `POOL_ENABLED=1` and `STATE_FILE` set, let the worker create two cases, restart the process, `GET /api/state` and read `data.pool`.
- Expect: the same READY count. A creation interrupted by the restart is marked RETIRED (covered by a unit test).
- If it fails: delete the state file and use reserved stock only.

## R19. accept-claim at the CHARGEBACK stage

- **Result: PASS 2026-11-12. PP-R-VBD-10199646 (INR, stage CHARGEBACK, accept_claim link present): Refund in full approved 01:28:45Z, RESOLVED at 01:30:27Z (about 1m45s), RESOLVED_BUYER_FAVOUR / SELLER_ISSUED_REFUND, amount_refunded 41.37. The case had reached CHARGEBACK by itself about 20 minutes after filing (not by escalate).**

- Calls: escalate a case, wait for CHARGEBACK, create a "Refund in full" card, approve.
- Expect: unknown duration and outcome. Only the presence of the accept_claim link was observed at this stage.
- If it fails: claim-stage reserved cases offer evidence only; the full acceptance is shown in the Recorded run, and the Testing instructions say so.

## R20. The Agent Toolkit `accept_dispute_claim` tool itself

- **Result: PASS 2026-11-12. `toolkit.handleToolCall` `accept_dispute_claim` with `note: "refund_issued"` on PP-R-MED-10199654 (INR 53.43, REQUIRED_ACTION, accept_claim link) returned the detail link (success). Devpost may say the app's same JSON and the toolkit tool both worked. Note: the app itself still sends this through REST.**

- The app sends the same JSON the toolkit sends (`{"note":"refund_issued"}`) through REST (observed 200). The toolkit tool was not called. To check it: call `toolkit.handleToolCall` with `accept_dispute_claim`, `dispute_id` and `note: "refund_issued"` on a throwaway item-not-received case. A note with spaces is rejected by the toolkit's id pattern before it reaches PayPal (observed in the package source).
- Until this is checked, the Devpost sentence says "the same JSON shape the toolkit sends returned 200", not "the app calls the toolkit tool".

## R21. Claude adapter against the real Anthropic API

- **Result (account mode): PASS (account-mode Sonnet, 2026-11-12), hosted API path NOT verified.** Run with `LLM_BACKEND=account` (Claude Code login through the Claude Agent SDK, no API key, PayPal stand-in). Studio chat "Buyer accepts $20?": `POST /api/studio/llm` (lead, 200) then `delegate_to` dispute-analyst, `POST /api/agent/run` (200): analyst called `compare_acceptance` (server), then `show_scenario_comparison` with only a `comparison_id` (browser), `POST /api/scenarios` 200, new "Acceptance comparison" page with 4 rows, final `complete_task`. Header chip read "Claude Sonnet (local account)". A direct analyst run called `compare_acceptance` twice (q 0.2, then 0.5, 0.75, 0.9) before showing the comparison. Draft with Claude (`POST /api/approvals/draft`, 18 s): `get_dispute_detail`, `get_store_order` with the dispute id (error), `get_store_order` with JH-1042, `draft_response`; the card was created with createdBy `claude`. The wrong first order id led us to say in the task prompt and the tool description that the order id is the store id (JH-1042). Eval (30 cases, `LLM_BACKEND=account`, 2026-11-12, `EVALS.md`): checklist accuracy 100%, source id validity 100%, invented amounts 0, adversarial refusals 100%, wrong "delivered" claims 1 (INR-6). The first run flagged 2; the two drafts we read said "not yet delivered", which is correct, so the scorer now ignores negated mentions (unit-tested). The remaining flag was not inspected, so it counts as a miss until read. The raw Anthropic streaming path (`input_json_delta`, `STREAM_MODEL`) is still unverified because account mode replays whole messages as events.
- **Recorded runs: PASS (account-mode Sonnet, 2026-11-12, second run, saved in `builtin/recorded-runs/`).** Run with `LLM_BACKEND=account RECORD_LLM_RUNS=1`, PayPal stand-in, a headless browser clicking the chat starter, then `POST /api/approvals/draft` for cases A, B and C. Chat: lead `delegate_to` dispute-analyst (3.8 s); analyst `compare_acceptance` (q 0.5, 0.7, 0.9) and `compute_rate_plan` (q 0.7) in one turn (5.0 s), then `show_scenario_comparison` with the comparison_id (3.2 s), then `complete_task` (6.4 s); lead one-sentence answer citing the 74.2% break-even (3.0 s). Drafts A, B, C: `get_dispute_detail` > `get_store_order` (correct store ids JH-1042, JH-1049, JH-1051) > `draft_response`, about 12 s each, all accepted by the server amount check. The first recording attempt the same day showed a real defect: Studio's history drops the server tool calls, so after the widget was placed the analyst no longer saw its `compare_acceptance` call and recalculated six times. Fixed by keeping each analyst run's server-side history between Studio round trips (`resumeThread`, test in `http.test.js`), then re-recorded. The offline demo replays these runs only when the question and every tool result match (ids and timestamps aside), labelled "Recorded run: Claude Sonnet, 2026-11-12"; otherwise the scripted stand-in answers, labelled "offline stand-in (scripted, not a model)". A headless walk of the README path on a fresh `.env.example` copy showed every AI frame as `recorded`.
- Calls for the hosted path: set `ANTHROPIC_API_KEY`, start the app, open the chat, click "Buyer accepts $20?".
- Expect, in order: streamed text, a `delegate_to` call to `dispute-analyst`, the analyst calling `compare_acceptance` (server) then `show_scenario_comparison` (browser, `comparison_id` only), a new "Acceptance comparison" page, a final answer that repeats only numbers from the tool results.
- If streaming breaks: set `STREAM_MODEL=0`. If delegation breaks: build with `VITE_ADAPTER_LEVEL=2`. Write the level that shipped in the Devpost text.
- Also run `npm run eval -- --allow-llm` with the API key (30 paid calls) and compare with the account-mode numbers in `EVALS.md`.

## R23. Seller actions through the app (approval cards) on the sandbox

- **Result: PASS 2026-11-12, all four through the app's approval cards** (app in sandbox mode, cases reserved with `scripts/reserve.mjs`, claimed and driven over the app's own HTTP API by `node scripts/verify-writes.mjs`; log lines below are the script output).
  - send_message: PP-R-GEN-10199701 (SNAD 47.29), approve 200 EXECUTED at 06:22:57Z; the second approval of the same card answered 409 "Card is EXECUTED. An approval can be used once."; the dispute then listed the SELLER message, and the case moved to REQUIRED_OTHER_PARTY_ACTION with links accept_claim, send_message, escalate (make_offer gone until the buyer answers; the stand-in already behaves this way).
  - make_offer USD 20: PP-R-TDE-10199710 (SNAD 47.31), approve 200 EXECUTED at 06:36:07Z, `offer.seller_offered_amount` 20.00 USD 2 s later, state UNDER_PAYPAL_REVIEW.
  - escalate then provide_evidence: PP-R-CYV-10199706 (INR 33.19), escalate approve 200 at 06:30:10Z, CHARGEBACK / REQUIRED_ACTION with accept_claim, provide_evidence 172 s later; provide_evidence (USPS tracking and a text file) approve 200 EXECUTED at 06:33:10Z, then CHARGEBACK / UNDER_PAYPAL_REVIEW.
  - The order in the call list below was corrected: message and offer need separate cases.
- Order, on reserved sandbox cases: (1) inquiry case: Decision Card "Offer $20" -> approve -> expect the case to show `seller_offered_amount`; (2) a different inquiry case: "Fight (escalate)" -> approve -> expect CHARGEBACK after about 3 minutes; (3) a third inquiry case: "Send message" -> approve -> expect the message in `GET /api/disputes/<id>`, and the default draft must not mention a refund; (4) a claim-stage case: "Submit evidence" -> approve -> expect `provide_evidence` 200 with tracking_info.
- After send_message, try approving the same card twice quickly: the second call must answer 409 and the card must stay EXECUTED (unit-tested on the stand-in; PayPal's own 422 timing is not known).
- If one fails: note the status and `issue` from `/api/audit`, keep that button out of the demo path, and say so in the Devpost text.

## R22. AG Studio trial licence

- **Result: SKIPPED 2026-11-12: needs an AG Studio licence key (a person issues the 45-day trial key).**

- Issue the 45-day trial key for the day you deploy, note the date, put the key in `VITE_AG_STUDIO_LICENSE` and rebuild. A key issued on 2026-11-12 covers the judging period (2026-12-02 to 2026-12-16).
- Without the key the app works and Studio logs a trial watermark message.

## Hosting

- **Result: PASS 2026-11-12.** https://dispute-desk.35-216-2-121.sslip.io on a Google Cloud VM (nginx, Let's Encrypt, systemd). Mode: offline stand-ins for PayPal, recorded Claude Sonnet runs. `GET /` and the health endpoint return 200 over https. Walked headless against the https host: Judge walkthrough steps 1 to 7 (planner 1.30%/1.82%, chat comparison 74.2%, refund on case A resolved in about 4 s, Draft with Claude, claim, recorded run, reset).
