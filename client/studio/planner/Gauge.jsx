import { pct } from '../format.js'

const MAX = 2.5 // scale of the bar in percent

// One rate bar with the 1.5% High Volume line.
export default function Gauge({ label, value, tier, sub, emphasis }) {
  const v = Number(value)
  const high = tier === 'HIGH_VOLUME'
  return (
    <div className={`dd-gauge ${emphasis ? 'is-emphasis' : ''}`}>
      <div className="dd-gauge-head">
        <span className="dd-gauge-label">{label}</span>
        <span className={`dd-gauge-value ${high ? 'is-high' : 'is-ok'}`}>{pct(v)}</span>
        <span className={`dd-chip ${high ? 'is-high' : 'is-ok'}`}>{high ? 'High Volume' : 'Standard'}</span>
      </div>
      <div className="dd-bar" role="img" aria-label={`${label} ${pct(v)}`}>
        <div className={`dd-bar-fill ${high ? 'is-high' : 'is-ok'}`} style={{ width: `${Math.min(v / MAX, 1) * 100}%` }} />
        <div className="dd-bar-line" style={{ left: `${(1.5 / MAX) * 100}%` }} title="1.5% High Volume line" />
      </div>
      {sub ? <div className="dd-sub">{sub}</div> : null}
    </div>
  )
}
