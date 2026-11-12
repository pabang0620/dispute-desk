import { useEffect, useMemo, useState } from 'react'
import { useStore, select } from '../store.js'
import { usd } from './format.js'

const FIELDS = ['id', 'label', 'kind', 'amount', 'daysLeft', 'plan', 'group', 'stage']

// Deadline bars. Rows come from Studio's data engine through widgetApi.getData, so page filters and cross filters
// from other widgets apply; clicking a bar sets a cross filter on dispute id, which filters the grid widget.
export default function DeadlineRunway({ widgetApi }) {
  const data = useStore((s) => s.data)
  const selectedId = useStore((s) => s.selectedId)
  const [engineRows, setEngineRows] = useState(null)
  const [selection, setSelection] = useState(null)
  const stamp = data ? data.tables.disputes.map((d) => `${d.id}${d.daysLeft}${d.plan}${d.state}`).join() : ''

  useEffect(() => {
    if (!widgetApi?.getData) return undefined
    let live = true
    // Query fields are the schema's own field objects, looked up by id.
    const table = widgetApi.getSchema?.().find((t) => t.id === 'disputes')
    const fields = FIELDS.map((f) => table?.fields.find((x) => x.fieldId === `disputes.${f}` || x.id === `disputes.${f}`)).filter(Boolean)
    if (fields.length !== FIELDS.length) {
      setEngineRows(null)
      return undefined
    }
    widgetApi
      .getData({ fields }, { queryId: 'runway', crossFilter: 'none' })
      .then((resp) => {
        if (!live || resp.replaced) return
        const rows = resp.results?.rows || []
        setEngineRows(rows.map((r) => Object.fromEntries(fields.map((f, i) => [FIELDS[i], r[f.key] ?? r[f.fieldId] ?? r[FIELDS[i]]]))))
      })
      .catch(() => live && setEngineRows(null))
    return () => {
      live = false
    }
  }, [widgetApi, stamp])

  // Reading the selections in render makes Studio refresh this widget whenever the cross filter changes, including
  // when another widget clears it. The field object comes from the schema: Studio needs its own reference, not an id string.
  const active = widgetApi?.getCrossFilterSelections?.()
  const selectedByFilter = active?.length ? active[0].values : null
  const idField = useMemo(() => widgetApi?.getSchema?.().find((t) => t.id === 'disputes')?.fields.find((f) => f.fieldId === 'disputes.id' || f.id === 'disputes.id'), [widgetApi])

  const rows = useMemo(() => {
    const base = engineRows && engineRows.length ? engineRows : (data?.tables.disputes || [])
    return base.filter((r) => r.group !== 'resolved').sort((a, b) => a.daysLeft - b.daysLeft)
  }, [engineRows, data])

  if (!data) return <div className="dd-widget dd-empty">Loading</div>
  const max = Math.max(21, ...rows.map((r) => r.daysLeft))
  return (
    <div className="dd-widget dd-runway">
      <div className="dd-title">Deadline Runway</div>
      <div className="dd-sub">Seller response windows: inquiry 20 days, claim 10 days, evidence request 3 days. Click a bar to filter the table.</div>
      {rows.length === 0 ? <div className="dd-empty">Nothing waiting for you.</div> : null}
      {rows.map((r) => (
        <button
          type="button"
          key={r.id}
          className={`dd-run ${selectedId === r.id ? 'is-selected' : ''}`}
          onClick={() => {
            select(r.id)
            if (!idField) return
            widgetApi.toggleCrossFilter({ type: 'value', field: idField, value: r.id, group: 0 })
            setSelection(widgetApi.getCrossFilterSelections?.()?.[0]?.values ?? null)
          }}
        >
          <span className="dd-run-name">
            {r.label || r.id.slice(-6)} {r.kind} {usd(r.amount)}
          </span>
          <span className="dd-run-track">
            <span className={`dd-run-bar ${r.daysLeft <= 3 ? 'is-urgent' : r.group === 'claim' ? 'is-claim' : ''}`} style={{ width: `${Math.max(4, (r.daysLeft / max) * 100)}%` }} />
          </span>
          <span className="dd-run-days">{r.daysLeft}d</span>
        </button>
      ))}
      <div className="dd-run-foot">
        {selectedByFilter || selection ? (
          <button
            type="button"
            className="dd-link"
            onClick={() => {
              widgetApi?.resetCrossFilter?.()
              setSelection(null)
            }}
          >
            Clear filter
          </button>
        ) : (
          <span className="dd-sub">{engineRows ? 'rows from the Studio data engine' : 'rows from the server'}</span>
        )}
      </div>
    </div>
  )
}
