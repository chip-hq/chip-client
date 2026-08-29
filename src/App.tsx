/**
 * Chip Dashboard Client
 * Copyright (c) 2026 Chip.
 * Licensed under the MIT License. See LICENSE for details.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import chipLogo from './assets/ChipLogo.png'
import { ESPLoader, Transport } from 'esptool-js'
import type { IEspLoaderTerminal } from 'esptool-js'
import type { User } from 'firebase/auth'
import { useFirebaseAuth } from './components/useAuth'
import { AuthorizeModal } from './components/AuthorizeModal'
import { SettingsModal } from './components/SettingsModal'
import { CompanionPreview } from './components/CompanionPreview'
import { Sidebar, type TabType } from './components/Sidebar'
import { AlertToast, type AlertItem, type AlertType } from './components/AlertToast'
import { HistoryView } from './components/HistoryView'
import { setDashboardActionProvider, setDashboardSnapshotProvider } from './webmcp/tools'
import { buildAgentPrompt, getWebMCPUrl } from './webmcp/room'
import { AgentSidebar } from './components/AgentSidebar'
import './App.css'

const WEB_SERIAL_OK = typeof navigator !== 'undefined' && 'serial' in navigator
const BAUD_RATES = [9600, 74880, 115200, 230400, 460800, 921600]

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://chip-backend-production-fe14.up.railway.app'
const MCP_URL = (import.meta.env.VITE_MCP_URL || 'https://chip-mcp-server.onrender.com').replace(/\/+$/, '') + '/mcp'
const WS_URL = BACKEND_URL.replace(/^http/, 'ws')

// ── Domain types ────────────────────────────────────────────────────────────
type Status = 'idle' | 'connecting' | 'connected' | 'flashing' | 'done' | 'error'
type JobPhase = 'compile' | 'flash'
type JobState = 'pending' | 'compiling' | 'started' | 'uploading' | 'done' | 'error'

interface FirmwareFile {
  name: string
  size: number
  data: Uint8Array
}

interface FlashPayloadMessage {
  type: 'flash_payload'
  jobId?: string
  filename?: string
  offset?: string
  binBase64: string
  webCompanion?: string
}

interface ActiveJob {
  jobId: string
  phase: JobPhase
  status: JobState
  progress: number
  log: string[]
}

interface JobStatusResponse {
  jobId: string
  phase?: JobPhase
  status: JobState
  progress?: number
  log?: string[]
  error?: string
  filename?: string
  webCompanion?: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}

function parseOffset(raw: string): number {
  const clean = raw.trim()
  return clean.startsWith('0x') || clean.startsWith('0X')
    ? parseInt(clean, 16)
    : parseInt(clean, 10)
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Map flash progress percentage to named stages
const FLASH_STAGES = ['Connecting', 'Erasing', 'Writing', 'Verifying', 'Done']

function getFlashStage(progress: number): string {
  if (progress === 0) return 'Connecting'
  if (progress < 15) return 'Erasing'
  if (progress < 90) return 'Writing'
  if (progress < 100) return 'Verifying'
  return 'Done'
}

export default function App() {
  const { user, loading, error, signIn, logOut } = useFirebaseAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])

  const showAlert = useCallback((type: AlertType, message: string, title?: string) => {
    const id = Math.random().toString(36).substring(2, 9)
    setAlerts((prev) => [...prev, { id, type, message, title }])
  }, [])

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }, [])

  // Surface auth errors from the external auth system as a toast — an intentional
  // notification triggered by an error-state change, not derived render state.
  useEffect(() => {
    if (error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external auth error
      showAlert('error', error, 'Authentication')
    }
  }, [error, showAlert])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center">
        <div className="bg-white border border-[#e5e5e5] p-8 text-center">
          <span className="sp-spinner" aria-hidden="true" />
        </div>
      </div>
    )
  }

  const params = new URLSearchParams(window.location.search)
  const authSessionId = params.get('sessionId')

  if (!user) {
    return (
      <>
        <SignInScreen onSignIn={signIn} />
        <AlertToast alerts={alerts} onDismiss={dismissAlert} />
      </>
    )
  }

  if (authSessionId) {
    return (
      <>
        <AuthorizeModal
          user={user}
          sessionId={authSessionId}
          backendUrl={BACKEND_URL}
          mcpUrl={MCP_URL}
        />
        <AlertToast alerts={alerts} onDismiss={dismissAlert} />
      </>
    )
  }

  return (
    <>
      <Flasher user={user} onSignOut={logOut} showAlert={showAlert} />
      <AlertToast alerts={alerts} onDismiss={dismissAlert} />
    </>
  )
}

// ── Sign-in gate ──────────────────────────────────────────────────────────────
interface SignInScreenProps {
  onSignIn: () => void
}

function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#f0f0f0] select-none">
      {/* Left Column — Login Form */}
      <div className="w-full lg:w-[460px] p-8 sm:p-12 lg:p-16 flex flex-col justify-between shrink-0 bg-white border-r border-[#e5e5e5]">
        {/* Top Logo */}
        <div>
          <div className="flex items-center gap-2.5 mb-12">
            <img src={chipLogo} alt="Chip" className="w-6 h-6 rounded object-contain" />
            <span className="font-semibold text-base tracking-tight text-black">Chip</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-black tracking-tight mb-2">
              Log in to your account
            </h1>
            <p className="text-xs text-[#666666] leading-relaxed">
              Connect your ESP32 hardware to AI agents and web flashing tools.
            </p>
          </div>

          {/* Google Sign-in Button */}
          <div className="space-y-3 mb-6">
            <button
              className="w-full bg-white hover:bg-[#fafafa] text-black font-medium py-3 px-4 rounded border border-[#d1d5db] hover:border-black transition-all flex items-center justify-center gap-3 text-sm cursor-pointer shadow-xs"
              onClick={onSignIn}
            >
              <GoogleIcon />
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#e5e5e5]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-[#888888]">Instant setup</span>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="space-y-3 text-xs text-[#555555]">
            <div className="flex items-center gap-2">
              <span className="text-[#16a34a] font-bold">✓</span>
              <span>No toolchains, Arduino IDE, or Python CLI needed</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#16a34a] font-bold">✓</span>
              <span>Direct USB Web Serial flashing at up to 921.6k baud</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#16a34a] font-bold">✓</span>
              <span>Model Context Protocol (MCP) agent connection</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-8 text-[11px] text-[#888888]">
          Protected by OAuth 2.1 & Web Serial API.
        </div>
      </div>

      {/* Right Column — Topographic Emerald Halftone Hero Panel */}
      <div className="flex-1 p-3 sm:p-4 flex items-stretch">
        <div className="flex-1 bg-[#030a05] border border-[#0d2814] rounded-2xl p-8 sm:p-12 flex flex-col justify-center text-white relative overflow-hidden shadow-2xl">
          {/* Glowing Emerald Ambient Light */}
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#00e676]/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-[#10b981]/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-[#052e16]/80 rounded-full blur-2xl pointer-events-none" />

          {/* Topographic Elevation Contour Map Background Lines */}
          <svg
            className="absolute inset-0 w-full h-full object-cover opacity-65 pointer-events-none select-none"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 800 800"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="contourGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00e676" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#10b981" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0.15" />
              </linearGradient>
              <pattern id="dotHalftone" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#00e676" fillOpacity="0.22" />
              </pattern>
            </defs>

            {/* Halftone Dot Grid */}
            <rect width="100%" height="100%" fill="url(#dotHalftone)" />

            {/* Organic Topographic Contour Paths */}
            <path d="M-100,150 C120,80 250,280 450,180 C650,80 720,250 900,200" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" />
            <path d="M-100,220 C100,160 220,340 430,260 C640,180 700,320 900,280" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.9" />
            <path d="M-100,300 C80,240 200,420 400,340 C600,260 680,400 900,360" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.8" />
            <path d="M-100,380 C60,320 180,500 380,420 C580,340 660,480 900,440" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.75" />
            <path d="M-100,460 C40,400 160,580 360,500 C560,420 640,560 900,520" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.7" />
            <path d="M-100,540 C20,480 140,660 340,580 C540,500 620,640 900,600" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.65" />
            <path d="M-100,620 C0,560 120,740 320,660 C520,580 600,720 900,680" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.55" />
            <path d="M-100,700 C-20,640 100,820 300,740 C500,660 580,800 900,760" fill="none" stroke="url(#contourGrad)" strokeWidth="1.5" opacity="0.45" />

            {/* Accent Elevation Nodes */}
            <circle cx="450" cy="180" r="3" fill="#00e676" />
            <circle cx="430" cy="260" r="3" fill="#00e676" opacity="0.8" />
            <circle cx="400" cy="340" r="3" fill="#00e676" opacity="0.6" />
            <circle cx="380" cy="420" r="3" fill="#00e676" opacity="0.5" />
          </svg>

          {/* Hero Content — center-left aligned */}
          <div className="relative z-10 max-w-xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#00e676]/10 border border-[#00e676]/30 text-[#00e676] text-[11px] font-mono font-medium mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e676] animate-pulse" />
              <span>HARDWARE AGENT PLATFORM</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight mb-4 text-white">
              Build, compile & flash ESP32 firmware with AI agents in real time.
            </h2>

            <p className="text-sm text-white/70 leading-relaxed mb-10 font-normal">
              Connect your ESP32 boards directly to your favorite AI agent via Model Context Protocol (MCP). Compile, flash, and iterate on hardware projects straight from your browser.
            </p>

            {/* Quick Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 border-t border-white/10">
              <div className="bg-[#06190c]/80 border border-[#143e1d] p-3.5 rounded-xl backdrop-blur-xs">
                <div className="text-lg font-bold text-white font-mono">0s</div>
                <div className="text-xs text-white/55 mt-0.5">Zero CLI Setup</div>
              </div>
              <div className="bg-[#06190c]/80 border border-[#143e1d] p-3.5 rounded-xl backdrop-blur-xs">
                <div className="text-lg font-bold text-[#00e676] font-mono">MCP</div>
                <div className="text-xs text-white/55 mt-0.5">Any AI Agent</div>
              </div>
              <div className="bg-[#06190c]/80 border border-[#143e1d] p-3.5 rounded-xl backdrop-blur-xs">
                <div className="text-lg font-bold text-white font-mono">921.6k</div>
                <div className="text-xs text-white/55 mt-0.5">High Speed USB</div>
              </div>
            </div>
          </div>

          {/* Bottom Tagline */}
          <div className="absolute bottom-6 left-8 sm:left-12 text-[11px] text-[#00e676]/40 font-mono">
            CHIP // MODEL CONTEXT PROTOCOL FLASHER
          </div>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg className="gbtn-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

function BaudDropdown({
  value,
  onChange,
  disabled,
  options,
}: {
  value: number
  onChange: (val: number) => void
  disabled?: boolean
  options: number[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="h-8 px-2.5 bg-white border border-[#d1d5db] hover:border-black rounded text-xs font-mono text-black flex items-center justify-between gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
      >
        <span>{value}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-[#666666] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[120px] bg-white border border-[#e5e5e5] rounded shadow-md py-1 animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="px-2.5 py-1 text-[10px] uppercase font-semibold text-[#888888] tracking-wider border-b border-[#f0f0f0] mb-0.5">
            Baud Rate
          </div>
          {options.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                onChange(b)
                setOpen(false)
              }}
              className={`w-full px-2.5 py-1.5 text-xs font-mono text-left flex items-center justify-between transition-colors cursor-pointer ${
                b === value ? 'bg-[#f0f0f0] text-black font-semibold' : 'text-[#444444] hover:bg-[#fafafa] hover:text-black'
              }`}
            >
              <span>{b}</span>
              {b === value && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Flasher Dashboard Component ─────────────────────────────────────────
interface FlasherProps {
  user: User
  onSignOut: () => void
  showAlert: (type: AlertType, message: string, title?: string) => void
}

function Flasher({ user, onSignOut, showAlert }: FlasherProps) {
  const [chip, setChip] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [baud, setBaud] = useState(115200)
  const [file, setFile] = useState<FirmwareFile | null>(null)
  const [offset, setOffset] = useState('0x10000')
  const [eraseAll, setEraseAll] = useState(false)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [cloudConnected, setCloudConnected] = useState(false)
  const [agentConnected, setAgentConnected] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard')
  const [setupSubTab, setSetupSubTab] = useState<'webmcp' | 'mcp'>('webmcp')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(true)

  // Auto-open agent sidebar whenever an agent posts a message
  useEffect(() => {
    const handler = () => setAgentSidebarOpen(true)
    window.addEventListener('chip:agent-message', handler)
    return () => window.removeEventListener('chip:agent-message', handler)
  }, [])
  const [activeConsoleTab, setActiveConsoleTab] = useState<'log' | 'preview'>('log')
  const [activeCompanionHtml, setActiveCompanionHtml] = useState<string | null>(null)
  const [activeCompanionTitle, setActiveCompanionTitle] = useState<string | null>(null)
  const [companionEnabled, setCompanionEnabled] = useState(() => {
    return localStorage.getItem('chip_web_companion_enabled') !== 'false'
  })
  // Live mirror of `companionEnabled` so the memoized startJobPoll reads the current toggle.
  const companionEnabledRef = useRef(companionEnabled)
  const [autoReset, setAutoReset] = useState(() => {
    return localStorage.getItem('chip_auto_reset') !== 'false'
  })
  const autoResetRef = useRef(autoReset)
  const [recentSerialLine, setRecentSerialLine] = useState<string | null>(null)

  const handleToggleCompanion = useCallback((enabled: boolean) => {
    setCompanionEnabled(enabled)
    companionEnabledRef.current = enabled
    localStorage.setItem('chip_web_companion_enabled', enabled ? 'true' : 'false')
    showAlert('info', `AI Web Companion ${enabled ? 'enabled' : 'disabled'}`, 'Settings Updated')
  }, [showAlert])

  const handleToggleAutoReset = useCallback((enabled: boolean) => {
    setAutoReset(enabled)
    autoResetRef.current = enabled
    localStorage.setItem('chip_auto_reset', enabled ? 'true' : 'false')
    showAlert('info', `Automatic Board Reset ${enabled ? 'enabled' : 'disabled'}`, 'Settings Updated')
  }, [showAlert])

  const uid = user.uid
  const email = user.email

  // Poll agent connection status (checks if Claude / AI agent is authenticated)
  useEffect(() => {
    const checkAgent = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/agents/status?userId=${uid}`)
        if (res.ok) {
          const data = await res.json()
          const isConn = !!data.connected
          setAgentConnected(isConn)
          if (isConn) {
            localStorage.setItem('chip_agent_connected', 'true')
          } else {
            localStorage.removeItem('chip_agent_connected')
          }
        }
      } catch {
        // non-fatal
      }
    }
    checkAgent()
    const interval = setInterval(checkAgent, 5000)
    return () => clearInterval(interval)
  }, [uid])

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // In-app soft refresh: re-syncs state, agent status & cloud without dropping USB Web Serial
  const handleAppRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // 1. Re-check Backend Gateway Health
      try {
        const healthRes = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(4000) })
        if (healthRes.ok) {
          setCloudConnected(true)
        } else {
          setCloudConnected(false)
        }
      } catch {
        setCloudConnected(false)
      }

      // 2. Re-check Agent Connection
      try {
        const agentRes = await fetch(`${BACKEND_URL}/api/agents/status?userId=${uid}`, { signal: AbortSignal.timeout(4000) })
        if (agentRes.ok) {
          const data = await agentRes.json()
          const isConn = !!data.connected
          setAgentConnected(isConn)
          if (isConn) {
            localStorage.setItem('chip_agent_connected', 'true')
          } else {
            localStorage.removeItem('chip_agent_connected')
          }
        }
      } catch {
        // non-fatal
      }

      // 3. Re-register WebSocket device connection if live
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'register',
            deviceId: 'default_device',
            chip: chipRef.current ?? 'ESP32',
            connected: !!loaderRef.current,
            userId: uid,
            uid,
            email,
          })
        )
      }

      // 4. Trigger child re-fetch
      setRefreshKey((k) => k + 1)

      showAlert('success', 'App state and cloud connection synced', 'Refreshed')
    } catch (err) {
      console.warn('App refresh error:', err)
      showAlert('info', 'Refreshed app state', 'Refreshed')
    } finally {
      setTimeout(() => setIsRefreshing(false), 500)
    }
  }, [uid, email, showAlert])

  // Active job tracking for compile & flash phases
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null)
  const [agentNote, setAgentNote] = useState<string | null>(null)

  const transportRef = useRef<Transport | null>(null)
  const loaderRef = useRef<ESPLoader | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const serialDrainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eraseInFlightRef = useRef(false)

  const busy = status === 'connecting' || status === 'flashing'
  const connected = status === 'connected' || status === 'flashing' || status === 'done'

  // Feed live board & dashboard snapshot state to the WebMCP tools
  useEffect(() => {
    setDashboardSnapshotProvider(() => ({
      devices: connected
        ? [{ deviceId: 'default_device', chip, connected, status, baud, transport: 'web-serial' as const }]
        : [],
      serialLogs: log,
      activeJob: activeJob
        ? {
            jobId: activeJob.jobId,
            phase: activeJob.phase,
            status: activeJob.status,
            progress: activeJob.progress,
            log: activeJob.log,
          }
        : null,
      cloudConnected,
      agentConnected,
      userEmail: email || null,
      companionEnabled,
      agentNote,
    }))
  }, [chip, status, connected, baud, log, activeJob, cloudConnected, agentConnected, email, companionEnabled, agentNote])

  useEffect(() => {
    const handleAgentNote = (event: Event) => {
      const note = (event as CustomEvent<{ note: string }>).detail?.note
      if (note) setAgentNote(note)
    }

    window.addEventListener('chip:agent-note', handleAgentNote)
    return () => window.removeEventListener('chip:agent-note', handleAgentNote)
  }, [])

  const uiBufferRef = useRef<string[]>([])
  const isCapturingUiRef = useRef<boolean>(false)

  const pushLine = useCallback((text: string) => {
    // Check if the board is outputting its baked-in HTML UI over USB Serial
    if (text.includes('===CHIP_UI_START===')) {
      isCapturingUiRef.current = true
      uiBufferRef.current = []
      return
    }
    if (text.includes('===CHIP_UI_END===')) {
      isCapturingUiRef.current = false
      const fullBoardHtml = uiBufferRef.current.join('\n')
      if (fullBoardHtml.trim().length > 0) {
        setActiveCompanionHtml(fullBoardHtml)
        setActiveCompanionTitle('Live Hardware UI (from Board Memory)')
        setActiveConsoleTab('preview')
        showAlert('success', 'Baked-in UI retrieved directly from board flash over USB!', 'Hardware UI Loaded')
      }
      return
    }

    if (isCapturingUiRef.current) {
      uiBufferRef.current.push(text)
      return
    }

    // Forward live telemetry serial lines to the companion iframe
    setRecentSerialLine(text)

    // Check if this line is JSON telemetry (e.g. {"state":"ON","uptime":106078})
    // JSON telemetry is dedicated to the Live AI Companion and should not clutter standard Serial Logs
    const isJsonTelemetry = (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
    if (isJsonTelemetry) {
      return
    }

    // Normal application logs (not HTML UI code or JSON telemetry)
    setLog((prev) => [...prev, text])
  }, [showAlert])
  const appendChunk = useCallback((text: string) => {
    setLog((prev) => {
      if (prev.length === 0) return [text]
      const next = prev.slice()
      next[next.length - 1] += text
      return next
    })
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [log])

  const [terminal] = useState<IEspLoaderTerminal>(() => ({
    clean: () => setLog([]),
    writeLine: (data: string) => pushLine(data),
    write: (data: string) => appendChunk(data),
  }))

  const stopSerialDrain = useCallback(() => {
    if (serialDrainIntervalRef.current) {
      clearInterval(serialDrainIntervalRef.current)
      serialDrainIntervalRef.current = null
    }
  }, [])

  const startSerialDrain = useCallback(() => {
    stopSerialDrain()
    const transport = transportRef.current
    if (!transport) return

    const decoder = new TextDecoder()
    let lineBuf = ''
    serialDrainIntervalRef.current = setInterval(() => {
      if (!loaderRef.current || transportRef.current !== transport) {
        stopSerialDrain()
        return
      }
      if (transport.inWaiting() > 0) {
        const bytes = transport.peek()
        transport.flushInput()
        const text = decoder.decode(bytes)
        lineBuf += text
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() || ''
        for (const l of lines) {
          const clean = l.replace(/\r/g, '').trim()
          if (clean.length > 0) {
            pushLine(clean)
          }
        }
      }
    }, 50)
  }, [pushLine, stopSerialDrain])

  const prepareBootloaderSession = useCallback(
    async (operationBaud: number, label: string) => {
      const currentTransport = transportRef.current
      const port = currentTransport?.device
      if (!port) throw new Error('Board is not connected.')

      stopSerialDrain()
      pushLine(`[${label}] Re-syncing ESP32 bootloader at ${operationBaud} baud...`)

      try {
        currentTransport.flushInput()
      } catch {
        // ignore stale-buffer cleanup failures
      }

      try {
        await currentTransport.disconnect()
      } catch {
        // The port may already be closed; the next Transport will reopen it.
      }

      const transport = new Transport(port)
      transportRef.current = transport
      const loader = new ESPLoader({
        transport,
        baudrate: operationBaud,
        terminal,
      })

      const detected = await loader.main()
      loaderRef.current = loader
      setChip(detected)
      pushLine(`[${label}] Bootloader ready: ${detected}`)
      return loader
    },
    [pushLine, stopSerialDrain, terminal]
  )

  const startJobPoll = useCallback((jobId: string, phase: JobPhase) => {
    if (jobPollRef.current) clearInterval(jobPollRef.current)
    setActiveJob({ jobId, phase, status: 'pending', progress: 0, log: [] })

    jobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`)
        if (!res.ok) return
        const job = (await res.json()) as JobStatusResponse
        setActiveJob({
          jobId,
          phase: job.phase || phase,
          status: job.status,
          progress: job.progress ?? 0,
          log: job.log ?? [],
        })
        if (job.status === 'done' || job.status === 'error') {
          if (jobPollRef.current) clearInterval(jobPollRef.current)
          jobPollRef.current = null
          if (job.status === 'done') {
            if (job.webCompanion && companionEnabledRef.current) {
              setActiveCompanionHtml(job.webCompanion)
              setActiveCompanionTitle(`Companion: ${job.filename || 'ESP32 Firmware'}`)
              setActiveConsoleTab('preview')
              showAlert('success', 'New AI Companion Visualizer loaded!', 'Digital Twin Ready')
            }
            setTimeout(() => setActiveJob(null), 8000)
          }
        }
      } catch {
        // ignore poll failures
      }
    }, 1500)
  }, [showAlert])

  const reportJobStatus = useCallback(
    async (jobId: string, jobStatus: JobState, jobProgress?: number, jobError?: string) => {
      try {
        await fetch(`${BACKEND_URL}/api/jobs/${jobId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: jobStatus, progress: jobProgress, error: jobError }),
        })
      } catch (e) {
        console.warn('Failed to report job status to backend:', e)
      }
    },
    []
  )

  const executeFlash = useCallback(
    async (fileData: Uint8Array, fileOffset: string, jobId?: string) => {
      if (!transportRef.current) {
        const msg = 'Board is not connected. Connect via Web Serial first.'
        showAlert('error', msg, 'Board Not Connected')
        pushLine(`[FLASH ERROR] ${msg}`)
        if (jobId) reportJobStatus(jobId, 'error', undefined, msg)
        return
      }

      setStatus('flashing')
      setProgress(0)
      stopSerialDrain()
      if (jobId) {
        setActiveJob({ jobId, phase: 'flash', status: 'started', progress: 0, log: [] })
        reportJobStatus(jobId, 'started', 0)
      }

      try {
        const loader = await prepareBootloaderSession(baud, 'FLASH')
        const offsetNum = parseOffset(fileOffset)
        const fileArray = [{ data: fileData, address: offsetNum }]
        const flashSize = 'keep'
        const flashMode = 'keep'
        const flashFreq = 'keep'

        pushLine(`[FLASH] Writing ${formatBytes(fileData.byteLength)} to 0x${offsetNum.toString(16)}...`)
        if (jobId) reportJobStatus(jobId, 'uploading', 10)

        let lastReportedPct = 0
        await loader.writeFlash({
          fileArray,
          flashSize,
          flashMode,
          flashFreq,
          eraseAll,
          compress: true,
          reportProgress: (_fileIndex: number, written: number, total: number) => {
            const pct = Math.round((written / total) * 100)
            setProgress(pct)
            if (jobId && pct - lastReportedPct >= 10) {
              lastReportedPct = pct
              reportJobStatus(jobId, 'uploading', pct)
            }
          },
        })

        setProgress(100)
        setStatus('done')
        pushLine('[FLASH] Success! Firmware written and verified.')
        showAlert('success', 'Firmware successfully flashed and verified!', 'Flash Complete')

        // Cleanly release bootloader and automatically reboot into firmware if autoReset enabled
        if (autoResetRef.current) {
          try {
            if (loaderRef.current) {
              pushLine('[FLASH] Rebooting ESP32 into new firmware…')
              await loaderRef.current.after('hard_reset')
            }
            const transport = transportRef.current
            if (transport) {
              // Backup RTS/DTR toggle pulse in case board uses custom transistor pair
              await transport.setDTR(false)
              await transport.setRTS(true)
              await new Promise((r) => setTimeout(r, 150))
              await transport.setDTR(false)
              await transport.setRTS(false)
            }
          } catch {
            // ignore post-flash reset error
          }
        } else {
          pushLine('[FLASH] Flash completed! Please press the EN / Reset button on your board to start.')
          showAlert('info', 'Please press the EN / Reset button on your board to start your new sketch.', 'Press EN Button')
        }

        // Continuously drain transport buffer to capture Serial.println output and feed the companion
        try {
          const transport = transportRef.current
          if (transport) {
            await transport.setDTR(false)
            await transport.setRTS(true)
            await new Promise((r) => setTimeout(r, 150))
            await transport.setDTR(false)
            await transport.setRTS(false)

            startSerialDrain()
          }
        } catch {
          // ignore post-flash reset error
        }

        if (jobId) {
          reportJobStatus(jobId, 'done', 100)
          setActiveJob((prev) => (prev ? { ...prev, status: 'done', progress: 100 } : null))
          setTimeout(() => setActiveJob(null), 8000)
        }

        setTimeout(() => setStatus('connected'), 3000)
      } catch (e) {
        const msg = errMessage(e)
        setStatus('error')
        pushLine(`[FLASH ERROR] ${msg}`)
        showAlert('error', msg, 'Flash Failed')
        if (jobId) {
          reportJobStatus(jobId, 'error', undefined, msg)
          setActiveJob((prev) => (prev ? { ...prev, status: 'error' } : null))
        }
      }
    },
    [baud, eraseAll, prepareBootloaderSession, pushLine, reportJobStatus, showAlert, startSerialDrain, stopSerialDrain]
  )

  // Latest-value refs so the once-subscribed WebSocket handlers avoid re-subscribing;
  // synced after commit, read only inside async socket handlers.
  const executeFlashRef = useRef(executeFlash)
  const offsetRef = useRef(offset)
  const chipRef = useRef(chip)
  useEffect(() => {
    executeFlashRef.current = executeFlash
    offsetRef.current = offset
    // eslint-disable-next-line react-hooks/immutability -- latest-ref sync; false positive (chip is in another effect's deps)
    chipRef.current = chip
  })

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

    function connectWs() {
      try {
        const query = uid ? `?userId=${encodeURIComponent(uid)}&email=${encodeURIComponent(email || '')}` : ''
        ws = new WebSocket(`${WS_URL}${query}`)
        wsRef.current = ws

        ws.onopen = () => {
          setCloudConnected(true)
          ws?.send(
            JSON.stringify({
              type: 'register',
              deviceId: 'default_device',
              chip: chipRef.current ?? 'ESP32',
              connected: !!loaderRef.current,
              userId: uid,
              uid,
              email,
            })
          )
        }

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data) as FlashPayloadMessage | { type: string; jobId?: string; phase?: JobPhase }

            if (msg.type === 'job_started' && msg.jobId && msg.phase) {
              startJobPoll(msg.jobId, msg.phase)
              return
            }

            if (msg.type === 'flash_payload') {
              const { jobId, filename, offset: payloadOffset, binBase64, webCompanion: flashWebCompanion } = msg as FlashPayloadMessage
              const fname = filename ?? 'firmware.bin'
              pushLine(`[FLASH] Received firmware from Claude (${fname}).`)
              showAlert('info', `Received firmware from Claude (${fname}). Starting flash...`, 'Claude Agent Flash')
              const bytes = base64ToUint8(binBase64)
              await executeFlashRef.current(bytes, payloadOffset ?? offsetRef.current, jobId)
              // Load companion HTML immediately from flash payload
              if (flashWebCompanion) {
                setActiveCompanionHtml(flashWebCompanion)
                setActiveCompanionTitle(`Companion: ${fname}`)
                setActiveConsoleTab('preview')
                showAlert('success', 'AI Companion Visualizer loaded!', 'Digital Twin Ready')
              }
            }
          } catch (e) {
            pushLine(`[ERROR] Failed to process payload: ${errMessage(e)}`)
            showAlert('error', errMessage(e), 'Payload Error')
          }
        }

        ws.onclose = () => {
          setCloudConnected(false)
          reconnectTimeout = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          setCloudConnected(false)
        }
      } catch {
        setCloudConnected(false)
        reconnectTimeout = setTimeout(connectWs, 3000)
      }
    }

    connectWs()

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) ws.close()
    }
  }, [uid, email, pushLine, startJobPoll, showAlert])

  const teardown = useCallback(async () => {
    try {
      stopSerialDrain()
      if (transportRef.current) {
        await transportRef.current.disconnect()
      }
    } catch {
      // ignore
    } finally {
      transportRef.current = null
      loaderRef.current = null
    }
  }, [stopSerialDrain])

  const connect = useCallback(async () => {
    if (!WEB_SERIAL_OK) return
    setStatus('connecting')
    pushLine('Requesting Web Serial port…')

    try {
      const port = await navigator.serial.requestPort({})
      const transport = new Transport(port)
      transportRef.current = transport

      const loader = new ESPLoader({
        transport,
        baudrate: baud,
        terminal,
      })

      pushLine('Syncing with ESP32…')
      const detected = await loader.main()
      // Set only after sync succeeds so the WS `register` reports "connected" at the right time.
      // eslint-disable-next-line react-hooks/immutability -- valid async ref write; false positive across await
      loaderRef.current = loader

      setChip(detected)
      setStatus('connected')
      pushLine(`Connected: ${detected}`)
      showAlert('success', `ESP32 connected successfully (${detected})`, 'Board Connected')

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'register',
            deviceId: 'default_device',
            chip: detected,
            connected: true,
            userId: uid,
            uid,
            email,
          })
        )
      }
    } catch (e) {
      const msg = errMessage(e)
      if (/No port selected|cancel/i.test(msg)) {
        setStatus('idle')
      } else {
        showAlert('error', msg, 'Connection Failed')
        pushLine(`Error: ${msg}`)
        setStatus('idle')
      }
      await teardown()
    }
  }, [baud, pushLine, teardown, terminal, uid, email, showAlert])

  const disconnect = useCallback(async (isUnplugged = false) => {
    await teardown()
    setChip(null)
    setProgress(0)
    setStatus('idle')
    setActiveCompanionHtml(null)
    setActiveCompanionTitle(null)
    setRecentSerialLine(null)
    setActiveConsoleTab('log')

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'register',
          deviceId: 'default_device',
          chip: null,
          connected: false,
          userId: uid,
          uid,
          email,
        })
      )
    }

    if (isUnplugged) {
      pushLine('[SERIAL] USB cable unplugged — device disconnected.')
      showAlert('error', 'ESP32 was unplugged from USB.', 'Board Disconnected')
    } else {
      showAlert('info', 'ESP32 board disconnected.', 'Board Disconnected')
    }
  }, [teardown, showAlert, uid, email, pushLine])

  // Native Web Serial Auto-Disconnect Listener (detects USB physical unplug)
  useEffect(() => {
    if (!WEB_SERIAL_OK) return

    let isHandlingDisconnect = false
    const handleSerialDisconnect = (event: Event) => {
      // Check if disconnected port matches current transport
      const disconnectedPort = event.target as SerialPort | null
      const currentPort = transportRef.current?.device

      if (disconnectedPort && currentPort && disconnectedPort !== currentPort) {
        return
      }

      if (isHandlingDisconnect) return
      isHandlingDisconnect = true

      console.log('[WebSerial] Hardware disconnect detected:', event)
      if (loaderRef.current || transportRef.current) {
        disconnect(true)
      }
      setTimeout(() => {
        isHandlingDisconnect = false
      }, 500)
    }

    navigator.serial.addEventListener('disconnect', handleSerialDisconnect)
    return () => {
      navigator.serial.removeEventListener('disconnect', handleSerialDisconnect)
    }
  }, [disconnect])

  const eraseChip = useCallback(async (options: { throwOnError?: boolean } = {}) => {
    if (eraseInFlightRef.current) {
      const msg = 'Erase is already in progress.'
      pushLine(`[ERASE] ${msg}`)
      if (options.throwOnError) throw new Error(msg)
      return
    }

    if (!transportRef.current) {
      pushLine('Error: Board is not connected.')
      showAlert('error', 'Board is not connected.', 'Erase Failed')
      if (options.throwOnError) throw new Error('Board is not connected.')
      return
    }

    eraseInFlightRef.current = true
    setStatus('flashing')
    stopSerialDrain()
    pushLine('[ERASE] Erasing entire flash memory (this takes ~10-20 seconds)...')
    showAlert('info', 'Erasing entire flash memory (takes ~10-20s)...', 'Flash Erase')
    try {
      const eraseOnce = async () => {
        const loader = await prepareBootloaderSession(115200, 'ERASE')
        await loader.eraseFlash()
      }

      try {
        await eraseOnce()
      } catch (e) {
        const msg = errMessage(e)
        if (!/Invalid head of packet|serial noise|corruption/i.test(msg)) throw e
        pushLine('[ERASE] Serial packet was corrupt. Re-syncing once and retrying erase...')
        await eraseOnce()
      }

      // Clear all active companion visualizer and telemetry state since board flash is wiped
      setActiveCompanionHtml(null)
      setActiveCompanionTitle(null)
      setRecentSerialLine(null)
      setActiveConsoleTab('log')
      pushLine('[ERASE] Complete! Entire flash memory has been completely erased.')
      showAlert('success', 'Flash memory has been completely erased.', 'Erase Complete')
    } catch (e) {
      const msg = errMessage(e)
      pushLine(`[ERASE ERROR] ${msg}`)
      showAlert('error', msg, 'Erase Failed')
      if (options.throwOnError) throw e
    } finally {
      eraseInFlightRef.current = false
      setStatus('connected')
    }
  }, [prepareBootloaderSession, pushLine, showAlert, stopSerialDrain])

  useEffect(() => {
    setDashboardActionProvider({
      eraseBoard: () => eraseChip({ throwOnError: true }),
    })
  }, [eraseChip])

  const onPickFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const data = new Uint8Array(await f.arrayBuffer())
    setFile({ name: f.name, size: f.size, data })
    setProgress(0)
    showAlert('info', `Loaded ${f.name} (${formatBytes(f.size)})`, 'Firmware Loaded')
  }, [showAlert])

  const handleManualFlash = useCallback(() => {
    if (file?.data) {
      executeFlash(file.data, offset)
    }
  }, [executeFlash, file, offset])

  const handleFlashBinaryDirect = useCallback(
    async (binBase64: string, flashOffset: string, filename: string) => {
      try {
        const byteCharacters = atob(binBase64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const data = new Uint8Array(byteNumbers)
        executeFlash(data, flashOffset, `reflash_${Date.now()}`)
        showAlert('info', `Flashing ${filename} to board at ${flashOffset}...`, 'Flash Started')
      } catch (err) {
        showAlert('error', `Failed to prepare binary for flashing: ${String(err)}`, 'Flash Error')
      }
    },
    [executeFlash, showAlert]
  )

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f5f5] select-none">
      {/* Sidebar Component */}
      <Sidebar
        user={user}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onSignOut={onSignOut}
        onOpenSettings={() => setSettingsOpen(true)}
        cloudConnected={cloudConnected}
        agentConnected={agentConnected}
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        companionEnabled={companionEnabled}
        onToggleCompanion={handleToggleCompanion}
        autoReset={autoReset}
        onToggleAutoReset={handleToggleAutoReset}
        backendUrl={BACKEND_URL}
        authToken={null}
      />


      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Clean Header Bar */}
        <header className="h-12 border-none bg-transparent flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-[#666666] hover:text-black p-1 -ml-1 rounded"
              onClick={() => setIsMobileOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="text-xs font-semibold text-black tracking-tight capitalize">
              {currentTab === 'history' ? 'Job History' : currentTab === 'manual' ? 'Manual Flash' : currentTab === 'setup' ? 'Setup' : 'Dashboard'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAppRefresh}
              disabled={isRefreshing}
              className="h-7 px-2.5 bg-white hover:bg-[#ebebeb] border border-[#e5e5e5] text-[#444444] hover:text-black rounded text-[11px] font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
              title="Soft refresh app state & sync with cloud (keeps ESP32 connected)"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isRefreshing ? 'animate-spin text-black' : 'text-[#666666]'}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>{isRefreshing ? 'Syncing…' : 'Refresh'}</span>
            </button>

            <button
              onClick={() => setAgentSidebarOpen(true)}
              className="h-7 px-2.5 bg-white hover:bg-[#ebebeb] border border-[#e5e5e5] text-[#444444] hover:text-black rounded text-[11px] font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Open Agent sidebar"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Agent</span>
            </button>

            <span className={`text-[11px] px-2 py-0.5 border border-[#e5e5e5] bg-white font-mono rounded ${cloudConnected ? 'text-[#16a34a] font-medium' : 'text-[#888888]'}`}>
              {cloudConnected ? 'Cloud Online' : 'Cloud Offline'}
            </span>
          </div>
        </header>

        {/* Scrollable Body + Agent Sidebar */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#f5f5f5]">
          <div className="max-w-5xl mx-auto space-y-4 pb-12">
            {/* TAB 1: MAIN AUTOMATED AGENT DASHBOARD */}
            {currentTab === 'dashboard' && (
              <>
                {/* Live Status Panel */}
                <StatusPanel
                  connected={connected}
                  chip={chip}
                  status={status}
                  progress={progress}
                  activeJob={activeJob}
                />

                {/* Connect your board card */}
                <section className="card">
                  <div className="step">
                    <div className="grow">
                      <h2>Connect your board</h2>
                      <p className="sub">Plug the ESP32 in over USB, then grant the port to connect with Claude.</p>
                    </div>
                    <span className={`pill ${connected ? 'on' : ''}`}>
                      {connected ? `● ${chip ?? 'connected'}` : '○ not connected'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <BaudDropdown
                      value={baud}
                      onChange={setBaud}
                      disabled={connected || busy}
                      options={BAUD_RATES}
                    />
                    {!connected ? (
                      <button
                        className="h-8 px-3.5 bg-black hover:bg-[#222222] text-white text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                        onClick={connect}
                        disabled={busy}
                      >
                        {status === 'connecting' ? 'Connecting…' : 'Connect board'}
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          className="h-8 px-3 bg-white hover:bg-[#f0f0f0] border border-[#e5e5e5] text-black text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer"
                          onClick={() => disconnect(false)}
                          disabled={busy}
                        >
                          Disconnect
                        </button>
                        <button
                          className="h-8 px-3 bg-white hover:bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer"
                          onClick={() => eraseChip()}
                          disabled={busy}
                          title="Completely wipe all flash memory on this ESP32"
                        >
                          Erase flash
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* TAB 2: MANUAL FLASH TOOL */}
            {currentTab === 'manual' && (
              <>
                {/* Choose Firmware */}
                <section className="card">
                  <div className="step">
                    <div className="grow">
                      <h2>Choose firmware</h2>
                      <p className="sub">Select a compiled .bin file from your computer.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <label className="relative overflow-hidden inline-flex items-center h-8 px-3 bg-white hover:bg-[#fafafa] border border-[#d1d5db] hover:border-black text-xs font-medium text-black rounded transition-all cursor-pointer">
                      <span>{file ? 'Change .bin' : 'Choose .bin'}</span>
                      <input type="file" accept=".bin" onChange={onPickFile} disabled={busy} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                    <input
                      className="h-8 px-2.5 w-28 bg-white border border-[#d1d5db] focus:border-black rounded text-xs font-mono text-black outline-none transition-colors"
                      value={offset}
                      onChange={(e) => setOffset(e.target.value)}
                      disabled={busy}
                      placeholder="0x10000"
                    />
                    {file && (
                      <span className="text-[11px] font-mono text-[#666666]">
                        {file.name} ({formatBytes(file.size)})
                      </span>
                    )}
                  </div>
                  <p className="hint">
                    Merged image → <code>0x0</code>. App-only (Arduino / PlatformIO) → <code>0x10000</code>. Bootloader → <code>0x1000</code>, partition table → <code>0x8000</code>.
                  </p>
                </section>

                {/* Flash it */}
                <section className="card">
                  <div className="step">
                    <div className="grow">
                      <h2>Flash it</h2>
                      <p className="sub">Writes to the board over USB with esptool-js.</p>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={eraseAll}
                        onChange={(e) => setEraseAll(e.target.checked)}
                        disabled={busy}
                      />
                      <span>Erase whole flash first</span>
                    </label>
                  </div>

                  <button
                    className="h-8 px-4 bg-black hover:bg-[#222222] text-white text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed inline-flex items-center gap-1.5 mt-1"
                    onClick={handleManualFlash}
                    disabled={!connected || !file || busy}
                  >
                    {status === 'flashing' ? (
                      <>
                        <span className="sp-spinner sm" />
                        Flashing…
                      </>
                    ) : 'Flash board'}
                  </button>

                  {status === 'flashing' && <FlashProgressBar progress={progress} />}
                  {status === 'done' && <p className="ok">✓ Flash complete!</p>}
                </section>
              </>
            )}

            {/* TAB 3: JOB HISTORY & ARTIFACTS */}
            {currentTab === 'history' && (
              <HistoryView
                backendUrl={BACKEND_URL}
                connected={connected}
                refreshKey={refreshKey}
                onFlashBinary={handleFlashBinaryDirect}
                showAlert={showAlert}
              />
            )}

            {/* TAB 4: SETUP — AI Agent Connection Flow */}
            {currentTab === 'setup' && (
              <div className="space-y-4 max-w-2xl select-none">
                {/* Header */}
                <div>
                  <h1 className="text-sm font-semibold text-black tracking-tight">Connect your AI agent</h1>
                  <p className="text-[12px] text-[#888888] mt-0.5">
                    Select a connection method below to link ChatGPT, Claude, Cursor, Copilot, or any MCP agent.
                  </p>
                </div>

                {/* Setup Sub-Tab Selector */}
                <div className="flex items-center gap-1.5 bg-[#ebebeb] p-1 rounded-xl w-fit text-xs font-medium border border-[#e0e0e0]">
                  <button
                    type="button"
                    onClick={() => setSetupSubTab('webmcp')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      setupSubTab === 'webmcp'
                        ? 'bg-white text-black shadow-xs font-semibold'
                        : 'text-[#666666] hover:text-black'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <path d="M8 9h8" />
                      <path d="M8 13h6" />
                    </svg>
                    <span>WebMCP Direct Connection</span>
                    <span className="text-[9px] font-mono bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full font-bold">ChatGPT & Claude</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetupSubTab('mcp')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      setupSubTab === 'mcp'
                        ? 'bg-white text-black shadow-xs font-semibold'
                        : 'text-[#666666] hover:text-black'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M7 7h10" />
                      <path d="M7 12h10" />
                    </svg>
                    <span>Standard MCP Gateway</span>
                  </button>
                </div>

                {/* SUB-TAB 1: WebMCP Direct Agent Connection */}
                {setupSubTab === 'webmcp' && (
                  <div className="space-y-3 max-w-xl animate-in fade-in-50 duration-150 pt-2">
                    {/* Step 1 */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">1</div>
                        <div className="w-px flex-1 bg-[#e5e5e5] mt-1.5 mb-1.5" />
                      </div>
                      <div className="pb-5 min-w-0 w-full">
                        <p className="text-[13px] font-semibold text-black leading-tight mb-1">Copy the WebMCP Agent Prompt</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed mb-3">
                          Copy the formatted agent prompt and paste it into ChatGPT or Claude Web. The AI agent will open your live dashboard and assist you directly.
                        </p>
                        <div className="bg-[#f8f8f8] border border-[#e5e5e5] rounded-xl p-3 space-y-2.5">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const prompt = buildAgentPrompt()
                                navigator.clipboard.writeText(prompt)
                                showAlert('success', 'Agent prompt copied! Paste into ChatGPT or Claude.', 'Prompt Copied')
                              }}
                              className="flex-1 bg-black hover:bg-[#222222] text-white text-xs font-medium py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                              <span>Copy Agent Prompt</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const url = getWebMCPUrl()
                                navigator.clipboard.writeText(url)
                                showAlert('success', 'Live WebMCP Link copied!', 'Link Copied')
                              }}
                              className="bg-white hover:bg-[#f3f3f3] text-black text-xs font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer border border-[#e5e5e5] flex items-center justify-center gap-1.5"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0 7.54 7.07l1.71-1.71" />
                              </svg>
                              <span>Copy Live Link</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">2</div>
                        <div className="w-px flex-1 bg-[#e5e5e5] mt-1.5 mb-1.5" />
                      </div>
                      <div className="pb-5 min-w-0">
                        <p className="text-[13px] font-semibold text-black leading-tight mb-1">Exposed Page Tools (Read-Only)</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          WebMCP exposes live in-browser tools to the connected agent. Agents can read board state, post status updates, save guidance notes, request hardware actions, and erase the connected board when you explicitly ask.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {['list_devices', 'get_board_status', 'read_serial_logs', 'read_job_status', 'read_dashboard_state', 'post_agent_message', 'set_agent_note', 'request_user_action', 'erase_board'].map((tool) => (
                            <span key={tool} className="inline-flex items-center px-2 py-0.5 text-[11px] font-mono font-medium bg-white border border-[#e5e5e5] rounded text-[#444444]">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Step 3 / Done */}
                    <div className="flex gap-4">
                      <div className="shrink-0">
                        <div className="w-6 h-6 rounded-full bg-[#16a34a] text-white flex items-center justify-center">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      </div>
                      <div className="pb-2 min-w-0">
                        <p className="text-[13px] font-semibold text-[#16a34a] leading-tight mb-1">Ready for ChatGPT &amp; Claude</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          Paste the prompt into your AI chat and ask:{' '}
                          <span className="font-mono text-[11px] bg-[#f3f3f3] border border-[#e5e5e5] rounded px-1.5 py-0.5 text-black">
                            "Check my board status and read serial logs"
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB-TAB 2: Standard MCP Gateway Timeline (Original UI) */}
                {setupSubTab === 'mcp' && (
                  <div className="space-y-3 max-w-xl animate-in fade-in-50 duration-150 pt-2">
                    {/* Step 1 */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">1</div>
                        <div className="w-px flex-1 bg-[#e5e5e5] mt-1.5 mb-1.5" />
                      </div>
                      <div className="pb-5 min-w-0">
                        <p className="text-[13px] font-semibold text-black leading-tight mb-1">Open your AI agent settings</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          In your AI tool, navigate to <span className="font-medium text-black">Settings</span> and find the{' '}
                          <span className="font-medium text-black">Connectors</span>,{' '}
                          <span className="font-medium text-black">Plugins</span>, or{' '}
                          <span className="font-medium text-black">Integrations</span> section.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {['Claude', 'Cursor', 'Copilot', 'Cline', 'LibreChat'].map((agent) => (
                            <span key={agent} className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-white border border-[#e5e5e5] rounded text-[#444444]">
                              {agent}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">2</div>
                        <div className="w-px flex-1 bg-[#e5e5e5] mt-1.5 mb-1.5" />
                      </div>
                      <div className="pb-5 min-w-0 w-full">
                        <p className="text-[13px] font-semibold text-black leading-tight mb-1">Add the MCP server URL</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed mb-2.5">
                          Add a new MCP server and paste the URL below. Your agent will automatically discover all available Chip tools.
                        </p>
                        <div className="flex items-center gap-2 bg-[#f3f3f3] border border-[#e5e5e5] rounded px-3 py-2">
                          <code className="flex-1 text-[11px] font-mono text-[#222222] truncate">{MCP_URL}</code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(MCP_URL)
                              showAlert('success', 'MCP URL copied to clipboard', 'Copied')
                            }}
                            className="shrink-0 text-[#888888] hover:text-black transition-colors cursor-pointer p-1 hover:bg-white rounded border border-transparent hover:border-[#e5e5e5]"
                            title="Copy MCP URL"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">3</div>
                        <div className="w-px flex-1 bg-[#e5e5e5] mt-1.5 mb-1.5" />
                      </div>
                      <div className="pb-5 min-w-0">
                        <p className="text-[13px] font-semibold text-black leading-tight mb-1">Approve the connection</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          Your agent will open a login prompt. Sign in with the same account you used here — this links your agent session to your board.
                        </p>
                        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[#888888]">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                          OAuth 2.1 with PKCE — your credentials are never shared with the agent.
                        </div>
                      </div>
                    </div>

                    {/* Done */}
                    <div className="flex gap-4">
                      <div className="shrink-0">
                        <div className="w-6 h-6 rounded-full bg-[#16a34a] text-white flex items-center justify-center">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      </div>
                      <div className="pb-2 min-w-0">
                        <p className="text-[13px] font-semibold text-[#16a34a] leading-tight mb-1">You're live</p>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          Tell your agent:{' '}
                          <span className="font-mono text-[11px] bg-[#f3f3f3] border border-[#e5e5e5] rounded px-1.5 py-0.5 text-black">
                            "compile and flash a blink sketch to my board"
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Log Console & Live Companion Preview (Dashboard & Manual tabs) */}
            {currentTab !== 'history' && currentTab !== 'setup' && (
              <section className="card">
                <div className="loghead">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveConsoleTab('log')}
                      className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors cursor-pointer ${
                        activeConsoleTab === 'log'
                          ? 'bg-black text-white'
                          : 'text-[#666666] hover:text-black hover:bg-[#f3f3f3]'
                      }`}
                    >
                      Serial Logs
                    </button>
                    <button
                      onClick={() => setActiveConsoleTab('preview')}
                      className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                        activeConsoleTab === 'preview'
                          ? 'bg-black text-white'
                          : 'text-[#666666] hover:text-black hover:bg-[#f3f3f3]'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                      <span>Live AI Companion</span>
                      {activeCompanionHtml && (
                        <span className="text-[10px] bg-[#f59e0b] text-white px-1 py-0.2 rounded font-mono">
                          Live
                        </span>
                      )}
                    </button>
                  </div>

                  {activeConsoleTab === 'log' && (
                    <button className="ghost sm" onClick={() => setLog([])}>
                      Clear
                    </button>
                  )}
                </div>

                {activeConsoleTab === 'log' ? (
                  <pre className="console">
                    {log.length === 0 && <span className="muted">Waiting for actions…</span>}
                    {log.map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                    <div ref={logEndRef} />
                  </pre>
                ) : (
                  <div className="mt-3">
                    <CompanionPreview
                      htmlContent={activeCompanionHtml}
                      jobTitle={activeCompanionTitle || undefined}
                      recentSerialLine={recentSerialLine}
                    />
                  </div>
                )}
              </section>
            )}
          </div>
          </main>

          {/* Inline Agent Panel — sits beside the page content */}
          <AgentSidebar
            open={agentSidebarOpen}
            onClose={() => setAgentSidebarOpen(false)}
            boardConnected={connected}
            chipModel={chip}
            baudRate={baud}
            agentConnected={agentConnected}
            cloudConnected={cloudConnected}
            serialLogs={log}
          />
        </div>
      </div>
    </div>
  )
}

// ── Status Panel Subcomponents ───────────────────────────────────────────────
interface StatusPanelProps {
  connected: boolean
  chip: string | null
  status: Status
  progress: number
  activeJob: ActiveJob | null
}

function StatusPanel({ connected, chip, status, progress, activeJob }: StatusPanelProps) {
  const hasJob = !!activeJob
  const isFlashing = status === 'flashing'

  return (
    <section className="card status-panel">
      <div className="sp-grid">
        <div className="sp-col">
          <div className="sp-label">Board</div>
          <div className={`sp-board-status ${connected ? 'sp-connected' : 'sp-idle'}`}>
            <span className="sp-dot" />
            <span className="sp-board-text">
              {connected ? (chip ?? 'ESP32 connected') : 'No board connected'}
            </span>
          </div>
          {connected && <div className="sp-chip-badge">{chip}</div>}
        </div>

        <div className="sp-divider" />

        <div className="sp-col sp-col-grow">
          <div className="sp-label">
            {hasJob
              ? activeJob.phase === 'compile'
                ? 'Compile job'
                : 'Flash job'
              : isFlashing
                ? 'Flash job'
                : 'Pipeline'}
          </div>

          {isFlashing && !hasJob && <FlashStagesRow progress={progress} />}
          {hasJob && activeJob.phase === 'compile' && <CompileJobView job={activeJob} />}
          {hasJob && activeJob.phase === 'flash' && (
            <FlashStagesRow progress={activeJob.progress} jobStatus={activeJob.status} />
          )}
          {!isFlashing && !hasJob && (
            <p className="sp-idle-hint">Waiting for an agent to trigger a compile or flash…</p>
          )}
        </div>
      </div>
    </section>
  )
}

function CompileJobView({ job }: { job: ActiveJob }) {
  const isCompiling = job.status === 'compiling' || job.status === 'pending'
  const isDone = job.status === 'done'
  const isError = job.status === 'error'

  return (
    <div className="compile-view">
      <div className="compile-header">
        {isCompiling && <span className="sp-spinner" aria-hidden="true" />}
        {isDone && <span className="compile-check">✓</span>}
        {isError && <span className="compile-err-icon">✕</span>}
        <span
          className={`compile-status-text ${isDone ? 'ct-done' : isError ? 'ct-err' : 'ct-active'}`}
        >
          {isCompiling && 'Compiling Arduino / ESP32 code…'}
          {isDone && 'Compilation complete — binary ready to flash'}
          {isError && 'Compilation failed'}
        </span>
      </div>
      {job.log.length > 0 && (
        <pre className="compile-log">
          {job.log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </pre>
      )}
    </div>
  )
}

function FlashStagesRow({ progress, jobStatus }: { progress: number; jobStatus?: JobState }) {
  const currentStage = getFlashStage(progress)
  const isError = jobStatus === 'error'
  const stageIdx = FLASH_STAGES.indexOf(currentStage)

  return (
    <div className="flash-stages">
      <div className="flash-stages-row">
        {FLASH_STAGES.map((s, i) => {
          const past = i < stageIdx
          const active = s === currentStage && !isError && currentStage !== 'Done'
          const done = currentStage === 'Done' || past
          return (
            <div key={s} className={`stage-pill ${active ? 'sp-active' : done ? 'sp-done' : ''}`}>
              {active && <span className="sp-spinner sm" aria-hidden="true" />}
              {done && !active && <span className="stage-tick">✓</span>}
              {s}
            </div>
          )
        })}
      </div>
      <div className="flash-bar-wrap">
        <div
          className={`flash-bar-fill ${currentStage !== 'Done' && !isError ? 'flash-bar-active' : ''}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flash-pct">{progress}%</div>
    </div>
  )
}

function FlashProgressBar({ progress }: { progress: number }) {
  return (
    <div className="progress">
      <div className="bar" style={{ width: `${progress}%` }} />
    </div>
  )
}
