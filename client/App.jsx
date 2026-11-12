import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { AgStudioAiModule, enableStudioDevValidations } from 'ag-studio'
import { useStore, refresh, startPolling, claimCases, resetSession, dismissToast } from './store.js'
import { widgets } from './studio/widgets.jsx'
import { initialState } from './studio/initialState.js'
import { disputeTheme } from './studio/theme.js'
import { buildHarness } from './ai/harness.js'
import RecordedRun from './RecordedRun.jsx'

if (import.meta.env.DEV) enableStudioDevValidations()

const LICENSE = import.meta.env.VITE_AG_STUDIO_LICENSE || ''
const PLACEHOLDER_SCENARIOS = [{ id: 'none', acceptance: 0, label: 'none', bestPlan: '', bestTotal: 0, offerPlan: '', offerTotal: 0, offerWins: '' }]
// Dollar totals keep their cents on the comparison page (the inferred number format rounded $84.52 to 85).
const USD = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) }
const SCENARIO_FIELDS = [
  { id: 'id', format: 'textFormat', hide: true },
  { id: 'acceptance', format: 'integerFormat', name: 'Acceptance %' },
  { id: 'label', format: 'textFormat', name: 'Acceptance' },
  { id: 'bestPlan', format: 'textFormat', name: 'Cheapest plan' },
  { id: 'bestTotal', format: 'currencyFormat', name: 'Cheapest total', formatOptions: USD },
  { id: 'offerPlan', format: 'textFormat', name: 'Offer plan' },
  { id: 'offerTotal', format: 'currencyFormat', name: 'Offer total', formatOptions: USD },
  { id: 'offerWins', format: 'textFormat', name: 'Result' },
]
const TABS = [
  ['queue', "Today's queue"],
  ['plan', 'Rate plan'],
]

function useStudioData() {
  const tables = useStore((s) => s.data?.tables)
  const key = tables ? JSON.stringify([tables.disputes, tables.ratePlan, tables.gauges, tables.scenarios]) : ''
  return useMemo(() => {
    if (!tables) return undefined
    const sources = [
      { id: 'disputes', data: tables.disputes },
      { id: 'ratePlan', data: tables.ratePlan },
      { id: 'gauges', data: tables.gauges },
      { id: 'scenarios', data: tables.scenarios.length ? tables.scenarios : PLACEHOLDER_SCENARIOS, fields: SCENARIO_FIELDS },
    ]
    return { sources }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

export default function App() {
  const studioRef = useRef(null)
  const data = useStore((s) => s.data)
  const error = useStore((s) => s.error)
  const toast = useStore((s) => s.toast)
  const aiSource = useStore((s) => s.aiSource)
  const [page, setPage] = useState('queue')
  const [pages, setPages] = useState(['queue', 'plan'])
  const [recorded, setRecorded] = useState(false)
  const studioData = useStudioData()
  const ai = useMemo(() => ({ api }) => buildHarness(api), [])

  useEffect(() => {
    refresh()
    startPolling()
  }, [])
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(dismissToast, 5000)
    return () => clearTimeout(t)
  }, [toast])

  const syncPages = useCallback((event) => {
    const st = (event?.api ?? studioRef.current?.api)?.getState()
    if (!st) return
    setPages(st.pages.map((p) => p.id))
    setPage(st.selectedPageId)
  }, [])

  const go = (id) => {
    const api = studioRef.current?.api
    if (!api) return
    api.setState({ ...api.getState(), selectedPageId: id })
    setPage(id)
  }

  const claimed = data?.banner && data.view && data.banner.layer
  return (
    <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={LICENSE || undefined}>
      <div className="dd-app">
        <header className="dd-header">
          <div className="dd-brand">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0b5cad" />
              <path d="M8 21h16M10 21v-7m6 7V9m6 12v-5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <span>Dispute Desk</span>
            <span className="dd-store">{data?.view?.store ? 'Juniper Home' : ''}</span>
          </div>
          <nav className="dd-tabs" aria-label="Saved layouts">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={`dd-tab ${page === id ? 'is-on' : ''}`} onClick={() => go(id)}>
                {label}
              </button>
            ))}
            {pages.includes('compare') ? (
              <button type="button" className={`dd-tab ${page === 'compare' ? 'is-on' : ''}`} onClick={() => go('compare')}>
                Acceptance comparison
              </button>
            ) : null}
          </nav>
          <div className="dd-actions">
            {data ? (
              <span className="dd-modes" title="Where Claude and PayPal calls go">
                Claude: {{ live: 'Anthropic API', account: 'Claude Sonnet (local account)' }[data.modes.llm] || 'recorded runs, else scripted stand-in'} · PayPal: {{ sandbox: 'sandbox', hybrid: data.sandboxCase ? `sandbox for case A (${data.sandboxCase}), stand-in for B and C` : 'sandbox demo mode, all real cases used: stand-in' }[data.modes.paypal] || 'sandbox stand-in'}
              </span>
            ) : null}
            {aiSource ? (
              <span className={`dd-modes ${aiSource.source === 'mock' ? '' : 'is-model'}`} title="Who produced the last AI answer on this screen">
                Last AI answer: {aiSource.label}
              </span>
            ) : null}
            <button type="button" className="dd-btn" onClick={claimCases}>
              Claim my cases
            </button>
            <button type="button" className="dd-btn" onClick={() => setRecorded(true)}>
              Recorded run
            </button>
            <button type="button" className="dd-btn" onClick={resetSession} title="Start again with a fresh copy of the demo">
              Reset demo
            </button>
          </div>
        </header>
        {data?.banner ? (
          <div className={`dd-banner layer-${data.banner.layer}`}>
            <b>Path {data.banner.layer}.</b> {data.banner.text} The dispute rate shown is our recalculation, not PayPal's official number.
            {claimed ? null : null}
          </div>
        ) : null}
        {error ? <div className="dd-banner is-error">Could not reach the server: {error}</div> : null}
        <main className="dd-main">
          {studioData ? (
            <AgStudio
              ref={studioRef}
              style={{ height: '100%', width: '100%' }}
              mode="edit"
              data={studioData}
              initialState={initialState}
              widgets={widgets}
              theme={disputeTheme}
              ai={ai}
              panels={{ edit: { left: [], right: ['ai', 'edit'] } }}
              onApiReady={syncPages}
              onStateUpdated={syncPages}
            />
          ) : (
            <div className="dd-loading">Loading Dispute Desk</div>
          )}
        </main>
        {toast ? (
          <div className={`dd-toast ${toast.kind === 'error' ? 'is-error' : ''}`} role="status" onClick={dismissToast}>
            {toast.text}
          </div>
        ) : null}
        {recorded ? <RecordedRun onClose={() => setRecorded(false)} /> : null}
      </div>
    </AgStudioProvider>
  )
}
