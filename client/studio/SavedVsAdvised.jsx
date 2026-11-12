import { useStore } from '../store.js'
import { usd } from './format.js'

export default function SavedVsAdvised() {
  const data = useStore((s) => s.data)
  if (!data) return <div className="dd-widget dd-empty">Loading</div>
  const { rows, totals, simulatedTotals, note } = data.savings
  return (
    <div className="dd-widget dd-saved">
      <div className="dd-title">Saved vs Advised</div>
      {rows.length === 0 ? (
        <div className="dd-empty">Approve a refund on the Today's queue page to see it here. Results appear when PayPal marks the dispute resolved.</div>
      ) : (
        <table className="dd-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Outcome</th>
              <th>Paid to buyer</th>
              <th>Kept out of rate</th>
              <th>Fee avoided</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.disputeId}>
                <td>
                  {r.disputeId} {r.kind}
                </td>
                <td>
                  {r.reason || r.outcome}
                  {r.simulation ? <span className="dd-chip is-sim">sandbox simulation</span> : null}
                </td>
                <td>{usd(r.paidToBuyer)}</td>
                <td>{r.simulation ? '-' : usd(r.keptOutOfRate)}</td>
                <td>{r.simulation ? `${usd(r.keptRevenue)} kept (simulated)` : usd(r.feeAvoided)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dd-saved-total">
        Fees avoided {usd(totals.feeAvoided)} · kept out of the rate {usd(totals.keptOutOfRate)} · simulated seller-favour endings (not counted) {usd(simulatedTotals.keptRevenue)}
      </div>
      <div className="dd-sub">{note}</div>
    </div>
  )
}
