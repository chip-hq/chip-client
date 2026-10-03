/**
 * CodeEditor - full-page IDE for MCP-generated firmware (AI-Studio style).
 *
 * Layout: slim pipeline header → file explorer | tabbed editor → status bar.
 * Rev 1 is Claude's generated source; user edits save as new revisions;
 * removed lines paint red, added lines green; Approve releases for flash.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { CodePane } from './cppHighlight'

interface CodeEditorProps {
  backendUrl: string
  userId: string
  showAlert: (type: 'success' | 'error' | 'info', message: string, title?: string) => void
  onDirectFlash?: (jobId: string) => void
  refreshKey?: number
  openJobId?: string | null
}

interface RevMeta {
  rev: number
  author: string
  summary?: string | null
  createdAt?: string
  size?: number
}

interface DiffOp {
  type: 'same' | 'del' | 'add'
  oldNo: number | null
  newNo: number | null
  text: string
}

interface PipeStage {
  id: string
  label: string
  state: 'done' | 'active' | 'pending' | 'error'
  detail?: string
}

interface JobMeta {
  jobId: string
  board?: string | null
  platform?: string | null
  status: string
}

type Tab = { key: string; title: string; kind: 'main' | 'rev' | 'diff' }

/** Short pill labels - full stage names live in the tooltip. */
const STAGE_SHORT: Record<string, string> = {
  generated: 'Generated',
  in_review: 'Review',
  approved: 'Approved',
  compiled: 'Compiled',
  flashed: 'Flashed',
}

export function CodeEditor({ backendUrl, userId, showAlert, onDirectFlash, refreshKey, openJobId }: CodeEditorProps) {
  const [jobs, setJobs] = useState<JobMeta[]>([])
  const [jobId, setJobId] = useState('')
  const jobIdRef = useRef(jobId)
  const setJobIdRef = (id: string) => { jobIdRef.current = id; setJobId(id) }
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [revs, setRevs] = useState<RevMeta[]>([])
  const [revCache, setRevCache] = useState<Record<number, string>>({})
  const [approved, setApproved] = useState(false)
  const [tabs, setTabs] = useState<Tab[]>([{ key: 'main', title: 'main.cpp', kind: 'main' }])
  const [activeTab, setActiveTab] = useState('main')
  const [ops, setOps] = useState<DiffOp[]>([])
  const [counts, setCounts] = useState({ added: 0, removed: 0 })
  const [stages, setStages] = useState<PipeStage[]>([])
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [backendStale, setBackendStale] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [pipeFocus, setPipeFocus] = useState<string | null>(null)


  // Small screens start with the explorer tucked away (AI-Studio style).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches) {
      setExplorerOpen(false)
    }
  }, [])

  const q = `userId=${encodeURIComponent(userId)}`
  const jobsCacheKey = `chip_code_jobs_${userId}`

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/api/jobs?${q}`)
      if (!res.ok) return
      const data = await res.json()
      const list: JobMeta[] = (data.jobs || []).filter(
        (j: JobMeta & { phase?: string }) =>
          (j as { phase?: string }).phase === 'compile' || j.jobId?.startsWith('compile_'),
      )
      setJobs(list)
      try {
        sessionStorage.setItem(jobsCacheKey, JSON.stringify({ at: Date.now(), jobs: list }))
      } catch {
        // Cache is only an optimization.
      }
      if (!jobIdRef.current && list.length > 0) setJobId(list[0].jobId)
    } catch {
      // offline backend
    } finally {
      setLoading(false)
    }
  }, [backendUrl, jobsCacheKey, q])

  const loadCode = useCallback(async (id: string) => {
    if (!id) return
    try {
      const [codeRes, diffRes, pipeRes] = await Promise.all([
        fetch(`${backendUrl}/api/jobs/${encodeURIComponent(id)}/code?${q}`),
        fetch(`${backendUrl}/api/jobs/${encodeURIComponent(id)}/diff?from=1&to=latest&${q}`),
        fetch(`${backendUrl}/api/jobs/${encodeURIComponent(id)}/pipeline?${q}`),
      ])
      // Any 404 here while jobs exist = backend predates the review API.
      if ((codeRes.status === 404 || pipeRes.status === 404) && !codeRes.ok) {
        const probe = await codeRes.json().catch(() => null)
        if (probe && /not found/i.test(probe.error ?? '')) setBackendStale(true)
      }
      if (codeRes.ok) {
        setBackendStale(false)
        const c = await codeRes.json()
        setText(c.source ?? '')
        setSavedText(c.source ?? '')
        setRevs(Array.isArray(c.revisions) ? c.revisions : [])
        setApproved(!!c.approved)
        if (c.revCount > 0) {
          setRevCache((prev) => (prev[c.revCount] ? prev : { ...prev, [c.revCount]: c.source ?? '' }))
        }
      }
      if (diffRes.ok) {
        const d = await diffRes.json()
        setOps(Array.isArray(d.ops) ? d.ops : [])
        setCounts({ added: d.added ?? 0, removed: d.removed ?? 0 })
      }
      if (pipeRes.ok) {
        const p = await pipeRes.json()
        setStages(Array.isArray(p.stages) ? p.stages : [])
        setApproved(!!p.approved)
      }
    } catch {
      // keep last state
    }
  }, [backendUrl, userId])

  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(jobsCacheKey) || 'null') as { at?: number; jobs?: JobMeta[] } | null
      if (cached?.jobs?.length && Date.now() - (cached.at || 0) < 120_000) {
        setJobs(cached.jobs)
        setJobIdRef(cached.jobs[0].jobId)
        setLoading(false)
      }
    } catch {
      // Ignore malformed or unavailable browser cache.
    }
    void loadJobs()
    const t = setInterval(() => { void loadJobs() }, 8000)
    return () => clearInterval(t)
  }, [jobsCacheKey, loadJobs])

  // App-header Refresh (single refresh for the whole app).
  useEffect(() => {
    if (refreshKey == null) return
    void loadJobs()
    if (jobId) void loadCode(jobId)
  }, [refreshKey, jobId, loadJobs, loadCode])

  useEffect(() => {
    setTabs([{ key: 'main', title: 'main.cpp', kind: 'main' }])
    setActiveTab('main')
    setRevCache({})
    setPipeFocus(null)
    jobIdRef.current = jobId
    void loadCode(jobId)
  }, [jobId, loadCode])

  // Opened from Job History: jump straight to that build.
  useEffect(() => {
    if (openJobId) setJobIdRef(openJobId)
  }, [openJobId])

  const openTab = (tab: Tab) => {
    setTabs((prev) => (prev.some((t) => t.key === tab.key) ? prev : [...prev, tab]))
    setActiveTab(tab.key)
    if (tab.kind === 'rev') {
      const n = Number(tab.key.split(':')[1])
      setRevCache((prev) => {
        if (prev[n] != null) return prev
        void fetch(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}/code?rev=${n}&${q}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((c) => {
            if (c && typeof c.source === 'string') {
              setRevCache((p) => ({ ...p, [n]: c.source as string }))
            }
          })
          .catch(() => {})
        return prev
      })
    }
  }

  const closeTab = (key: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key)
      const safe = next.length > 0 ? next : [{ key: 'main', title: 'main.cpp', kind: 'main' } as Tab]
      if (activeTab === key) setActiveTab(safe[safe.length - 1].key)
      return next
    })
  }

  const dirty = text !== savedText
  const selected = jobs.find((j) => j.jobId === jobId)

  const removeRev = async (rev: number) => {
    if (!jobId) return
    if (!window.confirm(`Delete rev ${rev}? The code falls back to the newest remaining revision. This cannot be undone.`)) return
    // Never clobber in-progress edits: reload, then restore the draft text.
    const draft = dirty ? text : null
    try {
      const res = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}/code/revisions/${rev}?${q}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Delete failed')
      if (activeTab === `rev:${rev}`) closeTab(`rev:${rev}`)
      await loadCode(jobId)
      if (draft != null) setText(draft)
      showAlert('success', `Rev ${rev} deleted - now at rev ${data.latestRev} (${data.revCount} kept).`, 'Revision Deleted')
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : String(e), 'Delete Failed')
    }
  }

  const save = async (mode: 'draft' | 'revision') => {
    if (!jobId || !dirty || saving) return
    setSaving(true)
    const post = () => fetch(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}/code?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: text, summary: summary.trim() || null, mode }),
    })
    try {
      // One automatic retry: backend restarts drop in-flight requests.
      let res: Response
      try {
        res = await post()
      } catch (netErr) {
        await new Promise((r) => setTimeout(r, 1500))
        res = await post()
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`)
      setSavedText(text)
      setSummary('')
      showAlert(
        'success',
        mode === 'revision'
          ? `Checkpoint rev ${data.rev} saved (+${data.added}/−${data.removed}). Claude will see this diff.`
          : `Draft saved - no new revision (+${data.added}/−${data.removed} vs last save).`,
        mode === 'revision' ? 'Revision Saved' : 'Draft Saved',
      )
      void loadCode(jobId)
    } catch (e) {
      const detail = e instanceof TypeError
        ? `Cannot reach the backend at ${backendUrl} - is it running? (If two terminals run the backend, the port flaps: keep exactly one.)`
        : e instanceof Error ? e.message : String(e)
      showAlert('error', detail, 'Save Failed')
    } finally {
      setSaving(false)
    }
  }

  const approve = async (value: boolean) => {
    if (!jobId) return
    try {
      const res = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(jobId)}/approve?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: value }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Approve failed')
      setApproved(value)
      showAlert(value ? 'success' : 'info', value ? 'Build approved - tell Claude to continue to flash.' : 'Approval withdrawn.', 'Review')
      void loadCode(jobId)
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : String(e), 'Review Failed')
    }
  }

  const activeRevTab = activeTab.startsWith('rev:')
    ? Number(activeTab.split(':')[1])
    : null

  const shortJob = (j: JobMeta) =>
    `…${j.jobId.slice(-6)} · ${j.board ?? '?'}`

  return (
    <div className="flex flex-col h-full bg-[#f5f5f5] min-h-0">
      {/* ── Header: job, actions, pipeline pills ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-[#e5e5e5] flex-wrap shrink-0">
        <button
          type="button"
          className="ghost sm shrink-0 !px-2"
          onClick={() => setExplorerOpen((v) => !v)}
          title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
          aria-label={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
        <select
          value={jobId}
           onChange={(e) => setJobIdRef(e.target.value)}
          className="h-8 text-[12px] font-mono border border-[#e5e5e5] rounded bg-white px-2 min-w-0 max-w-56 shrink"
          title={selected?.jobId ?? 'Compile job (MCP-generated builds land here)'}
        >
          {jobs.length === 0 && <option value="">- no builds yet -</option>}
          {jobs.map((j) => (
            <option key={j.jobId} value={j.jobId} title={j.jobId}>{shortJob(j)}</option>
          ))}
        </select>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Change note… (labels this checkpoint)"
          title="A short label for what changed - shown on the revision and read by Claude"
          className="h-8 px-2.5 bg-white border border-[#d1d5db] rounded text-xs outline-none min-w-0 shrink hidden sm:block"
          style={{ flex: '1 1 120px' }}
        />
        <button type="button" className="h-8 px-4 bg-black hover:bg-[#222] text-white text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer shrink-0" onClick={() => void save('draft')} disabled={!dirty || saving || !jobId} title="Save edits without creating a new revision">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="ghost shrink-0" onClick={() => void save('revision')} disabled={!dirty || saving || !jobId} title="Freeze the current code as a new numbered revision">
          Save as revision
        </button>
        {approved
          ? <button type="button" className="ghost shrink-0" onClick={() => void approve(false)} title="Approved - click to withdraw approval">✓ Approved</button>
          : <button type="button" className="ghost shrink-0" onClick={() => void approve(true)} disabled={!jobId} title="Approve this build for flashing">Approve</button>}
        <button
          type="button"
          className="h-8 px-3 bg-black hover:bg-[#222] text-white text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center gap-1.5"
          onClick={() => { if (jobId) onDirectFlash?.(jobId) }}
          disabled={!selected || selected.status !== 'done' || !onDirectFlash}
          title="Flash the selected compiled build over USB"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Direct Flash
        </button>
        {stages.length > 0 && (
          <select
            value={pipeFocus ?? stages.find((s) => s.state === 'active' || s.state === 'error')?.id ?? stages.find((s) => s.state === 'pending')?.id ?? stages[stages.length - 1].id}
            onChange={(e) => setPipeFocus(e.target.value)}
            className="h-8 text-[12px] border border-[#e5e5e5] rounded bg-white px-1.5 min-w-0 max-w-44 shrink"
            title={stages.find((s) => s.id === (pipeFocus ?? ''))?.detail ?? 'Review → flash pipeline status'}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id} title={s.detail ?? s.label}>
                {s.state === 'done' ? '●' : s.state === 'active' ? '◉' : s.state === 'error' ? '✕' : '○'} {STAGE_SHORT[s.id] ?? s.label} - {s.state}
              </option>
            ))}
          </select>
        )}
      </div>

      {backendStale && (
        <div className="px-3 py-2 text-[12px] shrink-0" style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#7c2d12' }}>
          This backend doesn&apos;t have the code-review API yet (jobs list works, code doesn&apos;t) - point the client at a backend running the new code
          (<span className="font-mono">VITE_BACKEND_URL=http://localhost:3000</span>) or deploy the backend. Nothing is lost; your builds are intact.
        </div>
      )}

      {/* ── Body: explorer + editor ── */}
      <div className="flex grow overflow-hidden min-h-0">
        {/* File explorer */}
        {explorerOpen && (
        <aside className="w-52 shrink-0 border-r overflow-y-auto py-2" style={{ background: '#141414', borderColor: '#2a2a2a' }}>
          <div className="px-3 text-[10px] font-bold tracking-wider" style={{ color: '#737373' }}>SOURCE</div>
          <button
            type="button"
            onClick={() => openTab({ key: 'main', title: 'main.cpp', kind: 'main' })}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono text-left cursor-pointer"
            style={activeTab === 'main' ? { background: '#2a2a2a', color: '#fff', fontWeight: 600 } : { color: '#d4d4d4' }}
            onMouseEnter={(e) => { if (activeTab !== 'main') e.currentTarget.style.background = '#1f1f1f' }}
            onMouseLeave={(e) => { if (activeTab !== 'main') e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ color: '#569cd6', fontWeight: 700 }}>{'</>'}</span> main.cpp
            {dirty && <span className="ml-auto w-2 h-2 rounded-full" style={{ background: '#eab308' }} title="Unsaved edits" />}
          </button>
          <div className="px-3 pt-2 text-[10px] font-bold tracking-wider" style={{ color: '#737373' }}>REVISIONS</div>
          {revs.length === 0 && <div className="px-3 py-1 text-[11px]" style={{ color: '#525252' }}>rev 1 lands here after a build</div>}
          {revs.map((r) => (
            <button
              key={r.rev}
              type="button"
              onClick={() => openTab({ key: `rev:${r.rev}`, title: `main.rev${r.rev}.cpp`, kind: 'rev' })}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-left cursor-pointer"
              style={activeTab === `rev:${r.rev}` ? { background: '#2a2a2a', color: '#fff', fontWeight: 600 } : { color: '#d4d4d4' }}
              onMouseEnter={(e) => { if (activeTab !== `rev:${r.rev}`) e.currentTarget.style.background = '#1f1f1f' }}
              onMouseLeave={(e) => { if (activeTab !== `rev:${r.rev}`) e.currentTarget.style.background = 'transparent' }}
              title={r.summary ?? `Revision ${r.rev} by ${r.author}`}
            >
              <span style={{ color: r.author === 'claude' ? '#8b5cf6' : '#4ade80' }}>●</span>
              <span className="min-w-0 grow">
                <span className="block text-[12px] leading-4 font-mono">rev {r.rev} · {r.author}</span>
                {r.summary && <span className="block text-[10px] leading-3 truncate" style={{ color: '#737373' }}>{r.summary}</span>}
              </span>
              {revs.length > 1 && (
                <button
                  type="button"
                  className="shrink-0 px-1 text-[#bbb] hover:text-[#dc2626] text-[14px] leading-none"
                  title={`Delete rev ${r.rev}`}
                  onClick={(e) => { e.stopPropagation(); void removeRev(r.rev) }}
                >
                  ×
                </button>
              )}
            </button>
          ))}
          <div className="px-3 pt-3 text-[10px] font-bold tracking-wider" style={{ color: '#737373' }}>REVIEW</div>
          <button
            type="button"
            onClick={() => openTab({ key: 'diff', title: 'Changes (rev 1 → latest)', kind: 'diff' })}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono text-left cursor-pointer"
            style={activeTab === 'diff' ? { background: '#2a2a2a', color: '#fff', fontWeight: 600 } : { color: '#d4d4d4' }}
            onMouseEnter={(e) => { if (activeTab !== 'diff') e.currentTarget.style.background = '#1f1f1f' }}
            onMouseLeave={(e) => { if (activeTab !== 'diff') e.currentTarget.style.background = 'transparent' }}
          >
            <span className="font-bold"><span className="text-[#16a34a]">+</span><span className="text-[#dc2626]">−</span></span>
            Changes{(counts.added + counts.removed) > 0 ? ` ${counts.added + counts.removed}` : ''}
          </button>
        </aside>
        )}

        {/* Editor + tabs */}
        <div className="flex flex-col grow overflow-hidden min-w-0 min-h-0">
          <div className="flex items-center bg-[#181818] shrink-0 overflow-x-auto">
            {tabs.map((t) => (
              <div
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="flex items-center gap-2 px-3 py-2 text-[12px] font-mono cursor-pointer border-r border-[#2a2a2a] whitespace-nowrap"
                style={{ background: activeTab === t.key ? '#1e1e1e' : 'transparent', color: activeTab === t.key ? '#e5e5e5' : '#888' }}
              >
                {t.kind === 'diff' ? <span><span className="text-[#4ade80]">+</span><span className="text-[#f87171]">−</span></span> : <span className="text-[#569cd6]">{'</>'}</span>}
                {t.title}
                {t.key === 'main' && dirty && <span className="w-2 h-2 rounded-full bg-[#eab308]" />}
                {tabs.length > 1 && (
                  <button
                    type="button"
                    className="text-[#666] hover:text-white px-0.5"
                    onClick={(e) => { e.stopPropagation(); closeTab(t.key) }}
                    title="Close tab"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex grow overflow-hidden min-h-0">
            {activeTab === 'main' && (
              <CodePane
                value={text}
                onChange={setText}
                placeholder={loading ? 'Loading…' : jobId ? 'Empty file.' : 'No builds yet - ask Claude to compile firmware.'}
              />
            )}
            {activeRevTab != null && (
              <CodePane
                key={activeTab}
                value={revCache[activeRevTab] ?? '// loading rev…'}
                readOnly
              />
            )}
            {activeTab === 'diff' && (
              <div className="grow overflow-auto bg-white font-mono text-[12px] leading-5">
                <div className="px-3 py-2 text-[11px] font-sans text-[#666] border-b border-[#e5e5e5] sticky top-0 bg-white">
                  rev 1 (Claude) → rev {revs.length || 1} (latest){counts.added + counts.removed === 0 ? ' - identical, no edits yet.' : ` - ${counts.added} added, ${counts.removed} removed. Claude reads this same diff via get_code_diff.`}
                </div>
                {ops.map((o, i) => (
                  <div
                    key={i}
                    className="flex"
                    style={{
                      background: o.type === 'add' ? '#f0fdf4' : o.type === 'del' ? '#fef2f2' : '#fff',
                      color: o.type === 'add' ? '#16a34a' : o.type === 'del' ? '#dc2626' : '#444',
                    }}
                  >
                    <span className="text-right px-2 select-none shrink-0" style={{ minWidth: 44, color: '#9ca3af' }}>
                      {o.type === 'add' ? `+${o.newNo}` : o.type === 'del' ? `-${o.oldNo}` : o.oldNo}
                    </span>
                    <span className="px-1 select-none" style={{ color: '#9ca3af' }}>
                      {o.type === 'add' ? '+' : o.type === 'del' ? '−' : ' '}
                    </span>
                    <span className="px-2 whitespace-pre">{o.text === '' ? ' ' : o.text}</span>
                  </div>
                ))}
                {ops.length === 0 && <p className="hint" style={{ padding: 12 }}>No diff yet.</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-t border-[#e5e5e5] text-[11px] font-mono text-[#666] shrink-0 overflow-x-auto whitespace-nowrap">
        <span className="truncate" title={selected?.jobId}>
          {selected ? selected.jobId : 'no job'}
        </span>
        {selected && (
          <button
            type="button"
            className="text-[#888] hover:text-black shrink-0 ml-1 flex items-center gap-1"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selected.jobId)
                showAlert('success', 'Job ID copied to clipboard.', 'Copied')
              } catch {
                showAlert('error', 'Clipboard access was blocked by the browser.', 'Copy Failed')
              }
            }}
            title="Copy job ID to clipboard"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="14" height="14" x="9" y="9" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="text-[10px]">Copy</span>
          </button>
        )}
        <span>rev {revs.length || (selected ? 1 : 0)}</span>
        <span>{selected?.board ?? ''}{selected?.platform ? ` · ${selected.platform}` : ''}</span>
        <span className="ml-auto flex items-center gap-3">
          {dirty && <span className="text-[#b45309]">● unsaved</span>}
          <span className="text-[#16a34a]">+{counts.added}</span>
          <span className="text-[#dc2626]">−{counts.removed}</span>
          <span style={{ color: approved ? '#16a34a' : '#9ca3af' }}>{approved ? '● approved' : '○ not approved'}</span>
          <span>C++</span>
        </span>
      </div>
    </div>
  )
}
