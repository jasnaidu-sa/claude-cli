console.log('[MAIN] Starting app initialization...')

import React from 'react'
console.log('[MAIN] React imported')
import ReactDOM from 'react-dom/client'
console.log('[MAIN] ReactDOM imported')
import App from './App'
console.log('[MAIN] App imported')
import './styles/globals.css'
console.log('[MAIN] Styles imported')

// Global error handler to catch initialization errors
window.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]', event.error)
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = 'padding: 20px; color: white; background: #1a1a1a; font-family: monospace;'
  const h1 = document.createElement('h1')
  h1.textContent = 'Initialization Error'
  const pre = document.createElement('pre')
  pre.textContent = event.error?.stack || event.error?.message || 'Unknown error'
  errorDiv.appendChild(h1)
  errorDiv.appendChild(pre)
  document.body.appendChild(errorDiv)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED PROMISE REJECTION]', event.reason)
})

try {
  console.log('[MAIN] Creating React root...')
  const rootElement = document.getElementById('root')
  console.log('[MAIN] Root element:', rootElement)

  const root = ReactDOM.createRoot(rootElement!)
  console.log('[MAIN] Root created, rendering App...')

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
  console.log('[MAIN] App render called successfully')
} catch (error) {
  console.error('[RENDER ERROR]', error)
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = 'padding: 20px; color: white; background: #1a1a1a; font-family: monospace;'
  const h1 = document.createElement('h1')
  h1.textContent = 'Failed to render app'
  const pre = document.createElement('pre')
  pre.textContent = error instanceof Error ? error.stack || error.message : String(error)
  errorDiv.appendChild(h1)
  errorDiv.appendChild(pre)
  document.body.appendChild(errorDiv)
}
