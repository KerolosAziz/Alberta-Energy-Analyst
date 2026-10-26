import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadSite } from './lib/data'

// Nothing is drawn until the data is in, so the page never fills in piece by piece.
loadSite().then((site) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App site={site} />
    </StrictMode>,
  ),
)
