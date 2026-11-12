// Layouts: "queue" (Today's queue) and "plan" (Rate plan). Studio pages are the saved layouts; the tab bar switches them.
export const initialState = {
  selectedPageId: 'queue',
  panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { width: 340 } },
  pages: [
    {
      id: 'queue',
      widgets: {
        planner: { type: 'disputeRatePlanner', dataMapping: {} },
        decision: { type: 'decisionCard', dataMapping: {} },
        runway: { type: 'deadlineRunway', dataMapping: {} },
        table: {
          type: 'grid',
          dataMapping: {
            cols: [{ id: 'disputes.label' }, { id: 'disputes.id' }, { id: 'disputes.reason' }, { id: 'disputes.stage' }, { id: 'disputes.amount' }, { id: 'disputes.daysLeft' }, { id: 'disputes.plan' }, { id: 'disputes.state' }],
          },
          format: { title: { text: 'Open disputes', enabled: true } },
        },
      },
      widgetLayout: {
        planner: { xTrack: 0, yTrack: 0, xSpan: 13, ySpan: 60 },
        decision: { xTrack: 13, yTrack: 0, xSpan: 11, ySpan: 38 },
        runway: { xTrack: 13, yTrack: 38, xSpan: 11, ySpan: 11 },
        table: { xTrack: 13, yTrack: 49, xSpan: 11, ySpan: 11 },
      },
    },
    {
      id: 'plan',
      widgets: {
        saved: { type: 'savedVsAdvised', dataMapping: {} },
        byReason: {
          type: 'column-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'disputes.reason' }], valueKey: [{ id: 'disputes.amount', aggregation: 'sum' }] },
          format: { title: { text: 'Disputed amount by reason', enabled: true } },
        },
        plans: {
          type: 'grid',
          dataMapping: { cols: [{ id: 'ratePlan.id' }, { id: 'ratePlan.description' }, { id: 'ratePlan.worstPct' }, { id: 'ratePlan.casesExpected' }, { id: 'ratePlan.tierExpected' }, { id: 'ratePlan.total' }] },
          format: { title: { text: 'Plan totals (expected cost)', enabled: true } },
        },
        gauges: {
          type: 'column-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'gauges.label' }], valueKey: [{ id: 'gauges.pct', aggregation: 'sum' }] },
          format: { title: { text: 'Dispute rate, % (line: 1.5)', enabled: true } },
        },
      },
      widgetLayout: {
        gauges: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 18 },
        plans: { xTrack: 8, yTrack: 0, xSpan: 16, ySpan: 18 },
        saved: { xTrack: 0, yTrack: 18, xSpan: 14, ySpan: 18 },
        byReason: { xTrack: 14, yTrack: 18, xSpan: 10, ySpan: 18 },
      },
    },
  ],
}
