import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// The demo page's React parts: the use cases after the static placeholder
// sections, and the other sources after the static template section.
for (const [id, part] of [['cases-root', 'main'], ['more-root', 'more']] as const) {
  createRoot(document.getElementById(id)!).render(
    <StrictMode>
      <App part={part} />
    </StrictMode>,
  )
}
