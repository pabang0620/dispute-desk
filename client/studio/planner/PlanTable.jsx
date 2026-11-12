import { setPlan } from '../../store.js'
import { usd } from '../format.js'

export default function PlanTable({ view }) {
  const rows = view.plans.slice(0, 6)
  const best = view.recommended
  const current = JSON.stringify(Object.entries(view.cases).map(([, c]) => [c.label, c.choice.action]))
  return (
    <div className="dd-plans">
      <div className="dd-section-title">
        Plans, expected cost over the queue and the tier
        <button type="button" className="dd-link" onClick={() => setPlan({ applyRecommended: true })}>
          Apply recommended
        </button>
      </div>
      <table className="dd-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>What</th>
            <th>Rate</th>
            <th>P(1.5%+)</th>
            <th>Cases</th>
            <th>Tier</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => {
            const isBest = p.id === best.id && p.description === best.text && rows.findIndex((x) => x.description === best.text) === i
            return (
              <tr key={`${p.id}-${p.description}`} className={isBest ? 'is-best' : ''}>
                <td>
                  <strong>{p.id === 'ref' ? 'other' : p.id}</strong> {p.title}
                  {isBest ? <span className="dd-chip is-ok">recommended</span> : null}
                </td>
                <td>{p.description}</td>
                <td>{p.ratesPct.map((r) => `${r.pct}%`).join(' / ')}</td>
                <td>{Math.round(p.pHighVolume * 100)}%</td>
                <td>{usd(p.casesExpected)}</td>
                <td>{usd(p.tierExpected)}</td>
                <td>
                  <strong>{usd(p.total)}</strong>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="dd-sub">
        Recommended: {best.text} at {usd(best.total)}.{' '}
        {view.otherPeriod.changesAdvice ? `With the period set to ${view.otherPeriod.period === 'decOnly' ? 'December only' : 'the whole window'} the best plan is "${view.otherPeriod.bestKey}" at ${usd(view.otherPeriod.bestTotal)}.` : ''}
        <span className="dd-hidden">{current}</span>
      </div>
    </div>
  )
}
