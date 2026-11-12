import { studioTheme } from 'ag-studio'

// Clear Ledger Blue: one light theme for sellers. Same values as the CSS tokens in styles.css,
// so Studio chrome (params) and our widgets (CSS variables) read as one surface.
export const disputeTheme = studioTheme.withParams(
  {
    backgroundColor: '#f4f7fb',
    foregroundColor: '#14233a',
    accentColor: '#0b5cad',
    borderColor: '#e1e7ef',
    borderRadius: 10,
    fontFamily: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
    studioCanvasBackgroundColor: '#f4f7fb',
    studioWidgetBackgroundColor: '#ffffff',
    studioWidgetBorderRadius: 14,
    studioWidgetBorder: { style: 'solid', width: 1, color: '#e1e7ef' },
    studioWidgetShadow: '0 1px 2px rgba(20,35,58,.06)',
    studioWidgetTitleTextColor: '#14233a',
    studioWidgetCaptionTextColor: '#5a6b82',
    studioPanelContainerBackgroundColor: '#ffffff',
    studioPanelHeaderFontFamily: ['Inter', 'system-ui', 'sans-serif'],
    studioToggleButtonActiveBackgroundColor: '#0b5cad',
    studioToggleButtonActiveColor: '#ffffff',
    chartTextColor: '#14233a',
    chartGridLineColor: '#e1e7ef',
    browserColorScheme: 'light',
  },
  'dispute-desk',
)
