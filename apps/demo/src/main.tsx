import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, HeroPanel } from './App'
import './styles.css'

// The demo page's React parts: the hero use case, between the static
// placeholder sections and the template section, and the use cases below.
createRoot(document.getElementById('hero-root')!).render(
  <StrictMode>
    <HeroPanel />
  </StrictMode>,
)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
