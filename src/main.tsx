import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Suppress noisy third-party browser extension, Vite HMR, and transient connection logs
if (typeof window !== 'undefined') {
  const IGNORED_PATTERNS = [
    'MaxListenersExceededWarning',
    'ObjectMultiplex',
    'liveness',
    'powerPreference',
    'requestAdapter',
    'AMADEUS_WALLET',
    'Cross-Origin-Opener-Policy',
    'failed to connect to websocket',
    '[vite] failed to connect',
    'server-options.html#server-hmr',
    'WebSocket connection to',
    'chrome-extension://',
    'Extension context invalidated',
  ]

  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (IGNORED_PATTERNS.some((p) => msg.includes(p))) return
    originalWarn.apply(console, args)
  }

  const originalError = console.error
  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (IGNORED_PATTERNS.some((p) => msg.includes(p))) return
    originalError.apply(console, args)
  }

  // Professional Console Branding
  console.log(
    '%c ⚡ CHIP %c Automation & ESP32 Platform %c Ready ',
    'background:#10b981; color:#ffffff; font-weight:700; padding:2px 6px; border-radius:3px 0 0 3px;',
    'background:#0f172a; color:#38bdf8; font-weight:600; padding:2px 6px;',
    'background:#1e293b; color:#94a3b8; padding:2px 6px; border-radius:0 3px 3px 0;'
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)



