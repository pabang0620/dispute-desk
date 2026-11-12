import { setPlan, select, useStore } from '../../store.js'
import { usd, rangeText, shortDate, KIND_LABEL } from '../format.js'

const ACTIONS = [
  ['refund', 'Refund'],
  ['offer', 'Offer'],
  ['fight', 'Fight'],
]

export default function CaseRow({ c, view }) {
  const selected = useStore((s) => s.selectedId) === c.disputeId
  const action = c.choice.action
  const o = c.options
  const impact = c.impact?.[action]
  const declined = impact?.branches?.find((b) => b.tag.split(' ').filter((t) => t.endsWith(':declined')).length === 1 && b.tag.includes(`${c.label}:declined`))
  const cost = action === 'refund' ? o.refund.cost : action === 'offer' ? o.offer.expectedCost : o.fight.expectedCost
  return (
    <div className={`dd-case ${selected ? 'is-selected' : ''}`} onClick={() => select(c.disputeId)}>
      <div className="dd-case-top">
        <strong className="dd-case-label">{c.label}</strong>
        <span className="dd-case-id">{c.disputeId}</span>
        <span className="dd-case-kind">{KIND_LABEL[c.kind]}</span>
        <span className="dd-case-amount">{usd(c.amount)}</span>
        <div className="dd-seg" role="group" aria-label={`Plan for case ${c.label}`}>
          {ACTIONS.map(([key, text]) => {
            const disabled = key === 'offer' && !c.canOffer
            return (
              <button
                key={key}
                type="button"
                className={`dd-seg-btn ${action === key ? 'is-on' : ''}`}
                disabled={disabled}
                title={disabled ? (c.spEligible ? 'Seller Protection eligible: no offer needed' : 'The offer must be below the disputed amount') : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  setPlan({ choices: { [c.label]: { action: key } } })
                }}
              >
                {key === 'offer' ? `Offer ${usd(view.assumptions.offerAmount)}` : text}
              </button>
            )
          })}
        </div>
      </div>
      <div className="dd-case-line">
        <span>{action === 'refund' ? '+$0 to the rate' : `+${usd(c.amount)} to the rate${action === 'offer' ? ' if declined' : ''}`}</span>
        <span>expected cost {usd(cost)}</span>
        {c.spEligible ? <span className="dd-good">Seller Protection eligible, fee $0</span> : null}
        {action === 'offer' && declined ? (
          <span className={declined.tier === 'HIGH_VOLUME' ? 'dd-bad' : ''}>
            {Math.round(view.assumptions.q * 100)}% chance it is accepted; if declined the rate reaches {declined.pct}% ({declined.tier === 'HIGH_VOLUME' ? 'High Volume' : 'Standard'})
          </span>
        ) : null}
        {action === 'offer' ? <span className="dd-note">per case the offer looks cheapest: {usd(o.offer.expectedCost)} vs refund {usd(o.refund.cost)}</span> : null}
      </div>
      <div className="dd-case-line dd-muted">
        If escalated now: counts for disputes created {rangeText(c.counts)}, drops out {shortDate(c.counts.dropsOut)}
      </div>
    </div>
  )
}
