// Adds (or reuses) the "Acceptance comparison" page: a column chart and a grid over the `scenarios` table.
// The dispute-analyst calls this through its show_scenario_comparison tool after the server calculator returned the rows.
export function applyScenarioComparison(api, title) {
  const state = api.getState()
  if (state.pages.some((p) => p.id === 'compare')) {
    api.setState({ ...state, selectedPageId: 'compare' })
    return false
  }
  const page = {
    id: 'compare',
    widgets: {
      chart: {
        type: 'column-chart-grouped',
        dataMapping: {
          categoryKey: [{ id: 'scenarios.label' }],
          valueKey: [
            { id: 'scenarios.bestTotal', aggregation: 'sum' },
            { id: 'scenarios.offerTotal', aggregation: 'sum' },
          ],
        },
        format: { title: { text: title || 'Best plan total vs offer plan total, by buyer acceptance %', enabled: true }, style: { theme: { common: { legend: { enabled: true } } } } },
      },
      rows: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'scenarios.label' },
            { id: 'scenarios.bestPlan' },
            { id: 'scenarios.bestTotal' },
            { id: 'scenarios.offerTotal' },
            { id: 'scenarios.offerWins' },
          ],
        },
        format: { title: { text: 'Plan totals ($)', enabled: true } },
      },
    },
    widgetLayout: {
      chart: { xTrack: 0, yTrack: 0, xSpan: 10, ySpan: 22 },
      rows: { xTrack: 10, yTrack: 0, xSpan: 14, ySpan: 22 },
    },
  }
  api.setState({ ...state, pages: [...state.pages, page], selectedPageId: 'compare' })
  return true
}
