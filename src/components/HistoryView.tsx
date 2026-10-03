import { useState, useEffect, useCallback } from 'react'
import { CompanionPreview } from './CompanionPreview'

export interface JobItem {
  jobId: string
  userId?: string
  phase?: 'compile' | 'flash'
  board?: string
  platform?: string | null
  artifact?: string | null
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
  userId: string
  refreshKey?: number
  onOpenInCode?: (jobId: string) => void
  onFlashFile?: (file: { name: string; board?: string; artifact?: string; offset?: string; data: Uint8Array }) => void
  showAlert: (type: 'error' | 'success' | 'info', message: string, title?: string) => void
}

export function HistoryView({ backendUrl, userId, refreshKey, onOpenInCode, onFlashFile, showAlert }: HistoryViewProps) {
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Detail page: null = full-screen list, otherwise the opened build (full doc).
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<JobItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showCompanion, setShowCompanion] = useState(false)
  const [flashing, setFlashing] = useState(false)

  const fetchJobs = useCallback(async () => {
    try {
      const q = `userId=${encodeURIComponent(userId)}`
      const res = await fetch(`${backendUrl}/api/jobs?${q}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`Backend returned ${res.status}`)
      const data = await res.json()
      // Only show compile jobs - flash jobs are relay-only events with no source code
      const fetched: JobItem[] = (data.jobs || []).filter(
        (j: JobItem) => j.phase === 'compile' || j.jobId?.startsWith('compile_')
      )
      setJobs(fetched)
      setLoadError(null)
    } catch (err) {
      console.warn('Failed to fetch jobs history:', err)
      setLoadError(err instanceof Error ? err.message : 'Could not load builds')
    } finally {
      setLoading(false)
    }
  }, [backendUrl, userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load + 5s poll; setState runs after the awaited fetch
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs, refreshKey])

  const openDetail = useCallback(async (jobId: string) => {
    setDetailId(jobId)
    setDetail(null)
    setShowLog(false)
    setShowCompanion(false)
    setDetailLoading(true)
    try {
      const res = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}?full=1`)
      if (res.ok) {
        setDetail(await res.json())
      } else {
        showAlert('error', 'Could not load build details', 'Open Failed')
        setDetailId(null)
      }
    } catch {
      showAlert('error', 'Could not load build details', 'Open Failed')
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }, [backendUrl, showAlert])

  const downloadBin = useCallback(async (job: JobItem) => {
    try {
      const res = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(job.jobId)}/download`)
      if (!res.ok) throw new Error('No compiled binary available for this job')
      const buf = new Uint8Array(await res.arrayBuffer())
      const blob = new Blob([buf as unknown as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = job.filename || `${job.jobId}.bin`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showAlert('success', `Downloaded ${job.filename || 'firmware.bin'}`, 'Download Started')
    } catch (err) {
      showAlert('error', err instanceof Error ? err.message : String(err), 'Download Failed')
    }
  }, [backendUrl, showAlert])

  const flashDetail = useCallback(async () => {
    if (!detail || flashing) return
    setFlashing(true)
    try {
      const res = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(detail.jobId)}/download`)
      if (!res.ok) throw new Error('No compiled binary available for this job')
      const data = new Uint8Array(await res.arrayBuffer())
      onFlashFile?.({
        name: detail.filename || `${detail.jobId}.bin`,
        board: detail.board,
        artifact: (detail as JobItem & { artifact?: string }).artifact,
        offset: detail.offset,
        data,
      })
    } catch (err) {
      showAlert('error', err instanceof Error ? err.message : String(err), 'Flash Failed')
    } finally {
      setFlashing(false)
    }
  }, [backendUrl, detail, flashing, onFlashFile, showAlert])

  const [showClearModal, setShowClearModal] = useState(false)
  const [clearing, setClearing] = useState(false)

  const confirmClearAll = async () => {
    setClearing(true)
    try {
      const q = `userId=${encodeURIComponent(userId)}`
      let res = await fetch(`${backendUrl}/api/jobs?${q}`, { method: 'DELETE' })
      if (!res.ok && res.status === 404) {
        // Fallback to POST /api/jobs/clear
        res = await fetch(`${backendUrl}/api/jobs/clear?${q}`, { method: 'POST' })
      }

      if (res.ok) {
        setJobs([])
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

  // Apps-style row helpers (icon tile, relative updated time)
  const TILE_COLORS = ['#16a34a', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6']
  const tileColor = (id: string) => {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return TILE_COLORS[h % TILE_COLORS.length]
  }
  const timeAgo = (dateInput?: string | Date) => {
    if (!dateInput) return '-'
    const s = Math.max(0, Math.round((Date.now() - new Date(dateInput).getTime()) / 1000))
    if (s < 60) return s <= 5 ? 'just now' : `${s} seconds ago`
    const m = Math.floor(s / 60)
    if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`
    const h = Math.floor(m / 60)
    if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`
    const d = new Date(dateInput)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const formatCreated = (dateInput?: string | Date) => {
    if (!dateInput) return ''
    const d = new Date(dateInput)
    return `Created ${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  const statusLabel = (job: JobItem) =>
    job.status === 'done' ? 'Compiled' : job.status === 'error' ? 'Failed' : 'Building…'
  const sizeLabel = (job: JobItem) =>
    job.binSize ? ` · ${(job.binSize / 1024).toFixed(0)}KB` : ''

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-md overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[#e5e5e5] flex items-center justify-between bg-[#f8f8f8]">
        <span className="text-[12px] font-semibold text-black tracking-tight">
          Builds ({jobs.length})
        </span>
        <div className="flex items-center gap-1">
          {jobs.length > 0 && (
            <button
              onClick={() => setShowClearModal(true)}
              className="text-[#888888] hover:text-[#dc2626] p-1 rounded cursor-pointer transition-colors"
              title="Clear all build history"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M21 21v-5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Column headers (list only) */}
      {!detailId && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[#e5e5e5] text-[12px] font-medium text-[#666]">
          <span className="w-9 shrink-0" aria-hidden="true" />
          <span className="grow">Name</span>
          <span className="w-40 shrink-0 text-right hidden sm:block">Updated</span>
        </div>
      )}

      {detailId ? (
        /* ── Build detail page: pick what to open ── */
        <div>
          <div className="px-4 py-3 border-b border-[#e5e5e5] flex items-center gap-3">
            <button
              onClick={() => { setDetailId(null); setDetail(null); setShowLog(false); setShowCompanion(false) }}
              className="text-[12px] font-medium text-[#555] hover:text-black cursor-pointer shrink-0"
            >
              ← Builds
            </button>
            {detailLoading || !detail ? (
              <span className="text-[12px] text-[#888]">Loading build…</span>
            ) : (
              <>
                <span
                  className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-[14px] font-semibold"
                  style={{ background: tileColor(detail.jobId) }}
                  aria-hidden="true"
                >
                  {((detail.filename || detail.jobId)[0] || 'F').toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-black truncate">{detail.filename || detail.jobId}</span>
                  <span className="block text-[11px] text-[#777]">
                    {detail.board || 'esp32'}{detail.platform ? ` · ${detail.platform}` : ''} · {statusLabel(detail)}{sizeLabel(detail)}
                  </span>
                </span>
              </>
            )}
          </div>
          {detail && (
          <div className="divide-y divide-[#f0f0f0]">
            <button
              onClick={() => onOpenInCode?.(detail.jobId)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            >
              <span className="text-[#569cd6] shrink-0" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </span>
              <span className="grow min-w-0">
                <span className="block text-[13px] font-medium text-black">Code</span>
                <span className="block text-[11px] text-[#777]">main.cpp - review, edit and approve in the Code tab</span>
              </span>
              <span className="text-[#aaa] shrink-0" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
            <button
              onClick={() => void downloadBin(detail)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            >
              <span className="text-[#10b981] shrink-0" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
              </span>
              <span className="grow min-w-0">
                <span className="block text-[13px] font-medium text-black">Binary file</span>
                <span className="block text-[11px] text-[#777] truncate">{detail.filename || 'firmware.bin'}{detail.binSize ? ` · ${(detail.binSize / 1024).toFixed(0)}KB` : ''}</span>
              </span>
              <span className="text-[#aaa] shrink-0" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
            <button
              onClick={() => void flashDetail()}
              disabled={flashing || !detail.binSize}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-40"
            >
              <span className="text-black shrink-0" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
              <span className="grow min-w-0">
                <span className="block text-[13px] font-medium text-black">{flashing ? 'Flashing…' : 'Flash now'}</span>
                <span className="block text-[11px] text-[#777]">Write this build straight to the connected board</span>
              </span>
              <span className="text-[#aaa] shrink-0" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
            <button
              onClick={() => setShowLog((v) => !v)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            >
              <span className="text-[#f59e0b] shrink-0" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" x2="20" y1="19" y2="19" />
                </svg>
              </span>
              <span className="grow min-w-0">
                <span className="block text-[13px] font-medium text-black">Build log</span>
                <span className="block text-[11px] text-[#777]">{showLog ? 'Hide output' : 'Show compiler output'}</span>
              </span>
              <span className="text-[#aaa] shrink-0" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showLog ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
            {showLog && (
              <div className="px-4 py-3 bg-[#141414] font-mono text-[11px] leading-5 text-[#d4d4d4] overflow-x-auto max-h-72 overflow-y-auto">
                {(detail.log && detail.log.length > 0 ? detail.log : ['No log output recorded.']).map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                ))}
              </div>
            )}
            {detail.webCompanion && (
              <button
                onClick={() => setShowCompanion((v) => !v)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <span className="text-[#16a34a] shrink-0" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.88 5.76a2 2 0 0 0 1.36 1.36L21 12l-5.76 1.88a2 2 0 0 0-1.36 1.36L12 21l-1.88-5.76a2 2 0 0 0-1.36-1.36L3 12l5.76-1.88a2 2 0 0 0 1.36-1.36L12 3z" />
                  </svg>
                </span>
                <span className="grow min-w-0">
                  <span className="block text-[13px] font-medium text-black">AI Companion</span>
                  <span className="block text-[11px] text-[#777]">{showCompanion ? 'Hide preview' : 'Show visualizer preview'}</span>
                </span>
                <span className="text-[#aaa] shrink-0" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showCompanion ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>
            )}
            {showCompanion && detail.webCompanion && (
              <div className="p-3">
                <CompanionPreview
                  htmlContent={detail.webCompanion}
                  jobTitle={`Companion: ${detail.filename || 'main.cpp'}`}
                />
              </div>
            )}
          </div>
          )}
        </div>
      ) : (
      <>
      {/* Full-width build list - a click opens the build page */}
      <div className="divide-y divide-[#f0f0f0]">
        {loading && jobs.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#888888]">Loading builds…</div>
        ) : loadError && jobs.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#b45309]">
            <div>Could not load builds.</div>
            <button type="button" className="ghost sm mt-2" onClick={() => void fetchJobs()}>Retry</button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#888888]">No builds yet</div>
        ) : (
           jobs.map((job) => {
             const name = job.filename || job.jobId
             const letter = (name[0] || 'F').toUpperCase()
             return (
               <div
                 key={job.jobId}
                 onClick={() => void openDetail(job.jobId)}
                 role="button"
                 tabIndex={0}
                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(job.jobId) } }}
                 title="Open build options"
                 className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#f5f5f5] transition-colors cursor-pointer"
               >
                 <span
                   className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white text-[15px] font-semibold"
                   style={{ background: tileColor(job.jobId) }}
                   aria-hidden="true"
                 >
                   {letter}
                 </span>
                 <span className="grow min-w-0">
                   <span className="block text-[13px] font-medium text-black truncate">{name}</span>
                   <span className="block text-[11px] text-[#777] truncate">
                     {job.board || 'esp32'}{job.platform ? ` · ${job.platform}` : ''} · {statusLabel(job)}{sizeLabel(job)}
                   </span>
                 </span>
                 <button
                   type="button"
                   onClick={async (e) => {
                     e.stopPropagation()
                     try {
                       await navigator.clipboard.writeText(job.jobId)
                       showAlert('success', 'Job ID copied to clipboard.', 'Copied')
                     } catch {
                       showAlert('error', 'Clipboard access was blocked by the browser.', 'Copy Failed')
                     }
                   }}
                   className="shrink-0 text-[#999] hover:text-black p-1 rounded cursor-pointer transition-colors"
                   title="Copy job ID"
                 >
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                     <rect width="14" height="14" x="9" y="9" rx="2" ry="2" />
                     <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                   </svg>
                 </button>
                 <span className="w-40 shrink-0 text-right hidden sm:block">
                   <span className="block text-[12px] text-[#444]">{timeAgo(job.updatedAt ?? job.createdAt)}</span>
                   <span className="block text-[11px] text-[#999]">{formatCreated(job.createdAt)}</span>
                 </span>
               </div>
             )
           })
        )}
      </div>
      </>
      )}

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
