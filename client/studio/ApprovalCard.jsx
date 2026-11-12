import { useEffect, useState } from 'react'
import { editCard, approveCard, rejectCard } from '../store.js'
import { usd, untilText, LLM_LABEL, KIND_LABEL } from './format.js'

const EDITABLE = { send_message: 'message', make_offer: 'note', escalate: 'note', provide_evidence: 'notes', provide_supporting_info: 'notes' }
const NEXT_STEP = { accept_claim: 'Approve & refund', make_offer: 'Approve & send offer', escalate: 'Approve & escalate', send_message: 'Approve & send message', provide_evidence: 'Approve & submit evidence', provide_supporting_info: 'Approve & submit info', adjudicate: 'Approve sandbox decision', require_evidence: 'Approve sandbox call' }
// Same endpoint names the server calls (server/paypal/live.js).
const PATH = { send_message: 'send-message', provide_evidence: 'provide-evidence', provide_supporting_info: 'provide-supporting-info', make_offer: 'make-offer', accept_claim: 'accept-claim', escalate: 'escalate', adjudicate: 'adjudicate', require_evidence: 'require-evidence' }
const NEAR_DEADLINE_BLOCKED = new Set(['send_message', 'make_offer', 'escalate'])

// The chip names who wrote the draft: a scripted stand-in is never called Claude.
function draftedBy(drafter) {
  if (!drafter) return 'drafted by the agent'
  if (drafter.source === 'mock') return 'drafted by offline stand-in'
  if (drafter.source === 'recorded') return drafter.label
  return `drafted by ${drafter.label}`
}

function moneyOf(card, d) {
  if (card.action === 'accept_claim') return d.dispute_amount.value
  if (card.action === 'make_offer') return card.payload.offer_amount?.value
  return null
}

function rateText(action) {
  if (action === 'accept_claim') return '+0. Settled with the buyer, so it does not count in the rate.'
  if (action === 'make_offer') return '+0 if the buyer accepts. If declined, the case can escalate and then counts.'
  if (action === 'escalate') return 'Counts: an escalated claim enters the dispute rate.'
  return 'No change from this action.'
}

function paypalDoes(card, amount, order) {
  const p = card.payload
  const lines = {
    accept_claim: [`Sends the refund of ${usd(amount)} to the buyer${order ? ` (${order})` : ''}`, 'Moves the case to UNDER_PAYPAL_REVIEW, then RESOLVED (SELLER_ISSUED_REFUND), about 2 minutes in our sandbox runs'],
    make_offer: [`Sends the buyer an offer of ${usd(amount)} (${p.offer_type})`, 'The buyer accepts or declines it; a declined offer leaves the case open'],
    send_message: ['Posts this message to the buyer in the dispute thread'],
    provide_evidence: [`Uploads ${p.evidence_type} with ${card.files.length} attachment${card.files.length === 1 ? '' : 's'} to the case`],
    provide_supporting_info: ['Adds these notes to the case for PayPal review'],
    escalate: ['Escalates the inquiry to a claim that PayPal decides'],
    adjudicate: ['Sandbox only: PayPal simulates a decision in your favour'],
    require_evidence: ['Sandbox only: PayPal simulates a request for more evidence'],
  }[card.action] || []
  return [...lines, 'Nothing else: every other PayPal action needs its own card']
}

function Tick({ ok }) {
  return <span className={`dd-tick ${ok ? '' : 'is-no'}`} aria-hidden="true" />
}

// The approval card: what will be sent, who approves it, what PayPal will do and what the server checks first.
export default function ApprovalCard({ card, busy, work, d, kind, label, order }) {
  const field = EDITABLE[card.action]
  const [text, setText] = useState(card.draft ?? '')
  useEffect(() => setText(card.draft ?? ''), [card.id, card.hash, card.draft])
  const [saveState, setSaveState] = useState('idle')
  useEffect(() => setSaveState('idle'), [card.id])
  async function saveDraft() {
    setSaveState('saving')
    try {
      await editCard(card.id, { [field]: text })
      setSaveState('saved')
    } catch {
      setSaveState('failed')
    }
  }
  const dirty = field && text !== (card.draft ?? '')
  const dl = card.deadline
  const amount = moneyOf(card, d)
  const due = dl.dueDate ? new Date(dl.dueDate).toISOString().slice(0, 10) : null
  const blocked = dl.blocked && NEAR_DEADLINE_BLOCKED.has(card.action)
  return (
    <section className="dd-approval" aria-label="Approval card">
      <div className="dd-approval-head">
        <h3 className="dd-approval-title">Approve: {card.label}</h3>
        <span className="dd-mchip m-pending">Pending approval</span>
        {card.createdBy === 'claude' ? <span className="dd-chip">{draftedBy(card.drafter)}</span> : null}
        {card.sandboxSimulation ? <span className="dd-chip is-sim">sandbox simulation</span> : null}
        {amount != null ? <span className="dd-approval-amt">{usd(amount)}</span> : null}
      </div>
      {work ? (
        <div className="dd-sub" title="The tool calls Claude made on the server. The checklist and every amount come from code.">
          {work.source === 'mock' ? 'Offline stand-in (scripted, not a model)' : `Claude (${work.label || LLM_LABEL[work.source] || work.source})`} read: {work.steps.map((x) => x.tool + (x.ok ? '' : ' (rejected)')).join(' > ')}
        </div>
      ) : null}
      <dl className="dd-dl">
        <dt>Action</dt>
        <dd>{card.label}</dd>
        {amount != null ? (
          <>
            <dt>Amount</dt>
            <dd>
              <span className="dd-num">{usd(amount)}</span>
              {card.action === 'accept_claim' ? ' · PayPal fee $0' : ''}
            </dd>
          </>
        ) : null}
        <dt>Case</dt>
        <dd>
          {label ? `${label} · ` : ''}
          <span className="dd-num">{d.dispute_id}</span> · {KIND_LABEL[kind] || kind} · stage {d.dispute_life_cycle_stage}
        </dd>
        {order ? (
          <>
            <dt>Order</dt>
            <dd>{order}</dd>
          </>
        ) : null}
        <dt>Dispute rate</dt>
        <dd>{rateText(card.action)}</dd>
        {card.payload.tracking_info ? (
          <>
            <dt>Tracking</dt>
            <dd>
              {card.payload.tracking_info[0].carrier_name} <span className="dd-num">{card.payload.tracking_info[0].tracking_number}</span>
            </dd>
          </>
        ) : null}
        {card.files.length ? (
          <>
            <dt>Attachment</dt>
            <dd>{card.files.map((f) => `${f.name} (${f.bytes} bytes)`).join(', ')}</dd>
          </>
        ) : null}
      </dl>

      <div className="dd-sec">Who approves</div>
      <dl className="dd-dl">
        <dt>Requested by</dt>
        <dd>{card.createdBy === 'claude' ? 'Claude, as a draft from the Decision Card' : 'You, from the Decision Card'}</dd>
        <dt>Approver</dt>
        <dd>You (store owner). Claude has no PayPal write tool and cannot approve</dd>
        <dt>Approved by</dt>
        <dd>{card.approvedBy || '- (waiting for you)'}</dd>
      </dl>

      <div className="dd-sec">What PayPal will do</div>
      <ul className="dd-pp">
        {paypalDoes(card, amount, order).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {card.action === 'accept_claim' ? (
        <ol className="dd-track" aria-label="Where the money is">
          <li>
            <span className="dd-mchip m-captured">Captured</span>
            <span>Buyer payment, {usd(amount)}</span>
          </li>
          <li className="is-now">
            <span className="dd-mchip m-pending">Pending</span>
            <span>Refund waits for your approval</span>
          </li>
          <li className="is-next">
            <span className="dd-mchip m-held">Held</span>
            <span>UNDER_PAYPAL_REVIEW</span>
          </li>
          <li className="is-next">
            <span className="dd-mchip m-refunded">Refunded</span>
            <span>RESOLVED, SELLER_ISSUED_REFUND</span>
          </li>
        </ol>
      ) : null}

      {field ? <textarea className="dd-draft" aria-label="Draft text" rows={4} value={text} disabled={saveState === 'saving'} onChange={(e) => { setText(e.target.value); setSaveState('idle') }} /> : null}
      <div className="dd-req">
        <span>
          <b>Request</b> <code>POST /v1/customer/disputes/{d.dispute_id}/{PATH[card.action]}</code>
        </span>
        {field ? null : (
          <span>
            Request body: <code>{JSON.stringify(card.payload)}</code>
          </span>
        )}
        <span className="dd-hashline">
          payload sha256 <code>{card.hashShort}..</code> approved by: {card.approvedBy || '-'}
        </span>
      </div>
      {dl.warn ? <div className="dd-callout dd-bad">{dl.blocked ? 'Under 30 minutes to the PayPal deadline: messages and offers are blocked.' : `Under 2 hours to the PayPal deadline (${untilText(dl.remainingMs)} left).`}</div> : null}
      {card.notice ? <div className="dd-callout">{card.notice}</div> : null}

      <div className="dd-sec">Checked before sending</div>
      <ul className="dd-checklist" aria-label="Server checks">
        <li className="dd-check">
          <Tick ok />
          Per-dispute lock taken before sending
        </li>
        <li className="dd-check">
          <Tick ok />
          Dispute re-read: PayPal must still list <code>{PATH[card.action]}</code> in its links
        </li>
        <li className="dd-check">
          <Tick ok={!blocked} />
          {due ? `Due ${due}: ` : 'No deadline: '}
          {blocked ? 'blocked, under 30 minutes left' : 'warning under 2 h, block under 30 min for messages, offers and escalation'}
        </li>
        <li className="dd-check">
          <Tick ok />
          Approval bound to the sha256 of this exact body plus a one-time token
        </li>
      </ul>

      <div className="dd-btnrow">
        <button type="button" className="dd-btn is-primary is-big" disabled={busy || dirty || saveState === 'saving'} onClick={() => approveCard(card).catch(() => {})}>
          {NEXT_STEP[card.action]}
          {amount != null ? ` ${usd(amount)}` : ''}
        </button>
        {field ? (
          <button type="button" className="dd-btn is-big" disabled={busy || !dirty || saveState === 'saving'} onClick={saveDraft}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Retry saving draft' : 'Save draft'}
          </button>
        ) : null}
        <button type="button" className="dd-btn is-big" disabled={busy} onClick={() => rejectCard(card.id).catch(() => {})}>
          Reject
        </button>
        {field ? <span className="dd-sub" role="status">{saveState === 'failed' ? 'Save failed. Your edits are still here.' : dirty ? 'Save your changes before approving.' : saveState === 'saved' ? 'Draft saved. Review it before approving.' : 'Review the draft before approving.'}</span> : null}
      </div>
    </section>
  )
}
