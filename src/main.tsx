import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerWebMCPTools } from './webmcp/tools'

// Suppress noisy third-party browser extension and WebGPU warnings in dev console
if (typeof window !== 'undefined') {
  const IGNORED_PATTERNS = [
    'MaxListenersExceededWarning',
    'ObjectMultiplex',
    'liveness',
    'powerPreference',
    'requestAdapter',
    'AMADEUS_WALLET',
    'Cross-Origin-Opener-Policy',
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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register CHIP's WebMCP tools once for the page lifetime.
// No-op in browsers without WebMCP (enable chrome://flags/#enable-webmcp-testing to test).
registerWebMCPTools()

