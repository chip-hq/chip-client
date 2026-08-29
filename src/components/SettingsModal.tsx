import { useEffect, useRef, useState } from 'react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  companionEnabled: boolean
  onToggleCompanion: (enabled: boolean) => void
  autoReset: boolean
  onToggleAutoReset: (enabled: boolean) => void
  backendUrl: string
  authToken?: string | null
}

type SettingsTab = 'companion' | 'flashing' | 'webmcp'

const WEBMCP_COMMANDS = [
  {
    name: 'list_devices',
    access: 'Read-only',
    description: 'List connected ESP32 boards in this browser session.',
  },
  {
    name: 'get_board_status',
    access: 'Read-only',
    description: 'Read chip model, baud rate, board status, and gateway status.',
  },
  {
    name: 'read_serial_logs',
    access: 'Read-only',
    description: 'Read recent Serial Logs, with optional limit up to 200 lines.',
  },
  {
    name: 'read_job_status',
    access: 'Read-only',
    description: 'Read current compile or flash job phase, progress, logs, and errors.',
  },
  {
    name: 'read_dashboard_state',
    access: 'Read-only',
    description: 'Read full dashboard session state, including companion and agent note state.',
  },
  {
    name: 'post_agent_message',
    access: 'Write',
    description: 'Post a status update directly into the Live Digest sidebar.',
  },
  {
    name: 'set_agent_note',
    access: 'Write',
    description: 'Save persistent guidance or a next-step note in the dashboard.',
  },
  {
    name: 'request_user_action',
    access: 'Write',
    description: 'Ask the user to connect, reset, select a file, erase, open logs, or check wiring.',
  },
  {
    name: 'erase_board',
    access: 'Destructive',
    description: 'Erase the connected ESP32 flash after the user clearly asks for it.',
  },
] as const

// Small copy-to-clipboard button — shows a green check for ~1.5s after copying.
function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return // clipboard unavailable (insecure context or permission denied)
    }
    setCopied(true)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={() => handleCopy()}
      aria-label={copied ? 'Copied' : `Copy ${value}`}
      title={copied ? 'Copied' : 'Copy'}
      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors cursor-pointer ${
        copied ? 'text-[#16a34a]' : 'text-[#888888] hover:text-black hover:bg-[#ebebeb]'
      } ${className}`}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

// A read-only command shown in a bordered box with a copy button on the right.
function CommandRow({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1.5 border border-[#e5e5e5] rounded-lg bg-[#fafafa] py-1 pl-2.5 pr-1">
      <code className="flex-1 min-w-0 font-mono text-[11px] text-black break-all">{value}</code>
      <CopyButton value={value} />
    </div>
  )
}

export function SettingsModal({
  isOpen,
  onClose,
  companionEnabled,
  onToggleCompanion,
  autoReset,
  onToggleAutoReset,
  backendUrl,
  authToken,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('companion')

  if (!isOpen) return null

  const webmcpAvailable = typeof document !== 'undefined' && !!document.modelContext

  const handleToggle = async (enabled: boolean) => {
    onToggleCompanion(enabled)
    try {
      await fetch(`${backendUrl}/api/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ webCompanion: enabled }),
      })
    } catch {
      // non-fatal — localStorage still holds the value
    }
  }

  const navItemClass = (tab: SettingsTab) =>
    `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-left ${
      activeTab === tab ? 'bg-[#ebebeb] text-black' : 'text-[#666666] hover:bg-[#f0f0f0]'
    }`

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-[#e5e5e5] rounded-xl w-[640px] max-w-[95vw] h-[450px] max-h-[90vh] shadow-xl flex overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Main Content Area */}
        <div className="flex-1 p-5 flex flex-col h-full min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            {activeTab === 'companion' ? (
              <>
                <div className="text-xs font-semibold text-black tracking-tight mb-4">
                  AI Web Companion
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[#f5f5f5]">
                  <div>
                    <div className="text-xs font-medium text-black">Generate Web Companion</div>
                    <div className="text-[11px] text-[#888888] mt-0.5 max-w-[200px]">
                      Creates digital twins matching your C++ firmware
                    </div>
                  </div>

                  {/* iOS Style Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={companionEnabled}
                    onClick={() => handleToggle(!companionEnabled)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      companionEnabled ? 'bg-black' : 'bg-[#d1d5db]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        companionEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </>
            ) : activeTab === 'flashing' ? (
              <>
                <div className="text-xs font-semibold text-black tracking-tight mb-4">
                  Flashing & Hardware Reset
                </div>

                <div className="flex items-center justify-between py-2 border-b border-[#f5f5f5]">
                  <div>
                    <div className="text-xs font-medium text-black">Automatic Board Reset</div>
                    <div className="text-[11px] text-[#888888] mt-0.5 max-w-[220px]">
                      Auto-reboot into new sketch over DTR/RTS after flashing. When disabled, you will be prompted to press the EN / Reset button manually.
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoReset}
                    onClick={() => onToggleAutoReset(!autoReset)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoReset ? 'bg-black' : 'bg-[#d1d5db]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        autoReset ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold text-black tracking-tight">WebMCP</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${webmcpAvailable ? 'bg-[#16a34a]' : 'bg-[#b45309]'}`} />
                    <span className={`text-[10px] font-medium ${webmcpAvailable ? 'text-[#16a34a]' : 'text-[#b45309]'}`}>
                      {webmcpAvailable ? 'Available in this browser' : 'Not detected in this browser'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 text-[11px] text-[#666666] leading-relaxed">
                  <p>
                    CHIP exposes your connected board to AI agents running in your browser through{' '}
                    <span className="font-medium text-black">WebMCP</span> — an emerging web standard.
                    No API keys or extra setup required.
                  </p>

                  <div className="border border-[#e5e5e5] rounded-lg p-2.5 bg-[#fafafa]">
                    <div className="flex items-center gap-1.5">
                      <code className="text-[11px] font-mono text-black">list_devices</code>
                      <span className="text-[9px] uppercase tracking-wide bg-[#f0fdf4] text-[#16a34a] border border-[#86efac] rounded px-1 py-px">
                        Read-only
                      </span>
                      <CopyButton value="list_devices" className="ml-auto" />
                    </div>
                    <div className="text-[11px] text-[#888888] mt-1">
                      Reports the ESP32 connected over USB — chip type, connection status, and baud rate.
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-medium text-black mb-1.5">Available WebMCP commands</div>
                    <div className="space-y-1.5">
                      {WEBMCP_COMMANDS.map((command) => {
                        const badgeClass =
                          command.access === 'Read-only'
                            ? 'bg-[#f0fdf4] text-[#16a34a] border-[#86efac]'
                            : command.access === 'Destructive'
                              ? 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]'
                              : 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]'

                        return (
                          <div key={command.name} className="border border-[#e5e5e5] rounded-lg p-2.5 bg-[#fafafa]">
                            <div className="flex items-center gap-1.5">
                              <code className="text-[11px] font-mono text-black break-all">{command.name}</code>
                              <span className={`text-[9px] uppercase tracking-wide border rounded px-1 py-px ${badgeClass}`}>
                                {command.access}
                              </span>
                              <CopyButton value={command.name} className="ml-auto" />
                            </div>
                            <div className="text-[11px] text-[#888888] mt-1">
                              {command.description}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-medium text-black mb-1">How to use it</div>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Open CHIP in a WebMCP-capable browser or agent.</li>
                      <li>Connect your ESP32 over USB.</li>
                      <li>
                        Ask the agent about your board — it can call{' '}
                        <code className="font-mono text-[#666666]">list_devices</code> to read live state.
                      </li>
                    </ol>
                  </div>

                  <div>
                    <div className="text-[11px] font-medium text-black mb-1">Enable it in Chrome</div>
                    <p className="mb-1.5">
                      Paste this into the address bar, set it to{' '}
                      <span className="font-medium text-black">Enabled</span>, and relaunch:
                    </p>
                    <CommandRow value="chrome://flags/#enable-webmcp-testing" />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between items-center pt-3 mt-3 text-[10px] text-[#888888] font-mono border-t border-[#f0f0f0]">
            <span>Chip</span>
          </div>
        </div>

        {/* Right Sidebar (Settings Nav) */}
        <div className="w-44 bg-[#fafafa] border-l border-[#e5e5e5] p-3 flex flex-col justify-between shrink-0 h-full">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#888888] px-2 py-1">
              Settings
            </div>

            <button className={navItemClass('companion')} onClick={() => setActiveTab('companion')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>AI Companion</span>
            </button>

            <button className={navItemClass('flashing')} onClick={() => setActiveTab('flashing')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>Flashing & Reset</span>
            </button>

            <button className={navItemClass('webmcp')} onClick={() => setActiveTab('webmcp')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
              <span>WebMCP</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
