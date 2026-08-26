import { useState, useRef, useEffect } from 'react'

interface CompanionPreviewProps {
  htmlContent: string | null
  jobTitle?: string
  recentSerialLine?: string | null
}

export function CompanionPreview({ htmlContent, jobTitle, recentSerialLine }: CompanionPreviewProps) {
  const [key, setKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [liveDataCount, setLiveDataCount] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleReload = () => setKey((prev) => prev + 1)

  // Forward every new serial line from the board into the companion iframe via postMessage
  useEffect(() => {
    if (!recentSerialLine || !iframeRef.current?.contentWindow) return
    // Skip Chip system/flash messages — only forward lines that look like board data
    const skip = recentSerialLine.startsWith('[FLASH') ||
                 recentSerialLine.startsWith('[ERROR') ||
                 recentSerialLine.startsWith('[CHIP') ||
                 recentSerialLine.startsWith('[INFO')
    if (skip) return

    let parsed = null
    try {
      parsed = JSON.parse(recentSerialLine)
    } catch {
      // plain text line
    }

    iframeRef.current.contentWindow.postMessage(
      {
        type: 'SERIAL_LINE',
        line: recentSerialLine,
        data: parsed || recentSerialLine,
      },
      '*'
    )
    setLiveDataCount((n) => n + 1)
  }, [recentSerialLine])

  // No companion compiled yet — clean idle state
  if (!htmlContent) {
    return (
      <div className="flex flex-col bg-[#141414] border border-[#2a2a2a] rounded h-[360px] font-mono select-none">
        <div className="h-8 bg-[#1f1f1f] border-b border-[#2a2a2a] px-3 flex items-center justify-between text-xs text-[#888888]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#525252]" />
            <span className="text-[11px] text-[#737373] font-medium">Board Companion Preview</span>
          </div>
          <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-[#525252]">No companion</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
          <div className="text-xs text-[#525252] font-medium">No companion compiled yet</div>
          <div className="text-[11px] text-[#404040] leading-relaxed max-w-xs">
            Connect your board, then ask Claude to compile and flash a sketch.
            Claude will generate an interactive companion that receives live data
            from your board over USB — no WiFi needed.
          </div>
        </div>

        <div className="border-t border-[#1f1f1f] px-3 py-2 text-[10px] text-[#3a3a3a] flex justify-between">
          <span>Awaiting firmware compilation</span>
          <span>Board → USB → Serial → Preview</span>
        </div>
      </div>
    )
  }

  // Companion HTML available — render it and pipe live serial board data in
  return (
    <div className={`flex flex-col bg-[#141414] border border-[#2a2a2a] rounded overflow-hidden ${fullscreen ? 'fixed inset-4 z-50 shadow-2xl' : 'h-[360px]'}`}>
      {/* Top Bar */}
      <div className="h-8 bg-[#1f1f1f] border-b border-[#2a2a2a] px-3 flex items-center justify-between text-xs text-[#888888] select-none">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${liveDataCount > 0 ? 'bg-[#16a34a] animate-pulse' : 'bg-[#eab308]'}`} />
          <span className="font-mono text-[11px] text-[#e5e5e5] font-medium truncate max-w-[220px]">
            {jobTitle || 'Board Companion Preview'}
          </span>
          <span className="text-[10px] bg-[#22c55e]/10 text-[#4ade80] px-1.5 py-0.5 rounded border border-[#22c55e]/20 font-mono">
            Preview
          </span>
          {liveDataCount > 0 && (
            <span className="text-[10px] bg-[#3b82f6]/10 text-[#60a5fa] px-1.5 py-0.5 rounded border border-[#3b82f6]/20 font-mono">
              Live from board · {liveDataCount} lines
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleReload}
            className="p-1 hover:text-white rounded hover:bg-white/10 transition-colors cursor-pointer"
            title="Reload Companion"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 hover:text-white rounded hover:bg-white/10 transition-colors cursor-pointer"
            title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area: Visualizer + Live Hardware Terminal */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 bg-[#0d0d0d]">
        {/* Visualizer iframe */}
        <div className="flex-1 border-b md:border-b-0 md:border-r border-[#222222] relative flex flex-col min-h-[180px]">
          <iframe
            key={key}
            ref={iframeRef}
            srcDoc={htmlContent}
            title="Board Companion Preview"
            sandbox="allow-scripts allow-forms allow-modals"
            className="w-full flex-1 border-none bg-[#0d0d0d]"
          />
        </div>

        {/* Live Hardware Terminal Monitor */}
        <div className="w-full md:w-80 flex flex-col bg-[#111111] shrink-0 font-mono text-[11px]">
          <div className="h-7 bg-[#181818] border-b border-[#222222] px-3 flex items-center justify-between text-[#888888]">
            <span className="text-[10px] uppercase tracking-wider text-[#737373] font-semibold">Live Board Stream</span>
            <span className="text-[10px] text-[#22c55e]">USB 115200</span>
          </div>

          <div className="flex-1 p-2.5 overflow-y-auto space-y-1 text-[#a3a3a3] select-text">
            <div className="text-[#525252]">[HARDWARE] Listening on Web Serial…</div>
            {recentSerialLine && !recentSerialLine.startsWith('[FLASH') && !recentSerialLine.startsWith('[INFO') && (
              <div className="text-[#4ade80] break-all">
                <span className="text-[#60a5fa]">&gt; </span>{recentSerialLine}
              </div>
            )}
            <div className="text-[#404040] text-[10px] pt-1">
              Telemetry routed directly from ESP32 memory.
            </div>
          </div>
        </div>
      </div>

      {/* Live data status bar */}
      <div className="bg-[#141414] border-t border-[#1f1f1f] px-3 py-1.5 flex items-center justify-between text-[10px] font-mono text-[#555555]">
        <span>ESP32 Flash Memory → USB Serial → Live Visualizer</span>
        {liveDataCount > 0
          ? <span className="text-[#22c55e]">Streaming real-time hardware telemetry</span>
          : <span className="text-[#eab308]">Awaiting next serial frame…</span>
        }
      </div>
    </div>
  )
}
