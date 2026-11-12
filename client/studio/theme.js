import { studioTheme } from 'ag-studio'

// One light theme for sellers, tuned to the dashboard colors in styles.css.
export const disputeTheme = studioTheme.withParams(
  {
    backgroundColor: '#f6f8fb',
    foregroundColor: '#14233a',
    accentColor: '#0b5cad',
    borderRadius: 10,
    fontFamily: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
    browserColorScheme: 'light',
  },
  'dispute-desk',
)
