import { createWidgets } from 'ag-studio-react'
import DisputeRatePlanner from './DisputeRatePlanner.jsx'
import DecisionCard from './DecisionCard.jsx'
import DeadlineRunway from './DeadlineRunway.jsx'
import SavedVsAdvised from './SavedVsAdvised.jsx'

const icon = (path) => ({ url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0b5cad" stroke-width="2" stroke-linecap="round">${path}</svg>`)}` })

// Each widget is an AG Studio custom widget. `ai.description` lets Studio's own agents add and configure them;
// the form has no data mapping because the widgets read the planner state from the server (and Deadline Runway
// also reads the Studio data engine).
const base = (id, label, comp, description, svg, size) => ({
  id,
  label,
  icon: icon(svg),
  comp,
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  defaultSize: size,
  minSize: { width: 260, height: 160 },
  ai: { description },
})

export const widgets = createWidgets({
  additionalTypes: [
    base('disputeRatePlanner', 'Dispute Rate Planner', DisputeRatePlanner, 'Shows the seller dispute rate that PayPal will apply, what happens if open inquiries become claims, and lets the seller choose refund, offer or fight per case. All numbers come from the server.', '<path d="M4 19h16M7 19v-6M12 19V6M17 19v-9"/>', { width: 820, height: 760 }),
    base('decisionCard', 'Decision Card', DecisionCard, 'Shows the selected dispute with its evidence checklist, the cost of refund, offer and fight, a drafted reply, and the approval button that sends the action to PayPal.', '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>', { width: 520, height: 700 }),
    base('deadlineRunway', 'Deadline Runway', DeadlineRunway, 'Bars for the days left on every open dispute. Clicking a bar cross-filters the dispute table.', '<path d="M4 8h10M4 12h14M4 16h7"/>', { width: 420, height: 320 }),
    base('savedVsAdvised', 'Saved vs Advised', SavedVsAdvised, 'Lists resolved disputes with what was paid, what stayed out of the dispute rate and which fees were avoided. Sandbox simulations are shown apart.', '<path d="M5 12l4 4 10-10"/>', { width: 520, height: 300 }),
  ],
  menu: [{ label: 'Dispute Desk', widgetIds: ['disputeRatePlanner', 'decisionCard', 'deadlineRunway', 'savedVsAdvised'] }],
})
