// import './assets/main.css'
import './assets/index.css'
import './browser-shim'   // ← mock window.api when running in browser (non-Electron)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
