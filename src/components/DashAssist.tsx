import { useState, useEffect } from 'react'
import { buildAgentPrompt, getWebMCPUrl } from '../webmcp/room'
import { generateCleanSerialSummary } from '../webmcp/tools'
import { type AlertType } from './AlertToast'

interface DashAssistProps {
  boardConnected: boolean
  chipModel: string | null
  baudRate: number
  agentConnected: boolean
  cloudConnected: boolean
  serialLogs?: string[]
  showAlert: (type: AlertType, message: string, title?: string) => void
}

export function DashAssist({
  boardConnected,
  chipModel,
  baudRate,
  agentConnected,
  cloudConnected,
  serialLogs = [],
  showAlert,
}: DashAssistProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Automatically expand speech bubble when board connects or disconnects
  useEffect(() => {
    setIsOpen(true)
  }, [boardConnected])

  const liveUrl = getWebMCPUrl()
  const agentPromptText = buildAgentPrompt()
  const { cleanSummary } = generateCleanSerialSummary(serialLogs)

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(agentPromptText)
    setCopiedPrompt(true)
    showAlert('success', 'Agent prompt copied to clipboard! Paste into ChatGPT or Claude.', 'Prompt Copied')
    setTimeout(() => setCopiedPrompt(false), 3000)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(liveUrl)
    setCopiedLink(true)
    showAlert('success', 'Live WebMCP URL copied!', 'URL Copied')
    setTimeout(() => setCopiedLink(false), 3000)
  }

  return (
    <div className="relative inline-block z-30">
      {/* Main Header / Control Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all shadow-xs cursor-pointer ${
          isOpen
            ? 'bg-amber-500 text-white border-amber-600 shadow-md ring-2 ring-amber-500/20'
            : 'bg-white hover:bg-[#fafafa] text-black border-[#d1d5db] hover:border-amber-500'
        }`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${boardConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${boardConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h6" />
        </svg>
        <span>DashAssist</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/10 text-current">
          {boardConnected ? (agentConnected ? 'Agent Ready' : 'Step 2') : 'Step 1'}
        </span>
      </button>

      {/* Speech Bubble Pop-up Overlay */}
      {isOpen && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-[calc(100%+12px)] w-[340px] sm:w-[400px] bg-white border border-[#e5e5e5] rounded-2xl shadow-xl p-4.5 animate-in fade-in-50 zoom-in-95 duration-150 text-left select-none">
          {/* Speech Bubble Arrow Tail pointing up */}
          <div className="absolute -top-2 left-6 sm:left-auto sm:right-6 w-4 h-4 bg-white border-t border-l border-[#e5e5e5] rotate-45" />

          {/* Speech Bubble Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#f0f0f0] mb-3">
            <div>
              <h4 className="text-xs font-semibold text-black tracking-tight">DashAssist Assistant</h4>
              <p className="text-[10px] text-[#777777]">Interactive WebMCP Guidance & Live AI Digest</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[#999999] hover:text-black p-1 rounded-full hover:bg-[#f0f0f0] transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Speech Bubble Message Content */}
          <div className="bg-[#fafafa] border border-[#eee] rounded-xl p-3.5 mb-3.5 relative">
            {!boardConnected ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-xs text-amber-900">
                  <span>💬</span>
                  <span>Hey user! Have you connected your board?</span>
                </div>
                <p className="text-[11px] text-[#555] leading-relaxed">
                  Plug your board in over USB, then click <strong className="text-black">Connect board</strong> to grant port permission so agents can interact with your hardware.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-900">
                    <span>🟢</span>
                    <span>Live AI Board Digest {chipModel ? `(${chipModel})` : ''}</span>
                  </div>
                  <span className="text-[9px] font-mono bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-medium">Clean Reading</span>
                </div>

                {cleanSummary.length > 0 ? (
                  <div className="bg-white border border-[#e5e5e5] rounded-lg p-2.5 space-y-1.5 max-h-36 overflow-y-auto">
                    {cleanSummary.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#333] leading-snug">
                        <span className="text-emerald-600 font-bold shrink-0">•</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#555] leading-relaxed">
                    Board connected on baud {baudRate}. Awaiting live serial log events from your microcontroller...
                  </p>
                )}

                <div className="pt-1 flex items-center gap-2 text-[10px] text-[#666]">
                  <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-mono font-medium">Baud: {baudRate}</span>
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-mono font-medium">WebMCP Live</span>
                  <span className={`px-1.5 py-0.5 rounded font-mono font-medium ${cloudConnected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                    {cloudConnected ? 'Gateway Online' : 'Offline'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Copy Prompt & Link Buttons Section */}
          <div className="space-y-2 mb-3.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-[#444]">
              <span>WebMCP Agent Prompt</span>
              <span className="text-[10px] font-mono text-emerald-700 font-semibold">Live URL</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="flex-1 bg-black hover:bg-[#222] text-white text-xs font-medium py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                {copiedPrompt ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-emerald-400 font-medium">Prompt Copied!</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy Agent Prompt</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy Live WebMCP Link"
                className="bg-[#f0f0f0] hover:bg-[#e4e4e4] text-black text-xs font-medium p-2 rounded-lg transition-colors cursor-pointer border border-[#e5e5e5]"
              >
                {copiedLink ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* WebMCP Exposed Tools Footer */}
          <div className="pt-3 border-t border-[#f0f0f0]">
            <div className="text-[10px] uppercase font-semibold text-[#888] tracking-wider mb-1.5 flex items-center justify-between">
              <span>WebMCP Browser Tools (9)</span>
              <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">Active in Page</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {['list_devices', 'get_board_status', 'read_serial_logs', 'read_job_status', 'read_dashboard_state', 'post_agent_message', 'set_agent_note', 'request_user_action', 'erase_board'].map((toolName) => (
                <span
                  key={toolName}
                  className="text-[10px] font-mono bg-[#f4f4f5] hover:bg-[#e4e4e7] text-[#333] px-2 py-0.5 rounded transition-colors cursor-default border border-[#e4e4e7]"
                  title={`Exposed to WebMCP agent via document.modelContext`}
                >
                  {toolName}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
