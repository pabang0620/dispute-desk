import { useEffect, useState } from 'react'
import { loadRecorded } from './store.js'

// Layer 3 of the judge paths: real sandbox requests and responses, recorded, played one step at a time.
export default function RecordedRun({ onClose }) {
  const [data, setData] = useState(null)
  const [runIdx, setRunIdx] = useState(0)
  const [step, setStep] = useState(0)
  useEffect(() => {
    loadRecorded().then(setData).catch(() => setData({ runs: [] }))
  }, [])
  if (!data) return null
  const run = data.runs[runIdx]
  const s = run?.steps[step]
  return (
    <div className="dd-modal" role="dialog" aria-label="Recorded run">
      <div className="dd-modal-card">
        <div className="dd-modal-head">
          <b>Recorded run</b>
          <span className="dd-chip">recorded sandbox responses, {run?.recordedOn}</span>
          <button type="button" className="dd-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dd-seg" role="group" aria-label="Choose a run">
          {data.runs.map((r, i) => (
            <button key={r.id} type="button" className={`dd-seg-btn ${i === runIdx ? 'is-on' : ''}`} onClick={() => (setRunIdx(i), setStep(0))}>
              {r.title}
            </button>
          ))}
        </div>
        {s ? (
          <>
            <div className="dd-sub">
              Step {step + 1} of {run.steps.length} · {run.dispute}
            </div>
            <h3>{s.title}</h3>
            {s.note ? <p>{s.note}</p> : null}
            <div className="dd-code-label">
              {s.request.method} {s.request.path} → {s.status}
            </div>
            <pre className="dd-code">{JSON.stringify({ request: s.request.body, response: s.response }, null, 1)}</pre>
            <div className="dd-btnrow">
              <button type="button" className="dd-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </button>
              <button type="button" className="dd-btn is-primary" disabled={step === run.steps.length - 1} onClick={() => setStep(step + 1)}>
                Next
              </button>
            </div>
            <div className="dd-sub">Local run: see README, "Run locally with your own sandbox accounts".</div>
          </>
        ) : null}
        {data.evidence ? <SandboxEvidence ev={data.evidence} /> : null}
        {data.aiRuns?.length ? <AiRuns runs={data.aiRuns} /> : null}
      </div>
    </div>
  )
}

// Today's sandbox results from VERIFY.md by id. Only PASS items are claimed; the rest are listed as not claimed.
function SandboxEvidence({ ev }) {
  return (
    <details className="dd-evidence" open>
      <summary>
        <b>Sandbox evidence</b> (VERIFY.md, {ev.checkedOn})
      </summary>
      <ul>
        {ev.pass.map((x) => (
          <li key={x.id}>
            <b>{x.id} PASS</b> {x.text}
          </li>
        ))}
        {ev.partial.map((x) => (
          <li key={x.id}>
            <b>{x.id} PARTIAL</b> {x.text}
          </li>
        ))}
      </ul>
      <div className="dd-sub">Not claimed: {ev.notClaimed.map((x) => `${x.id} (${x.text})`).join(' ')}</div>
    </details>
  )
}

// The real model runs the offline demo replays: what each agent was asked and the tools it chose, in order.
function AiRuns({ runs }) {
  return (
    <details className="dd-evidence">
      <summary>
        <b>Recorded AI runs</b> ({runs[0].label}, local Claude Code account, no API key)
      </summary>
      <ul>
        {runs.map((r) => (
          <li key={r.key}>
            <b>{r.agent}</b> ({r.seconds} s model time): {r.toolCalls.join(' > ') || 'answered in text'}
            <div className="dd-sub">Asked: {r.question}</div>
            {r.finalText ? <div className="dd-sub">Said: {r.finalText}</div> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
