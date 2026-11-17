import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { BASE, registerThrottleWorker } from './mode'
import './styles.css'

// The default buffer of 250 entries fills up quickly on the long gallery.
performance.setResourceTimingBufferSize(2000)
registerThrottleWorker(`${BASE}recipes/`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
