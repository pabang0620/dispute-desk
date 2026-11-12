import React, { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// AG Studio is the heavy part of the bundle: load it as its own chunk so the page shell paints first.
const App = lazy(() => import('./App.jsx'))

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<div className="dd-empty">Loading Dispute Desk</div>}>
      <App />
    </Suspense>
  </React.StrictMode>,
)
