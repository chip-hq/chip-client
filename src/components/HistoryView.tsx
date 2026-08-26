import { useState, useEffect, useRef } from 'react'
import { CompanionPreview } from './CompanionPreview'

export interface JobItem {
  jobId: string
  userId?: string
  phase?: 'compile' | 'flash'
  board?: string
  status: 'pending' | 'compiling' | 'started' | 'flashing' | 'done' | 'error'
  progress?: number
  error?: string
  log?: string[]
  binBase64?: string
  binSize?: number
  offset?: string
  filename?: string
  sourceCode?: string
  webCompanion?: string
  createdAt?: string | Date
  updatedAt?: string | Date
}

interface HistoryViewProps {
  backendUrl: string
  connected: boolean
  refreshKey?: number
  onFlashBinary?: (binBase64: string, offset: string, filename: string) => void
  showAlert: (type: 'error' | 'success' | 'info', message: string, title?: string) => void
}

type ActiveTab = 'code' | 'binary' | 'log' | 'companion'

export function HistoryView({ backendUrl, connected, refreshKey, onFlashBinary, showAlert }: HistoryViewProps) {
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const selectedJobIdRef = useRef<string | null>(null)
  selectedJobIdRef.current = selectedJobId

  const [activeTab, setActiveTab] = useState<ActiveTab>('code')
  const [copied, setCopied] = useState(false)

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/jobs`)
      if (res.ok) {
        const data = await res.json()
        // Only show compile jobs — flash jobs are relay-only events with no source code
        const fetched: JobItem[] = (data.jobs || []).filter(
          (j: JobItem) => j.phase === 'compile' || j.jobId?.startsWith('compile_')
        )
        setJobs(fetched)

        // Lock to current selection if already selected, otherwise set to first
        if (!selectedJobIdRef.current && fetched.length > 0) {
          setSelectedJobId(fetched[0].jobId)
        }
      }
    } catch (err) {
      console.warn('Failed to fetch jobs history:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [backendUrl, refreshKey])

  const selectedJob = jobs.find((j) => j.jobId === selectedJobId) || (jobs.length > 0 ? jobs[0] : null)

  const handleCopyCode = () => {
    if (!selectedJob?.sourceCode) return
    navigator.clipboard.writeText(selectedJob.sourceCode)
    setCopied(true)
    showAlert('info', 'C++ code copied to clipboard', 'Copied')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadBin = () => {
    if (!selectedJob?.binBase64) {
      showAlert('error', 'No compiled binary available for this job', 'Download Failed')
      return
    }

    try {
      const byteCharacters = atob(selectedJob.binBase64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selectedJob.filename || `${selectedJob.jobId}.bin`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showAlert('success', `Downloaded ${selectedJob.filename || 'firmware.bin'}`, 'Download Started')
    } catch (err) {
      showAlert('error', `Download error: ${String(err)}`, 'Download Failed')
    }
  }

  const handleFlashThisJob = () => {
    if (!selectedJob?.binBase64) {
      showAlert('error', 'No compiled binary available to flash', 'Flash Failed')
      return
    }
    if (!connected) {
      showAlert('error', 'Please connect your ESP32 board in the Dashboard tab first', 'Board Not Connected')
      return
    }
    if (onFlashBinary) {
      onFlashBinary(
        selectedJob.binBase64,
        selectedJob.offset || '0x0',
        selectedJob.filename || `${selectedJob.jobId}.bin`
      )
    }
  }

  const [showClearModal, setShowClearModal] = useState(false)
  const [clearing, setClearing] = useState(false)

  const confirmClearAll = async () => {
    setClearing(true)
    try {
      let res = await fetch(`${backendUrl}/api/jobs`, { method: 'DELETE' })
      if (!res.ok && res.status === 404) {
        // Fallback to POST /api/jobs/clear
        res = await fetch(`${backendUrl}/api/jobs/clear`, { method: 'POST' })
      }

      if (res.ok) {
        setJobs([])
        setSelectedJobId(null)
        selectedJobIdRef.current = null
        showAlert('success', 'Build history successfully cleared', 'History Cleared')
        setShowClearModal(false)
      } else {
        const errJson = await res.json().catch(() => ({}))
        showAlert('error', errJson.error || `Server returned status ${res.status}`, 'Clear Failed')
      }
    } catch (err) {
      showAlert('error', `Network error: ${String(err)}`, 'Clear Failed')
    } finally {
      setClearing(false)
    }
  }

  const formatTime = (dateInput?: string | Date) => {
    if (!dateInput) return '—'
    const date = new Date(dateInput)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateInput?: string | Date) => {
    if (!dateInput) return '—'
    const date = new Date(dateInput)
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  // Split lines for line numbers
  const codeLines = (selectedJob?.sourceCode || '').split('\n')

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-md overflow-hidden flex flex-col md:flex-row h-[calc(100vh-140px)] min-h-[560px] select-none">
      {/* ── Left Column: Clean VSCode / Cursor Explorer ──────────────────────── */}
      <div className="w-full md:w-64 bg-[#fcfcfc] border-r border-[#e5e5e5] flex flex-col shrink-0">
        {/* Explorer Header */}
        <div className="h-9 px-3 border-b border-[#e5e5e5] flex items-center justify-between bg-[#f8f8f8]">
          <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Builds ({jobs.length})
          </span>
          <div className="flex items-center gap-1">
            {jobs.length > 0 && (
              <button
                onClick={() => setShowClearModal(true)}
                className="text-[#888888] hover:text-[#dc2626] p-1 rounded cursor-pointer transition-colors"
                title="Clear all build history"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            )}
            <button
              onClick={fetchJobs}
              className="text-[#888888] hover:text-black p-1 rounded cursor-pointer transition-colors"
              title="Refresh history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Job List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0]">
          {loading && jobs.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#888888]">Loading builds…</div>
          ) : jobs.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#888888]">No builds yet</div>
          ) : (
            jobs.map((job) => {
              const isSelected = selectedJob?.jobId === job.jobId
              return (
                <button
                  key={job.jobId}
                  onClick={() => setSelectedJobId(job.jobId)}
                  className={`w-full text-left px-3 py-2 transition-colors cursor-pointer block text-xs ${
                    isSelected
                      ? 'bg-[#ebebeb] text-black font-medium'
                      : 'text-[#555555] hover:bg-[#f3f3f3] hover:text-black'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          job.status === 'done'
                            ? 'bg-[#16a34a]'
                            : job.status === 'error'
                            ? 'bg-[#dc2626]'
                            : 'bg-[#f59e0b]'
                        }`}
                      />
                      <span className="font-mono text-[11px] truncate">
                        {job.phase === 'compile' ? 'main.cpp' : 'flash'}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#888888] shrink-0 font-mono">
                      {formatTime(job.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#888888] font-mono pl-3">
                    <span>{job.board || 'esp32'}</span>
                    <span>{formatDate(job.createdAt)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right Column: Clean Code Editor & Terminal Pane ──────────────────── */}
      <div className="flex-1 flex flex-col bg-[#141414] text-[#d4d4d4] overflow-hidden min-w-0">
        {/* Editor Tab Bar */}
        <div className="h-9 bg-[#1f1f1f] border-b border-[#2d2d2d] flex items-center justify-between px-2 shrink-0 select-none">
          {/* File Tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('code')}
              className={`h-7 px-3 text-xs font-mono rounded-t flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'code'
                  ? 'bg-[#141414] text-white font-medium border-t-2 border-[#38bdf8]'
                  : 'text-[#888888] hover:text-white'
              }`}
            >
              <span>main.cpp</span>
              {selectedJob?.sourceCode && <span className="text-[10px] text-[#38bdf8]">C++</span>}
            </button>

            <button
              onClick={() => setActiveTab('binary')}
              className={`h-7 px-3 text-xs font-mono rounded-t flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'binary'
                  ? 'bg-[#141414] text-white font-medium border-t-2 border-[#10b981]'
                  : 'text-[#888888] hover:text-white'
              }`}
            >
              <span>{selectedJob?.filename || 'firmware.bin'}</span>
              {selectedJob?.binSize && (
                <span className="text-[10px] text-[#10b981]">
                  {(selectedJob.binSize / 1024).toFixed(0)}KB
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('log')}
              className={`h-7 px-3 text-xs font-mono rounded-t flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'log'
                  ? 'bg-[#141414] text-white font-medium border-t-2 border-[#f59e0b]'
                  : 'text-[#888888] hover:text-white'
              }`}
            >
              <span>build.log</span>
            </button>

            {selectedJob?.webCompanion && (
              <button
                onClick={() => setActiveTab('companion')}
                className={`h-7 px-3 text-xs font-mono rounded-t flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === 'companion'
                    ? 'bg-[#141414] text-white font-medium border-t-2 border-[#22c55e]'
                    : 'text-[#888888] hover:text-white'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                <span>AI Companion</span>
              </button>
            )}
          </div>

          {/* Right Action Toolbar */}
          <div className="flex items-center gap-1.5">
            {activeTab === 'code' && selectedJob?.sourceCode && (
              <button
                onClick={handleCopyCode}
                className="h-6 px-2 text-[11px] bg-[#2a2a2a] hover:bg-[#333333] text-white rounded transition-colors cursor-pointer flex items-center gap-1 font-mono"
              >
                <span>{copied ? '✓ Copied' : 'Copy'}</span>
              </button>
            )}

            {selectedJob?.binBase64 && (
              <button
                onClick={handleDownloadBin}
                className="h-6 px-2 text-[11px] bg-[#2a2a2a] hover:bg-[#333333] text-white rounded transition-colors cursor-pointer flex items-center gap-1 font-mono"
                title="Download .bin"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>.bin</span>
              </button>
            )}

            {selectedJob?.binBase64 && (
              <button
                onClick={handleFlashThisJob}
                disabled={!connected}
                className="h-6 px-2.5 text-[11px] bg-white hover:bg-[#f0f0f0] text-black font-semibold rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 font-mono"
                title={connected ? 'Flash this build to board' : 'Connect board in dashboard to flash'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Flash</span>
              </button>
            )}
          </div>
        </div>

        {/* Editor Body */}
        <div className="flex-1 overflow-auto font-mono text-xs select-text">
          {/* TAB 1: C++ Code with Line Numbers */}
          {activeTab === 'code' && (
            selectedJob?.sourceCode ? (
              <div className="flex min-w-full min-h-full py-2">
                {/* Gutter / Line Numbers */}
                <div className="w-10 select-none text-right pr-3 text-[#555555] font-mono text-[11px] leading-relaxed border-r border-[#222222]">
                  {codeLines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Source Code Content */}
                <div className="flex-1 pl-4 text-[#e0e0e0] font-mono text-[12px] leading-relaxed whitespace-pre">
                  {selectedJob.sourceCode}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[#666666] text-xs">
                No source code available for this job.
              </div>
            )
          )}

          {/* TAB 2: Binary Info */}
          {activeTab === 'binary' && (
            <div className="p-6 max-w-lg space-y-4 font-mono text-xs text-[#cccccc]">
              <div className="text-sm font-semibold text-white mb-2">
                Firmware Artifact
              </div>
              <div className="bg-[#1e1e1e] border border-[#2a2a2a] p-4 rounded space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-[#888888]">File:</span>
                  <span className="text-white">{selectedJob?.filename || 'firmware.bin'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#888888]">Target Flash Offset:</span>
                  <span className="text-[#38bdf8]">{selectedJob?.offset || '0x0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#888888]">Size:</span>
                  <span className="text-[#10b981]">
                    {selectedJob?.binSize ? `${selectedJob.binSize} bytes (${(selectedJob.binSize / 1024).toFixed(1)} KB)` : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#888888]">Status:</span>
                  <span className="capitalize text-white">{selectedJob?.status}</span>
                </div>
              </div>

              {selectedJob?.binBase64 && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleDownloadBin}
                    className="h-8 px-3 bg-[#2a2a2a] hover:bg-[#333333] text-white rounded transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    Download .bin file
                  </button>
                  <button
                    onClick={handleFlashThisJob}
                    disabled={!connected}
                    className="h-8 px-3.5 bg-white hover:bg-[#f0f0f0] text-black font-semibold rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    Flash to ESP32
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Build & Compiler Log */}
          {activeTab === 'log' && (
            <div className="p-4 font-mono text-[11px] leading-relaxed text-[#a3a3a3]">
              {selectedJob?.log && selectedJob.log.length > 0 ? (
                selectedJob.log.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-[#666666]">No log output recorded.</div>
              )}
            </div>
          )}

          {/* TAB 4: Live AI Companion Preview */}
          {activeTab === 'companion' && selectedJob?.webCompanion && (
            <div className="p-3 h-full">
              <CompanionPreview
                htmlContent={selectedJob.webCompanion}
                jobTitle={`Companion: ${selectedJob.filename || 'main.cpp'}`}
              />
            </div>
          )}
        </div>

        {/* Bottom Editor Status Bar */}
        <div className="h-6 bg-[#0f0f0f] border-t border-[#222222] px-3 flex items-center justify-between text-[10px] font-mono text-[#777777] shrink-0">
          <div className="flex items-center gap-3">
            <span>{selectedJob?.board || 'esp32'}</span>
            <span>•</span>
            <span className="capitalize">{selectedJob?.status || 'idle'}</span>
          </div>
          <div>UTF-8 • C++ / PlatformIO</div>
        </div>
      </div>

      {/* ── Custom Confirmation Modal ────────────────────────────────────────── */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-150">
          <div className="bg-white border border-[#e5e5e5] rounded-md p-6 max-w-sm w-full shadow-lg space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] flex items-center justify-center shrink-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-black tracking-tight">
                  Clear Build History
                </h3>
                <p className="text-xs text-[#666666] mt-1 leading-relaxed">
                  Are you sure you want to delete all past compile and flash jobs? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                disabled={clearing}
                className="h-8 px-3 text-xs font-medium text-black bg-white hover:bg-[#f0f0f0] border border-[#d1d5db] rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClearAll}
                disabled={clearing}
                className="h-8 px-3.5 text-xs font-medium text-white bg-[#dc2626] hover:bg-[#b91c1c] rounded transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
              >
                {clearing ? 'Deleting…' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
