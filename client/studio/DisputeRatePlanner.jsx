import { useStore, setPlan } from '../store.js'
import Gauge from './planner/Gauge.jsx'
import CaseRow from './planner/CaseRow.jsx'
import PlanTable from './planner/PlanTable.jsx'
import Assumptions from './planner/Assumptions.jsx'
import { usd, shortDate } from './format.js'

export default function DisputeRatePlanner() {
  const data = useStore((s) => s.data)
  const loading = useStore((s) => s.loading)
  if (loading || !data) return <div className="dd-widget dd-empty">Loading the queue</div>
  const { view } = data
  if (view.empty) return <div className="dd-widget dd-empty">No open PayPal disputes.</div>
  const g = view.gauges
  const a = view.assumptions
  const split = g.plan.branches.length > 1
  // With several offers there are many accept/decline combinations: show the best and the worst one.
  const sorted = [...g.plan.branches].sort((x, y) => Number(x.pct) - Number(y.pct))
  const shown = sorted.length > 2 ? [sorted[0], sorted[sorted.length - 1]] : g.plan.branches
  return (
    <div className="dd-widget dd-planner">
      <div className="dd-planner-head">
        <div>
          <div className="dd-title">Dispute Rate Planner</div>
          <div className="dd-sub">
            Rate for disputes created in <b>{view.appliesTo.monthLabel}</b> (claims window {view.appliesTo.windowText})
          </div>
        </div>
        <div className="dd-planner-tools">
          <div className="dd-seg" role="group" aria-label="Window assumption">
            <button type="button" className={`dd-seg-btn ${a.windowAssumption === 'a' ? 'is-on' : ''}`} onClick={() => setPlan({ windowAssumption: 'a' })} title="Window = the 3 full months before the dispute is created; claims belong to the month they were escalated">
              Window (a)
            </button>
            <button type="button" className={`dd-seg-btn ${a.windowAssumption === 'b' ? 'is-on' : ''}`} onClick={() => setPlan({ windowAssumption: 'b' })} title="Rolling window that includes the current month">
              Window (b)
            </button>
          </div>
          <a className="dd-link" href={data.resolutionCenterUrl} target="_blank" rel="noreferrer">
            Official rate: Resolution Center
          </a>
        </div>
      </div>
      <div className="dd-source">
        source: {view.ledgerSource} ({view.store.salesCount} sales, {usd(view.store.netSales)} net in 3 months). Disputes are PayPal sandbox disputes. This rate is our recalculation, not PayPal's official number.
      </div>
      <Gauge label="Counted so far (escalated claims only)" value={g.counted.pct} tier={g.counted.tier} />
      <Gauge label={`If all ${view.cases.length} open inquiries become claims`} value={g.worst.pct} tier={g.worst.tier} />
      {split ? (
        shown.map((b) => (
          <Gauge
            key={b.tag}
            label={`With this plan, ${b.tag.replaceAll(':', ' ')} (${Math.round(b.prob * 100)}%)`}
            value={b.pct}
            tier={b.tier}
            emphasis
            sub={b.tag.includes('declined') ? `Declined offers escalate: claims ${usd(b.claims)}` : undefined}
          />
        ))
      ) : (
        <Gauge label="With this plan" value={g.plan.branches[0].pct} tier={g.plan.branches[0].tier} emphasis />
      )}
      {split ? <div className="dd-callout">Chance of reaching 1.5% or more with this plan: {Math.round(g.plan.pHighVolume * 100)}%</div> : null}
      <div className="dd-cases">
        {view.cases.map((c) => (
          <CaseRow key={c.disputeId} c={c} view={view} />
        ))}
      </div>
      {view.claimsStage.length ? (
        <div className="dd-sub">
          Already claims (counted, not planned):{' '}
          {view.claimsStage.map((c) => `${c.disputeId} ${usd(c.amount)} escalated ${shortDate(c.escalatedOn)}, counts for disputes created ${shortDate(c.counts.from)} - ${shortDate(c.counts.to)}`).join('; ')}
        </div>
      ) : null}
      <PlanTable view={view} />
      <Assumptions view={view} />
      <details className="dd-counted">
        <summary>Claims counted so far ({view.counted.length})</summary>
        <ul>
          {view.counted.map((c) => (
            <li key={c.id}>
              {c.label}: {usd(c.amount)}, escalated {shortDate(c.escalatedOn)}, drops out {shortDate(c.dropsOutOn)}
            </li>
          ))}
        </ul>
      </details>
      <div className="dd-sentence">{view.sentence}</div>
      <div className="dd-reco">recommended under your assumptions</div>
    </div>
  )
}
