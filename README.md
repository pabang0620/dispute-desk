<img src="client/public/logo-512.png" width="128" alt="logo" />

# Dispute Desk

Dispute Desk is for the owner of a small US online store who answers PayPal disputes alone and sits at a 1.3% dispute rate. It shows that a $20 offer looks $31.78 cheaper per case, yet refunding that case is $43.22 cheaper for the account, because a declined offer would push the store to 1.75% and over PayPal's 1.5% High Volume line, while the refund keeps it at 1.47%. These are the app's own demo numbers (expected cost over the whole queue: $84.52 for the refund plan against $127.74 for the case-by-case plan).

**Try it:** https://dispute-desk.35-216-2-121.sslip.io (hosted demo: offline stand-ins for PayPal, recorded Claude Sonnet runs; no login).

Dispute Desk keeps open PayPal inquiries from pushing a seller over PayPal's 1.5% High Volume line: it projects the dispute rate if they become claims, plans which to settle at the inquiry stage and which to fight, prices every option with PayPal's own fee rules, drafts the reply, and sends nothing until the seller approves.

The whole product is an **AG Studio** dashboard (four custom widgets, a theme, saved layouts) and **Claude runs inside Studio's agent framework**: a Claude adapter for the built-in agents plus a custom `dispute-analyst` agent that the Studio lead agent delegates to.

> [Cleared](https://devpost.com/software/cleared) helps a freelancer answer one dispute; Dispute Desk plans a store's whole dispute queue so the account stays under PayPal's 1.5% line.

License: MIT.

## What the problem is

PayPal sets a seller's dispute rate when a new dispute is created: item-not-received and not-as-described claims that were escalated to PayPal (or filed with the card issuer) over the previous 3 calendar months, divided by net sales for the same period. A seller with more than 100 sales in that period and a rate of 1.5% or more pays the High Volume Dispute Fee: $30 per dispute instead of $15, not refunded even when the seller wins. PayPal also says the seller may have to reply within 3 days instead of 10, could lose Seller Protection, and may have the account reviewed.

An inquiry settled directly with the buyer, before it becomes a claim, is not counted. PayPal's Resolution Center already shows the current rate and tier. It does not show where the rate goes if today's open inquiries escalate, or which of them to settle to stay under the line. That is what the planner does.

Sources: PayPal help articles ["When is the dispute rate applied and how is it calculated?"](https://www.paypal.com/us/cshelp/article/when-is-the-dispute-rate-applied-and-how-is-it-calculated-help350) and ["What is the PayPal Dispute Fee and why was I charged one?"](https://www.paypal.com/us/cshelp/article/what-is-the-paypal-dispute-fee-and-why-was-i-charged-one-help349), the [PayPal US merchant fee page](https://www.paypal.com/us/business/paypal-business-fees) (Nov 4 2026 version: Standard Dispute Fee 15.00 USD, High Volume Dispute Fee 30.00 USD) and the [Seller Protection terms](https://www.paypal.com/us/legalhub/paypal/seller-protection).

## Quick start

```bash
npm install
npm run build
npm start            # http://localhost:3002
```

No keys needed. Without keys the app runs on **offline stand-ins**:

- PayPal: a stateful stand-in for the Disputes v1 API. Its response bodies, states, link relations, 422 and 400 behaviour and stage changes follow the real sandbox responses recorded on 2026-11-11 (see `server/data/recordedRun.json` and `server/paypal/mockDisputes.js`). Durations are the observed sandbox durations divided by `MOCK_TIME_SCALE` (default 40, so the 2-minute refund takes 3 seconds).
- Claude: **recorded real runs first, then a scripted stand-in.** The two AI scenes of the walkthrough (step 3 chat, step 5 Draft with Claude on cases A, B and C) were run once with Claude Sonnet through a local Claude Code account on 2026-11-12 and saved in `builtin/recorded-runs/` (tool calls in order, model text, timings). Without a model, a turn that asks the same question and sees the same tool results replays the recorded model output, while every tool still runs live on the server. The screen says "Last AI answer: Recorded run: Claude Sonnet, 2026-11-12". Anything else (another question, a changed planner) gets the scripted stand-in, labelled "Rule-based stand-in (scripted, not a model)". The adapter, the AG-UI conversion, the server tool loop and the Studio delegation run the same code as with the real API.

Every visitor session gets a private copy of the stand-in, so one person's refund never changes another person's demo.

With keys (`.env`, see the table below) the same code calls the PayPal sandbox and the Anthropic API. The status chip in the header always shows which one is active.

Development with hot reload: `npm run dev:server` and `npm run dev:client` (Vite on 5173, proxies `/api`).

One command starts the app in the state the demo video was recorded in (offline, keys ignored): `npm run demo:video`, then open http://localhost:3002.

## Judge walkthrough (about 4 minutes, no login)

Works as written with a fresh `cp .env.example .env` (checked headless on 2026-11-12, all 7 steps finish, the refund resolves in about 3 seconds).

1. **First screen.** Open the app. The banner shows which demo path you are on. Everything on screen about the store (3-month sales, sale count, past claims, past dispute counts) is a **demo store ledger**; the disputes are PayPal sandbox disputes or the stand-in with the same shapes.
2. **Dispute Rate Planner** (left). The demo store is at **1.30%** counted so far. If its three open inquiries all become claims it reaches **1.82%** (High Volume). The planner opens on the per-case plan, so you see two lines: **1.47%** if the buyer accepts a $20 offer on case A, **1.75%** if the buyer declines (a declined offer escalates).
3. **Ask the Studio chat** (right), before you change anything: click "Buyer accepts $20?". Studio's lead agent delegates to our `dispute-analyst`, which chooses its tools: it runs `compare_acceptance` and `compute_rate_plan` on the server, then adds an "Acceptance comparison" page with a chart and a grid: at 50% and 70% acceptance the cheapest plan is the full refund at **$84.52** (the offer plan costs $127.74 and $92.00), at 90% the offer wins at **$56.27**, and the break-even is **74.2%**. The comparison widget is filled from the server's calculator result, not from the model's text. In the offline demo this is the recorded Claude Sonnet run (chip "Last AI answer: Recorded run: Claude Sonnet, 2026-11-12"); with `LLM_BACKEND=account` or an API key the model answers live. If the case you name is already closed, the analyst says so and compares the open case that can get an offer.
4. **Refund on case A** in the planner. The plan collapses to one line, **1.47%**, and the plan table shows the cheaper account-level plan: **Y $84.52** against **X $127.74** and **Z $209.71** (expected cost, under your assumptions). Slide "Buyer accepts the offer" to 80% and the offer wins ($74.13); switch the period to "Dec only" and it wins too (break-even 41.4%). Y stays the account-safe plan (it never reaches 1.5%, $84.52) while the "recommended" chip moves to whichever plan is cheapest. The assumptions are yours, not statistics, and the screen says so.
5. **Draft with Claude and approve a refund** (Decision Card, middle). Pick case A. It shows the evidence checklist (every item names the record it came from, built by code), the cost of refund, offer and fight, and the PayPal rules behind them. Click **Draft with Claude**: the card shows the tools the model called (`get_dispute_detail > get_store_order > draft_response`) and who wrote it (the recorded Claude Sonnet run offline); a draft with a dollar amount the server did not compute is rejected. Click **Reject** on that card (a pending card hides the action buttons), then click **Refund $66.12**: an approval card appears with the exact request and its sha256 (first 8 characters shown, full value in the audit log). Edit the text of a message card and click **Update hash**: the hash changes, which voids the old approval. Click **Approve & refund**: the case goes UNDER_PAYPAL_REVIEW and the card says what it is waiting for and when (the stand-in runs the observed 2-minute sandbox refund 40 times faster, about 3 seconds), then RESOLVED (`SELLER_ISSUED_REFUND`). It never entered the dispute rate, and the action buttons are gone.
6. **Deadline Runway and Rate plan.** Click a bar in Deadline Runway to cross-filter the **Open disputes** grid to that case (Studio data engine); "Clear filter" resets it. **Rate plan** is the second saved layout.
7. **Claim my cases, Recorded run, Reset demo.** **Claim my cases** adds two more cases (one item-not-received, one not-as-described) to your session. **Recorded run** plays two real sandbox runs step by step (full refund, and the fight path to a seller-favour ending that uses the sandbox-only adjudicate call and is labelled a sandbox simulation), and lists the **Sandbox evidence** (today's VERIFY.md PASS items by id) and the **Recorded AI runs** (each agent's question and tool calls in order). **Reset demo** starts over.

On a deployment connected to the PayPal sandbox, "Claim my cases" reserves real sandbox disputes for you for 24 hours and writes are limited to those cases. See "Judge paths" below.

## Environment variables

| Name | Purpose | Default |
|---|---|---|
| `PORT`, `PUBLIC_URL` | Server port, and the public https address when hosted (start log, webhook registration) | 3002, `http://localhost:PORT` |
| `TRUST_PROXY` | Proxy hops trusted for `X-Forwarded-*` (secure cookie, per-IP limits) | `loopback` |
| `SANDBOX_CASE_A` | Sandbox demo mode: comma-separated real sandbox dispute ids (SNAD, USD 66.12, Wool Blanket) that play case A. Needs the PayPal keys | empty |
| `ANTHROPIC_API_KEY` | Real Claude calls. Empty: offline stand-in | empty |
| `LLM_BACKEND` | `account` runs Claude through your local Claude Code login (Claude Agent SDK, development only; the API key variables are removed from that process). The header chip says "Claude Sonnet (local account)" | unset |
| `ANTHROPIC_MODEL` | Model id | `claude-sonnet-5-5` |
| `STREAM_MODEL` | `0` sends whole answers (adapter fallback level 1) | streaming |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app. Empty: offline stand-in | empty |
| `PAYPAL_WEBHOOK_ID` | Enables the verified `CUSTOMER.DISPUTE.*` webhook | empty |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | Only for `scripts/sandbox-filing` | empty |
| `VITE_AG_STUDIO_LICENSE` | AG Studio trial key (build time). Without it Studio shows a trial watermark | empty |
| `MOCK_TIME_SCALE` | Stand-in speed-up of the observed sandbox durations | 40 |
| `POOL_ENABLED`, `POOL_TARGET`, `STATE_FILE` | Judge-path refill worker, target size, state file | off, 6, none |
| `CHAT_PER_IP_HOUR`, `CHAT_PER_DAY`, `WRITES_PER_HOUR` | Demo limits. Over the model limit the offline stand-in answers | 40, 300, 30 |
| `LLM_LIVE_PER_IP_HOUR`, `LLM_LIVE_PER_DAY` | Live Claude caps: model runs per client IP per hour, and per host per day (one run = one user action). Over a cap, or when the API errors or times out, the action completes from the recorded run if one exists, else the rule-based stand-in, and the screen says why (for example "live limit reached") | 10, 150 |
| `LLM_TIMEOUT_MS` | Live API request timeout before the fallback | 60000 |
| `FORCE_MOCK` | `1` ignores every key (tests and `npm run demo:video` set it) | unset |
| `LLM_REPLAY` | `0` turns off the recorded-run replay, so the offline demo uses only the scripted stand-in (tests set it) | on |
| `RECORD_LLM_RUNS` | `1` with `LLM_BACKEND=account` saves every model turn to `builtin/recorded-runs/` | off |

Keys live only on the server. The browser never sees the Anthropic key.

## How it is built

```
React 19 + Vite (ag-studio, ag-studio-react)
  claudeAdapter          AgLlmAdapter.executeTurn -> POST /api/studio/llm (SSE of AG-UI events)
  Studio agents          the 5 built-in agents on the adapter, lead delegates to dispute-analyst
  dispute-analyst        clientToolRunner: run() -> POST /api/agent/run; Studio executes the tools the stream leaves open
  widgets                Dispute Rate Planner, Decision Card, Deadline Runway, Saved vs Advised
Express
  /api/state, /api/plan             planner view (domain/ratePlan.js, decision.js, planView.js)
  /api/approvals                    cards, edit, approve (hash bound), reject
  /api/studio/llm, /api/agent/run   Claude (Anthropic Messages API or the offline stand-in)
  /api/judge/*, /api/recorded-run   judge paths
  /api/webhooks/paypal              CUSTOMER.DISPUTE.* events (signature check implemented, not yet run against the sandbox, VERIFY R7)
  paypal/                           live sandbox client (Agent Toolkit reads, REST writes) and the stand-in
```

### Money is computed by code

`server/domain` holds every rule: fee tiers at creation (Standard $15 or High Volume $30), Standard exemptions (settled at inquiry, unauthorized transaction reports, Seller Protection eligible, under $30, seller wins), High Volume rules (no reimbursement), Seller Protection checks for item-not-received (delivered tracking to the transaction address, physical goods, PayPal-filed), possible returns on not-as-described claims, card (ACDC) transactions on the chargeback fee, the rate plan with accept/decline branches, the tier-cost estimate from the seller's own past disputes by type, and the 3-month window dates. The model has no PayPal write tool, cannot approve, and every number it quotes must come from a tool result. A draft that contains a dollar amount the server did not compute is rejected.

### Approvals and safety

- Every PayPal write is an approval card. The approval is bound to the sha256 of the exact request body (and attachment hashes), plus a one-time token.
- Before sending, the server takes a per-dispute lock, re-reads the dispute and only calls an action PayPal lists in the dispute's links. If the links changed, the card is invalidated and nothing is sent.
- Deadline guard: a warning under 2 hours; under 30 minutes messages, offers and escalation are blocked (evidence and a full refund still go through).
- Sandbox-only calls (`adjudicate`, `require-evidence`) are separate buttons, and a result reached that way is labelled "sandbox simulation" and kept out of the Saved vs Advised totals.
- Audit log of every card, approval, PayPal call and blocked action (`/api/audit`).

### Claude and AG Studio

AG Studio ships no model connection. `client/ai/claudeAdapter.js` implements `AgLlmAdapter`; `server/agent/routes.js` calls the Anthropic Messages API and `server/agent/agui.js` turns the stream (text deltas, `input_json_delta` tool arguments) into AG-UI events. `client/ai/harness.js` builds the harness: Studio's five agents on the adapter, with the lead given `delegateTo([..., 'dispute-analyst'])`. The analyst's tools are the server calculators (run on the server inside the same stream) plus Studio's `view_schema`, `execute_query`, `add_widget` and a custom `show_scenario_comparison` tool, which Studio runs in the browser. Fallback levels if the default fails: whole-message replay instead of streaming (`STREAM_MODEL=0` on the server) and the dispute-analyst alone without Studio's built-in agents (`VITE_ADAPTER_LEVEL=2` at build time).

Studio's chat history keeps only the tool calls Studio ran itself, so the server keeps each analyst run's own history (its server tool calls and results) between Studio round trips. `server/agent/replay.js` records real model turns (`RECORD_LLM_RUNS=1` with `LLM_BACKEND=account`) and replays them offline only when the question and every tool result match; every frame carries its source, and the header shows the source of the last AI answer.

### Judge paths

0. Planner, Decision Card and Studio chat on the demo ledger. Needs no PayPal write and no queue.
1. Live pool: a worker (`POOL_ENABLED=1`) files sandbox disputes one at a time through the buyer web flow (`scripts/sandbox-filing`).
2. Reserved stock created by hand before the deadline: bundle I (still an inquiry, do not escalate) and bundle C (already escalated). `scripts/reserve.mjs` records them, `scripts/escalate-reserved.mjs` escalates bundle C on the date you choose. A claim-stage case is shown as "already a claim" and counted, not planned.
3. Recorded run of real sandbox responses, and the local run below.

## Sandbox demo mode (real sandbox refund in the judge walkthrough)

The offline demo runs on a stand-in. Sandbox demo mode keeps the same scenario and numbers but makes case A a real PayPal sandbox dispute, so step 5 (Refund, Approve) calls `POST /v1/customer/disputes/{id}/accept-claim` on api-m.sandbox.paypal.com and the screen follows the real case to RESOLVED.

1. Put the sandbox `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and the sandbox buyer in `.env`.
2. `npm run case-a:new` files one not-as-described case for USD 66.12 (Wool Blanket) through the sandbox buyer web flow (payment, buyer transaction lookup and filing, about 3 to 6 minutes) and prints `CASE PP-R-...`. Repeat for as many visitors as you expect: each refund uses up one case.
3. `SANDBOX_CASE_A=PP-R-...,PP-R-... npm run demo:sandbox` (or set it in `.env` and `npm run build && npm start`).

What you see: the header chip reads "PayPal: sandbox for case A (PP-R-...), stand-in for B and C", the banner names the real case, and the Decision Card of A carries "real PayPal sandbox case" (B and C say "stand-in case"). A new case needs about 3 to 4 minutes before PayPal offers Refund. After approval the card shows the clock since approval while PayPal reviews (about 1m40s in our runs). Each session takes the first listed case that is still open; once every case is used, A falls back to the stand-in and the banner says so. Cases B and C, Claim my cases and the sandbox-only buttons stay on the stand-in.

Hosting (one Node process behind an https reverse proxy): `npm ci && npm run build`, then `PORT=<port> PUBLIC_URL=https://<host> npm start` with the same `.env`. `GET /api/health` answers `{ ok, modes }` (modes.paypal is `mock`, `hybrid` for sandbox demo mode, or `sandbox`). A proxy on the same machine is trusted by default; set `TRUST_PROXY` otherwise so secure cookies and the per-IP limits see the visitor address.

## Run locally with your own sandbox accounts

You need a PayPal sandbox business account with a REST app and a sandbox personal (buyer) account.

```bash
cp .env.example .env     # fill PAYPAL_*, SANDBOX_BUYER_*; ANTHROPIC_API_KEY is optional
pip install playwright && playwright install chromium
npm run dispute:new INR 41.37 Desk_Lamp      # one case, files the dispute through the buyer web UI
npm run dispute:new SNAD 66.12 Wool_Blanket  # run them one at a time
npm run build && npm start
```

The sandbox create-dispute API is closed to this kind of app, so the buyer side is browser automation. A new dispute shows up in the list after about 3 minutes and becomes actionable after 3 to 4.

## Tests

```bash
npm test      # offline, no keys needed
npm run build
```

- `ratePlan.test.js` reproduces every number of the demo scenario (`server/data/scenario.json`): 1.30%, 1.82%, 1.47%, 1.75%, 1.55%, tier cost $150 (and $50 for December only), plan totals $127.74, $84.52, $209.71, the reference combinations, the break-even acceptance 0.742 (0.414 for December only), $74.13 at 80%, the refunds-excluded variant (1.48%), the window dates, and the High Volume threshold.
- `mockDisputes.test.js`: response shapes and the observed sandbox behaviour (422 while under review, 400 without a link, evidence types per stage, adjudicate link delay, outcomes).
- `approvals.test.js`: hash binding, voided edits, one-time approval, races, link re-check, deadline guard, session isolation.
- `agent.test.js`, `http.test.js`: AG-UI conversion, server tools, adapter and agent routes, the full refund flow over HTTP, the analyst keeping its server tool calls across Studio round trips.
- `replay.test.js`, `accountModel.test.js`: recorded-run replay (match, fallback, id substitution, labels) and the account backend (API key removed, tool calls mapped).
- `rules.test.js`, `pool.test.js`, `evals.test.js`: fee and Seller Protection rules, judge pool, evaluation scoring.

`npm run eval` runs the 30-case AI evaluation (`evals/`). It makes real model calls, so it refuses to run without `--allow-llm` and either `ANTHROPIC_API_KEY` or `LLM_BACKEND=account`. It writes `EVALS.md` with the numbers and every failure.

## Sandbox evidence (VERIFY.md, 2026-11-12)

PASS:
- **R24** Sandbox demo mode: the walkthrough refund on a real sandbox case (PP-R-KKG-10199698, USD 66.12) with the same plan numbers as offline: RESOLVED / SELLER_ISSUED_REFUND 2m13s after approval.
- **R23** Seller writes through the app's approval cards: send message (PP-R-GEN-10199701, a second approval answers 409), offer USD 20 (PP-R-TDE-10199710, seller_offered_amount 20.00), escalate then submit evidence with tracking (PP-R-CYV-10199706, CHARGEBACK in 172 s, evidence 200).
- **R3** Transaction Search (Agent Toolkit `list_transactions`): 98 transactions for 30 days, including the R15 refund.
- **R15** Full refund through the app on a not-as-described inquiry (PP-R-JZX-10199650, USD 66.12): RESOLVED / SELLER_ISSUED_REFUND in about 1m40s.
- **R19** Full refund through the app at the claim (CHARGEBACK) stage (PP-R-VBD-10199646, USD 41.37): RESOLVED in about 1m45s.
- **R20** Agent Toolkit `accept_dispute_claim` called directly with note `refund_issued` resolved a case; the app sends the same JSON through REST.
- **R8** Shipment tracking read for a captured sandbox order.
- **R6** Filing sandbox disputes through the buyer web flow from this machine (hosted machine not tested).
- **R21** Claude through a local Claude Code account (Sonnet): chat delegation, Draft with Claude and the 30-case evaluation. The hosted Anthropic API streaming path was not run.

PARTIAL: **R17** require-evidence worked once; escalating reserved cases on a chosen date was not run.
Not claimed: R7 webhook, R9 buyer accepts an offer, R10, R18, R22 AG Studio licence. The same list is in the app (Recorded run window).

## Honest notes

- Store figures are a demo store ledger, because a sandbox seller has no such history. The screen labels this everywhere.
- The dispute rate on screen is our recalculation from PayPal's published formula, not PayPal's official number. A link to the Resolution Center is shown next to it.
- PayPal's help text says "previous 3 calendar months" but not whether the current month counts or which date a claim belongs to. The planner shows its window assumption (a) and lets you switch to (b).
- Buyer acceptance and win rates are the seller's own assumptions. Under those assumptions the advice can flip (above about 74% acceptance, or with the period set to December only), and the screen shows both boundaries.
- The tier cost is an estimate built from the seller's own last 3 months of disputes by type.
- The seller-favour ending is made with the sandbox-only adjudicate call and labelled "sandbox simulation".
- Items that need a live sandbox run are listed in `VERIFY.md` with the exact calls and the fallback for each.

See `VERIFY.md` for what still has to be checked against the real sandbox, and `BUILD_REPORT.md` for the build status.
