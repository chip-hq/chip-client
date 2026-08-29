import { useEffect, useRef, useState } from 'react'
import { generateCleanSerialSummary } from '../webmcp/tools'

const MCP_URL = 'https://chip-mcp-server.onrender.com/mcp'
const MAX_DIGEST_ITEMS = 30

interface AgentActionRequest {
  action: string
  reason: string
  details?: string
}

interface AgentSidebarProps {
  open: boolean
  onClose: () => void
  boardConnected: boolean
  chipModel: string | null
  baudRate: number
  agentConnected: boolean
  cloudConnected: boolean
  serialLogs?: string[]
  showAlert?: never
}

function appendUniqueRecent<T>(items: T[], item: T, isSame: (a: T, b: T) => boolean): T[] {
  const last = items[items.length - 1]
  if (last && isSame(last, item)) return items
  const withoutDuplicate = items.filter((existing) => !isSame(existing, item))
  return [...withoutDuplicate, item].slice(-MAX_DIGEST_ITEMS)
}

function sameActionRequest(a: AgentActionRequest, b: AgentActionRequest): boolean {
  return a.action === b.action && a.reason === b.reason && (a.details || '') === (b.details || '')
}

export function AgentSidebar({
  open,
  onClose,
  boardConnected,
  chipModel,
  baudRate,
  agentConnected,
  cloudConnected,
  serialLogs = [],
}: AgentSidebarProps) {
  const [copied, setCopied] = useState(false)
  const [agentMessages, setAgentMessages] = useState<string[]>([])
  const [agentNote, setAgentNote] = useState<string | null>(null)
  const [actionRequests, setActionRequests] = useState<AgentActionRequest[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  const copyMcpUrl = () => {
    navigator.clipboard.writeText(MCP_URL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const { cleanSummary } = generateCleanSerialSummary(serialLogs)

  useEffect(() => {
    const handleLocal = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text
      if (text) setAgentMessages((prev) => appendUniqueRecent(prev, text, (a, b) => a === b))
    }
    const handleNote = (e: Event) => {
      const note = (e as CustomEvent<{ note: string }>).detail?.note
      if (note) setAgentNote(note)
    }
    const handleActionRequest = (e: Event) => {
      const request = (e as CustomEvent<AgentActionRequest>).detail
      if (request?.action && request.reason) {
        setActionRequests((prev) => appendUniqueRecent(prev, request, sameActionRequest))
      }
    }

    // 1. Local event
    window.addEventListener('chip:agent-message', handleLocal)
    window.addEventListener('chip:agent-note', handleNote)
    window.addEventListener('chip:user-action-request', handleActionRequest)

    // 2. Cross-tab BroadcastChannel
    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('chip_agent_channel')
        bc.onmessage = (event) => {
          if (event.data?.text) {
            setAgentMessages((prev) => appendUniqueRecent(prev, event.data.text, (a, b) => a === b))
          }
          if (event.data?.type === 'chip:agent-note' && event.data.note) {
            setAgentNote(event.data.note)
          }
          if (event.data?.type === 'chip:user-action-request' && event.data.request) {
            setActionRequests((prev) => appendUniqueRecent(prev, event.data.request, sameActionRequest))
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Storage event fallback
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'chip_last_agent_msg' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed.text) setAgentMessages((prev) => appendUniqueRecent(prev, parsed.text, (a, b) => a === b))
        } catch {
          // ignore
        }
      }
      if (e.key === 'chip_agent_note' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed.note) setAgentNote(parsed.note)
        } catch {
          // ignore
        }
      }
      if (e.key === 'chip_user_action_request' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed.request) {
            setActionRequests((prev) => appendUniqueRecent(prev, parsed.request, sameActionRequest))
          }
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('chip:agent-message', handleLocal)
      window.removeEventListener('chip:agent-note', handleNote)
      window.removeEventListener('chip:user-action-request', handleActionRequest)
      window.removeEventListener('storage', handleStorage)
      if (bc) bc.close()
    }
  }, [])

  useEffect(() => {
    if (open && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [cleanSummary, agentMessages, actionRequests, agentNote, open])

  if (!open) return null

  return (
    <div className="w-[280px] shrink-0 border border-[#e5e5e5] bg-[#f5f5f5] rounded-xl flex flex-col overflow-hidden m-2">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#efefef] shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#888] opacity-50" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#222]" />
          </span>
          <span className="text-[12px] font-semibold text-black">Agent</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#666]">
            {agentConnected ? 'connected' : boardConnected ? 'ready' : 'waiting'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#ccc] hover:text-black transition-colors p-1 rounded hover:bg-[#f5f5f5] cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Status row — neutral mono */}
      <div className="px-4 py-2 border-b border-[#f5f5f5] flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#555]">
          {boardConnected ? (chipModel ?? 'board') : 'no board'}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#555]">
          {baudRate}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#555]">
          {cloudConnected ? 'gateway ●' : 'gateway ○'}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#555]">
          webmcp ●
        </span>
      </div>

      {/* Live digest */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
        <p className="text-[10px] uppercase font-semibold text-[#c0c0c0] tracking-wider mb-2">Live Digest</p>

        {cleanSummary.length === 0 && agentMessages.length === 0 && actionRequests.length === 0 && !agentNote ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center py-12">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d8d8d8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-[11px] text-[#ccc] leading-relaxed">
              {!boardConnected ? 'Connect your board to start' : 'Waiting for events…'}
            </p>
          </div>
        ) : (
          <>
            {cleanSummary.map((item, idx) => (
              <div
                key={`log-${idx}`}
                className="flex items-start gap-2 bg-[#fafafa] border border-[#f0f0f0] rounded-lg px-3 py-2"
              >
                <span className="text-[#999] font-bold text-[11px] shrink-0 mt-px">›</span>
                <span className="text-[11px] text-[#333] leading-snug">{item}</span>
              </div>
            ))}
            {agentNote && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-amber-700 font-bold text-[11px] shrink-0 mt-px">!</span>
                <span className="text-[11px] text-amber-950 leading-snug">{agentNote}</span>
              </div>
            )}
            {agentMessages.map((msg, idx) => (
              <div
                key={`agent-${idx}`}
                className="flex items-start gap-2 bg-[#f0f4ff] border border-[#dde6ff] rounded-lg px-3 py-2"
              >
                <span className="text-[#4a6fff] font-bold text-[11px] shrink-0 mt-px">✦</span>
                <span className="text-[11px] text-[#1a2a66] leading-snug">{msg}</span>
              </div>
            ))}
            {actionRequests.map((request, idx) => (
              <div
                key={`action-${idx}`}
                className="flex items-start gap-2 bg-white border border-[#d9d9d9] rounded-lg px-3 py-2"
              >
                <span className="text-black font-bold text-[11px] shrink-0 mt-px">?</span>
                <span className="text-[11px] text-[#222] leading-snug">
                  <span className="font-semibold font-mono">{request.action}</span>: {request.reason}
                  {request.details ? <span className="block text-[#666] mt-1">{request.details}</span> : null}
                </span>
              </div>
            ))}
          </>
        )}
        <div ref={logEndRef} />
      </div>

      {/* MCP Connection URL */}
      <div className="px-4 py-3 border-t border-[#ebebeb] shrink-0">
        <p className="text-[9px] uppercase font-semibold text-[#bbb] tracking-wider mb-1.5">Connect Agent</p>
        <div className="flex items-center gap-1.5 bg-white border border-[#e5e5e5] rounded-lg px-2.5 py-1.5">
          <span className="text-[9.5px] font-mono text-[#555] truncate flex-1 select-all">{MCP_URL}</span>
          <button
            onClick={copyMcpUrl}
            title="Copy MCP URL"
            className="shrink-0 text-[#bbb] hover:text-black transition-colors cursor-pointer"
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>

    </div>
  )
}
