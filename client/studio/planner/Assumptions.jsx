import { useEffect, useState } from 'react'
import { setPlan } from '../../store.js'
import { usd } from '../format.js'

function Slider({ label, hint, value, onCommit }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => draft !== value && onCommit(draft)
  return (
    <label className="dd-slider">
      <span>
        {label} <b>{Math.round(draft * 100)}%</b> <em>(your assumption)</em>
      </span>
      <input type="range" min="0" max="1" step="0.01" value={draft} aria-label={label} title={hint} onChange={(e) => setDraft(Number(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  )
}

export default function Assumptions({ view }) {
  const a = view.assumptions
  const be = Object.entries(view.breakEven || {})
  return (
    <div className="dd-assume">
      <div className="dd-section-title">Assumptions and tier cost</div>
      <div className="dd-assume-row">
        <Slider label="Buyer accepts the offer" hint="q" value={a.q} onCommit={(q) => setPlan({ q })} />
        <Slider label="You win a fight on not-as-described" hint="p" value={a.p} onCommit={(p) => setPlan({ p })} />
      </div>
      <div className="dd-tier">
        <span>
          Tier cost estimate <b>{usd(view.tierCost.total)}</b> = {view.tierCost.parts.map((p) => `${p.count} x ${usd(p.unit)}`).join(' + ')}
        </span>
        <div className="dd-seg" role="group" aria-label="Period">
          <button type="button" className={`dd-seg-btn ${a.period === 'window' ? 'is-on' : ''}`} onClick={() => setPlan({ period: 'window' })}>
            Dec-Feb
          </button>
          <button type="button" className={`dd-seg-btn ${a.period === 'decOnly' ? 'is-on' : ''}`} onClick={() => setPlan({ period: 'decOnly' })}>
            Dec only
          </button>
        </div>
      </div>
      <div className="dd-sub">
        estimate: assumes your next 3 months look like your last 3 (settled at inquiry x $0, exempt claims x $30, other claims x $15) and the rate stays at or above 1.5% while these claims are in the window.
      </div>
      {be.map(([label, v]) => (
        <div className="dd-sub" key={label}>
          Offer on {label} wins above {v.window != null ? `${Math.round(v.window * 1000) / 10}%` : 'n/a'} acceptance (Dec-Feb) or {v.decOnly != null ? `${Math.round(v.decOnly * 1000) / 10}%` : 'n/a'} (Dec only).
        </div>
      ))}
    </div>
  )
}
