import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initInstallPrompt } from './pwa/install'
import { initAutoUpdate } from './pwa/update'
import './styles.css'

initInstallPrompt()
initAutoUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
