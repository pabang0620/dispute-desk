import { useEffect, useState } from 'react'
import { useStore, loadDispute, createCard, editCard, approveCard, rejectCard, buyerAccepts, draftWithClaude } from '../store.js'
import { usd, KIND_LABEL, untilText, LLM_LABEL } from './format.js'

const EDITABLE = { send_message: 'message', make_offer: 'note', escalate: 'note', provide_evidence: 'notes', provide_supporting_info: 'notes' }
const NEXT_STEP = { accept_claim: 'Approve & refund', make_offer: 'Approve & send offer', escalate: 'Approve & escalate', send_message: 'Approve & send message', provide_evidence: 'Approve & submit evidence', provide_supporting_info: 'Approve & submit info', adjudicate: 'Approve sandbox decision', require_evidence: 'Approve sandbox call' }

export default function DecisionCard() {
  const selectedId = useStore((s) => s.selectedId)
  const data = useStore((s) => s.data)
  const busy = useStore((s) => s.busy)
  const drafts = useStore((s) => s.drafts)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const stamp = data ? `${data.view.version}:${data.cards.length}:${data.cards.map((c) => c.status + c.hash.slice(0, 4)).join()}:${data.tables.disputes.map((d) => d.state).join()}` : ''

  useEffect(() => {
    if (!selectedId) return undefined
    let live = true
    loadDispute(selectedId).then((d) => live && (setDetail(d), setError(null))).catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [selectedId, stamp])

  if (!data) return <div className="dd-widget dd-empty">Loading</div>
  if (!selectedId || (!detail && !error)) return <div className="dd-widget dd-empty">{selectedId ? 'Loading the case' : 'Select a case in the planner or the table.'}</div>
  if (error) return <div className="dd-widget dd-empty">{error}</div>

  const d = detail.dispute
  const c = detail.case
  const rels = d.links.map((l) => l.rel)
  const pending = detail.cards.find((x) => x.status === 'PENDING')
  const lastDone = [...detail.cards].reverse().find((x) => x.status === 'EXECUTED' || x.status === 'INVALID' || x.status === 'FAILED')
  const resolved = d.dispute_state === 'RESOLVED'
  const buyerTurn = d.dispute_state === 'REQUIRED_OTHER_PARTY_ACTION' && d.offer?.seller_offered_amount
  const simulated = data.tables.disputes.find((x) => x.id === d.dispute_id)?.simulated

  return (
    <div className="dd-widget dd-decision">
      <div className="dd-title">
        Decision Card: {data.tables.disputes.find((x) => x.id === d.dispute_id)?.label || ''}{' '}
        {KIND_LABEL[detail.kind]} {usd(d.dispute_amount.value)}
      </div>
      <div className="dd-sub">
        {d.dispute_id} · stage {d.dispute_life_cycle_stage} · {d.dispute_state.replaceAll('_', ' ').toLowerCase()}
        {d.seller_response_due_date ? ` · due ${new Date(d.seller_response_due_date).toISOString().slice(0, 10)}` : ''}
        {detail.realSandbox ? <span className="dd-chip is-ok">real PayPal sandbox case</span> : <span className="dd-chip">stand-in case</span>}
      </div>
      <blockquote className="dd-quote">"{d.messages?.[0]?.content}"</blockquote>
      <div className="dd-checklist">
        {detail.checklist.map((i) => (
          <div key={i.id} className={`dd-check ${i.present ? 'is-yes' : 'is-no'}`} title={i.sourceId || 'no source record'}>
            <span aria-hidden="true">{i.present ? '[x]' : '[ ]'}</span> {i.label}
            {i.value ? <em> {String(i.value).slice(0, 70)}</em> : null}
            {i.sourceId ? <code>{i.sourceId}</code> : null}
          </div>
        ))}
        <div className="dd-sub">Store records are demo store data.</div>
      </div>
      {c ? <Options c={c} p={data.view.assumptions.p} /> : null}
      {resolved ? (
        <div className="dd-outcome">
          Resolved: <b>{d.dispute_outcome?.outcome_code}</b> / {d.dispute_outcome?.outcome_reason}
          {d.dispute_outcome?.amount_refunded ? `, refunded ${usd(d.dispute_outcome.amount_refunded.value)}` : ''}
          {simulated ? <span className="dd-chip is-sim">sandbox simulation</span> : null}
        </div>
      ) : null}
      {!detail.writable ? <div className="dd-callout">Writes are limited to your reserved cases. Use "Claim my cases" at the top.</div> : null}
      {pending ? <CardEditor card={pending} busy={busy} work={drafts[pending.disputeId]?.cardId === pending.id ? drafts[pending.disputeId] : null} /> : !resolved && detail.writable ? <Starters c={c} d={d} rels={rels} detail={detail} buyerTurn={buyerTurn} busy={busy} /> : null}
      {lastDone ? (
        <div className={`dd-last ${lastDone.status === 'EXECUTED' ? 'is-ok' : 'is-bad'}`}>
          {lastDone.label}: {lastDone.status.toLowerCase()} {lastDone.notice ? `· ${lastDone.notice}` : ''}
          {lastDone.result?.error ? ` · ${lastDone.result.error}` : ''}
        </div>
      ) : null}
    </div>
  )
}

function Options({ c, p }) {
  const o = c.options
  const act = c.choice.action
  return (
    <div className="dd-options">
      <div className={`dd-opt ${act === 'refund' ? 'is-plan' : ''}`}>
        <b>Refund now</b> {usd(o.refund.cost)} · fee $0 · rate +0 {act === 'refund' ? <span className="dd-chip is-ok">plan</span> : null}
      </div>
      {c.canOffer ? (
        <div className={`dd-opt ${act === 'offer' ? 'is-plan' : ''}`}>
          <b>Offer {usd(o.offer.offerAmount)}</b> accepted: {usd(o.offer.acceptCost)}, rate +0 · declined: escalates, exp. {usd(o.offer.declineExpectedCost)}, rate {c.impact.offer.branches.find((b) => b.tag.split(' ').filter((t) => t.endsWith(':declined')).length === 1 && b.tag.includes(`${c.label}:declined`))?.pct}% {act === 'offer' ? <span className="dd-chip is-ok">plan</span> : null}
        </div>
      ) : null}
      <div className={`dd-opt ${act === 'fight' ? 'is-plan' : ''}`}>
        <b>Fight</b>{' '}
        {o.fight.sellerProtection
          ? 'Seller Protection eligible, fee $0'
          : `lose ${usd(o.fight.loseCost)}${o.fight.loseWithReturn != null ? ` (${usd(o.fight.loseWithReturn)} if the item is returned)` : ''} / win ${usd(o.fight.winCost)}, win chance ${Math.round(p * 100)}% (your assumption)`}
        {act === 'fight' ? <span className="dd-chip is-ok">plan</span> : null}
      </div>
      <ul className="dd-rules">{c.rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  )
}

function Starters({ c, d, rels, detail, buyerTurn, busy }) {
  const draftAction = ['send_message', 'provide_evidence', 'escalate'].find((a) => rels.includes(a))
  const offer = c?.options?.offer?.offerAmount
  const btn = (action, label, params = {}, enabled = true) => (
    <button key={action + label} type="button" className="dd-btn" disabled={!enabled} onClick={() => createCard(d.dispute_id, action, params).catch(() => {})}>
      {label}
    </button>
  )
  return (
    <div className="dd-starters">
      <div className="dd-sub">Nothing is sent to PayPal until you approve a card.</div>
      <div className="dd-btnrow">
        {rels.includes('accept_claim') && btn('accept_claim', `Refund ${usd(d.dispute_amount.value)}`)}
        {rels.includes('make_offer') && c?.canOffer && btn('make_offer', `Offer ${usd(offer)}`, { amount: offer })}
        {rels.includes('escalate') && btn('escalate', 'Fight (escalate)')}
        {rels.includes('send_message') && btn('send_message', 'Send message')}
        {rels.includes('provide_evidence') && btn('provide_evidence', 'Submit evidence')}
        {draftAction && (
          <button type="button" className="dd-btn" disabled={busy} title="Claude reads the dispute and the store order, then drafts a card. Nothing is sent." onClick={() => draftWithClaude(d.dispute_id, draftAction).catch(() => {})}>
            Draft with Claude
          </button>
        )}
        {rels.includes('provide_supporting_info') && btn('provide_supporting_info', 'Supporting info', { notes: 'Additional information for the review.' })}
      </div>
      {rels.includes('adjudicate') || rels.includes('require_evidence') || buyerTurn ? (
        <div className="dd-btnrow dd-sandbox">
          <span className="dd-chip is-sim">sandbox only</span>
          {rels.includes('adjudicate') && btn('adjudicate', 'Sandbox: simulate PayPal decision')}
          {rels.includes('require_evidence') && btn('require_evidence', 'Sandbox: ask for more evidence')}
          {buyerTurn && (
            <button type="button" className="dd-btn" onClick={() => buyerAccepts(d.dispute_id).catch(() => {})}>
              Sandbox: buyer accepts offer
            </button>
          )}
        </div>
      ) : null}
      {!rels.some((r) => r !== 'self') ? <div className="dd-sub">{waitingText(detail.nextChange)}</div> : null}
      {detail.cards.length ? null : null}
    </div>
  )
}

const NEXT_STEP_TEXT = { resolve: 'the case to resolve', buyerTurn: 'the buyer to reply', chargebackSellerTurn: 'the claim stage to open', adjudicateLink: 'the sandbox adjudicate link', requireEvidence: 'the evidence request', settle: 'the case to become actionable' }

// Says what the case is waiting for and until when. The stand-in knows its own schedule; the real sandbox does not.
function waitingText(next) {
  if (next?.live) {
    const secs = Math.max(0, Math.round((Date.now() - new Date(next.since).getTime()) / 1000))
    return `PayPal sandbox is reviewing the refund. Approved at ${new Date(next.since).toLocaleTimeString()}, ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s ago (our sandbox runs resolved in about 1m40s). This screen refreshes until PayPal answers.`
  }
  if (!next) return 'PayPal is reviewing the last action (in our sandbox runs this took about 1 to 4 minutes). This reopens when PayPal allows the next step.'
  const at = new Date(next.at)
  const secs = Math.max(0, Math.round((at.getTime() - Date.now()) / 1000))
  return `PayPal is reviewing the last action. Waiting for ${NEXT_STEP_TEXT[next.step] || 'the next step'}, expected at ${at.toLocaleTimeString()} (about ${secs} s; the stand-in runs the observed sandbox time ${next.timeScale}x faster).`
}

// The chip names who wrote the draft: a scripted stand-in is never called Claude.
function draftedBy(drafter) {
  if (!drafter) return 'drafted by the agent'
  if (drafter.source === 'mock') return 'drafted by offline stand-in'
  if (drafter.source === 'recorded') return drafter.label
  return `drafted by ${drafter.label}`
}

function CardEditor({ card, busy, work }) {
  const field = EDITABLE[card.action]
  const [text, setText] = useState(card.draft ?? '')
  useEffect(() => setText(card.draft ?? ''), [card.id, card.hash, card.draft])
  const dirty = field && text !== (card.draft ?? '')
  const dl = card.deadline
  return (
    <div className="dd-approval">
      <div className="dd-approval-head">
        <b>{card.label}</b>
        {card.createdBy === 'claude' ? <span className="dd-chip">{draftedBy(card.drafter)}</span> : null}
        {card.sandboxSimulation ? <span className="dd-chip is-sim">sandbox simulation</span> : null}
      </div>
      {work ? (
        <div className="dd-sub" title="The tool calls Claude made on the server. The checklist and every amount come from code.">
          {work.source === 'mock' ? 'Offline stand-in (scripted, not a model)' : `Claude (${work.label || LLM_LABEL[work.source] || work.source})`} read: {work.steps.map((x) => x.tool + (x.ok ? '' : ' (rejected)')).join(' > ')}
        </div>
      ) : null}
      {card.payload.offer_amount ? <div className="dd-sub">Offer {usd(card.payload.offer_amount.value)} · {card.payload.offer_type}</div> : null}
      {card.payload.tracking_info ? <div className="dd-sub">Tracking {card.payload.tracking_info[0].carrier_name} {card.payload.tracking_info[0].tracking_number}</div> : null}
      {card.files.length ? <div className="dd-sub">Attachment: {card.files.map((f) => `${f.name} (${f.bytes} bytes)`).join(', ')}</div> : null}
      {field ? (
        <textarea className="dd-draft" aria-label="Draft text" rows={4} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && editCard(card.id, { [field]: text }).catch(() => {})} />
      ) : (
        <div className="dd-sub">Request body: <code>{JSON.stringify(card.payload)}</code></div>
      )}
      {dl.warn ? <div className="dd-callout dd-bad">{dl.blocked ? 'Under 30 minutes to the PayPal deadline: messages and offers are blocked.' : `Under 2 hours to the PayPal deadline (${untilText(dl.remainingMs)} left).`}</div> : null}
      {card.notice ? <div className="dd-callout">{card.notice}</div> : null}
      <div className="dd-hashline">
        payload sha256 <code>{card.hashShort}..</code> approved by: {card.approvedBy || '-'}
        {dirty ? ' · edited, click Update hash' : ''}
      </div>
      <div className="dd-btnrow">
        <button type="button" className="dd-btn is-primary" disabled={busy || dirty} onClick={() => approveCard(card).catch(() => {})}>
          {NEXT_STEP[card.action]}
        </button>
        {field ? (
          <button type="button" className="dd-btn" disabled={busy || !dirty} onClick={() => editCard(card.id, { [field]: text }).catch(() => {})}>
            Update hash
          </button>
        ) : null}
        <button type="button" className="dd-btn" disabled={busy} onClick={() => rejectCard(card.id).catch(() => {})}>
          Reject
        </button>
      </div>
    </div>
  )
}
