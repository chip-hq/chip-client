import { useEffect, useMemo, useRef, useState } from 'react'
import { auth } from './firebase'
import {
  TOOLBAR_ORDER,
  ICONS,
  getComponent,
  defaultElement,
  renderSvg,
  patchElement,
  textFitBox,
  wrapText,
  clampPad,
  scaleOf,
} from '../oled/registry'
import type { PropDescriptor } from '../oled/registry'

type ElementType = 'text' | 'rectangle' | 'filledRectangle' | 'circle' | 'line' | 'eyes' | 'marquee' | 'teleprompter'
type FontName = '5x7' | '6x8' | '8x8'

interface DesignElement {
  id: string
  name: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  text?: string
  font?: FontName
  fill?: boolean
  stroke?: boolean
  /** Which scene this element lives on. Defaults to the first scene. */
  sceneId?: string
  /** Animation speed in px/sec (marquee, teleprompter). */
  speed?: number
  /** Travel direction (marquee: left|right, teleprompter: up|down). */
  direction?: 'left' | 'right' | 'up' | 'down'
  /** Gap between robot-eye pupils. */
  gap?: number
  /** Registry props flow through this shape (see shared DesignElementFields). */
  [key: string]: unknown
}

interface SceneDef {
  id: string
  name: string
  /** How long this scene plays (ms) during playback / on-device loops. */
  durationMs: number
}

type OledDriver = 'SH1106' | 'SSD1306'

interface OledDesign {
  designId: string
  name: string
  type: 'oled'
  display: { driver: OledDriver; width: number; height: number; address: '0x3C' }
  version: number
  elements: DesignElement[]
  /** Ordered scenes. Older designs without scenes read as a single scene. */
  scenes?: SceneDef[]
  updatedAt?: number
}

const SIZE_PRESETS = [
  { label: '128 × 64', width: 128, height: 64 },
  { label: '128 × 32', width: 128, height: 32 },
  { label: '96 × 16', width: 96, height: 16 },
  { label: '64 × 48', width: 64, height: 48 },
] as const

const GALLERY_FILTERS = ['All', 'SH1106', 'SSD1306', '128 × 64', '128 × 32'] as const

function clampDisplaySize(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

const API_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000').replace(/\/+$/, '')
const LEGACY_KEY = 'chip_active_oled_design'
const DESIGNS_KEY = 'chip_oled_designs_v1'
const ACTIVE_ID_KEY = 'chip_oled_active_id'

function createDesign(driver: OledDriver = 'SH1106', width = 128, height = 64, name = 'System Monitor'): OledDesign {
  const suffix = Math.random().toString(16).slice(2, 8)
  const w = clampDisplaySize(width, 32, 256)
  const h = clampDisplaySize(height, 8, 128)
  const sceneId = `scene_${suffix}`
  return {
    designId: `oled_${suffix}`,
    name,
    type: 'oled',
    display: { driver, width: w, height: h, address: '0x3C' },
    version: 0,
    updatedAt: Date.now(),
    scenes: [{ id: sceneId, name: 'Scene 1', durationMs: 2000 }],
    elements: [
      { id: 'header', name: 'Header', type: 'text', text: 'System Monitor', x: 3, y: 2, width: 78, height: 8, font: '6x8', stroke: true, sceneId },
      { id: 'status', name: 'Status', type: 'text', text: 'Connected', x: 4, y: Math.max(8, h - 12), width: 54, height: 8, font: '5x7', stroke: true, sceneId },
    ],
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

async function apiRequest(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const user = auth.currentUser
  if (user) {
    headers['x-user-id'] = user.uid
    const token = await user.getIdToken().catch(() => null)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> || {}) } })
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeDesign(raw: unknown): OledDesign {
  const fallback = createDesign()
  if (!raw || typeof raw !== 'object') return fallback
  const candidate = raw as Partial<OledDesign> & { scenes?: Array<SceneDef & { elements?: unknown }> }
  const display = (candidate.display ?? {}) as Partial<OledDesign['display']>
  const width = clampDisplaySize(Number(display.width) || 128, 32, 256)
  const height = clampDisplaySize(Number(display.height) || 64, 8, 128)
  // Accept nested Claude-style JSON { scenes[].elements[] } by flattening it
  // into the flat { scenes, elements[].sceneId } shape the canvas edits.
  const rawScenes = Array.isArray(candidate.scenes) ? candidate.scenes : null
  const nested = !!rawScenes && rawScenes.some((s) => Array.isArray((s as { elements?: unknown })?.elements))
  const sceneMetas = rawScenes && rawScenes.length > 0 ? rawScenes : null
  const flatInput: unknown[] = nested
    ? (rawScenes as Array<SceneDef & { elements?: unknown[] }>).flatMap((s) =>
      (Array.isArray(s.elements) ? s.elements : []).map((e) => ({ ...(e as object), sceneId: s.id })),
    )
    : Array.isArray(candidate.elements) ? candidate.elements : fallback.elements
  const scenes: SceneDef[] = sceneMetas
    ? sceneMetas.map((s, i) => ({
      id: typeof s?.id === 'string' && s.id ? s.id : `scene_${i}`,
      name: typeof s?.name === 'string' && s.name ? s.name : `Scene ${i + 1}`,
      durationMs: Number.isFinite(Number(s?.durationMs)) ? Math.max(400, Math.min(30000, Math.round(Number(s.durationMs)))) : 2000,
    }))
    : [{ id: 'scene_main', name: 'Scene 1', durationMs: 2000 }]
  const elements = flatInput.map((e) => {
    const el = e as DesignElement
    const sceneId = typeof el.sceneId === 'string' && scenes.some((s) => s.id === el.sceneId) ? el.sceneId : scenes[0].id
    const out: DesignElement = { ...el, sceneId }
    if (out.type === 'marquee') {
      if (!Number.isFinite(Number(out.speed))) out.speed = 24
      if (out.direction !== 'left' && out.direction !== 'right') out.direction = 'left'
    }
    if (out.type === 'teleprompter') {
      if (!Number.isFinite(Number(out.speed))) out.speed = 10
      if (out.direction !== 'up' && out.direction !== 'down') out.direction = 'up'
    }
    if (out.type === 'eyes' && !Number.isFinite(Number(out.gap))) out.gap = 10
    if (out.type === 'text') {
      if (out.invert !== true) out.invert = false
      if (!Number.isFinite(Number(out.invertPadding))) out.invertPadding = 0
    }
    if ((out.type === 'text' || out.type === 'marquee' || out.type === 'teleprompter') && !(Number(out.size) >= 1 && Number(out.size) <= 8)) {
      out.size = 1
    }
    return out
  })
  return {
    ...fallback,
    ...candidate,
    designId: typeof candidate.designId === 'string' && candidate.designId ? candidate.designId : fallback.designId,
    name: typeof candidate.name === 'string' && candidate.name ? candidate.name : fallback.name,
    type: 'oled',
    display: {
      driver: display.driver === 'SSD1306' || display.driver === 'SH1106' ? display.driver : fallback.display.driver,
      width,
      height,
      address: '0x3C',
    },
    scenes,
    elements,
  } as OledDesign
}

function loadStoredDesigns(): OledDesign[] {
  try {
    const raw = localStorage.getItem(DESIGNS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(normalizeDesign)
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) return [normalizeDesign(JSON.parse(legacy))]
  } catch { /* ignore */ }
  return [createDesign('SH1106', 128, 64, 'System Monitor')]
}

/**
 * Generic properties control: renders the right input for any registry prop
 * descriptor. Adding a component with new props needs zero panel changes —
 * text/textarea/select/segmented/slider/stepper all come from the schema.
 * Defined at module level so typing never remounts (and never loses focus).
 */
function PropControl(props: {
  desc: PropDescriptor
  value: string | number | boolean | undefined
  onChange: (value: string | number | boolean) => void
  inlineText?: {
    value: string
    onChange: (v: string) => void
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (e: { key: string }) => void
    placeholder?: string
  } | null
}) {
  const { desc, value, onChange, inlineText } = props
  if (desc.control === 'text') {
    if (inlineText) {
      return (
        <input
          value={inlineText.value}
          onChange={(event) => inlineText.onChange(event.target.value)}
          onFocus={inlineText.onFocus}
          onBlur={inlineText.onBlur}
          onKeyDown={inlineText.onKeyDown}
          placeholder={inlineText.placeholder ?? 'Type…'}
          aria-label={desc.label}
          className="h-8 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 text-[12px] outline-none focus:border-slate-400 focus:bg-white sm:max-w-56"
        />
      )
    }
    return (
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={desc.placeholder ?? desc.label}
        aria-label={desc.label}
        className="h-8 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 text-[12px] outline-none focus:border-slate-400 focus:bg-white sm:max-w-56"
      />
    )
  }
  if (desc.control === 'textarea') {
    return (
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={desc.placeholder ?? 'One line per row…'}
        aria-label={desc.label}
        rows={1}
        className="h-8 min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] outline-none focus:border-slate-400 focus:bg-white sm:max-w-56"
      />
    )
  }
  if (desc.control === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        aria-label={desc.label}
        title={desc.label}
        className="h-8 rounded-full border border-slate-200 bg-white px-2 text-[12px] outline-none"
      >
        {(desc.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }
  if (desc.control === 'segmented') {
    return (
      <div className="flex h-8 items-center gap-0.5 rounded-full border border-slate-200 p-0.5" role="group" aria-label={desc.label}>
        {(desc.options ?? []).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={String(value) === opt}
            className={`rounded-full px-2 py-1 font-mono text-[11px] transition ${String(value) === opt ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            {opt}
          </button>
        ))}
      </div>
    )
  }
  if (desc.control === 'slider') {
    const numValue = Number.isFinite(Number(value)) ? Number(value) : (desc.min ?? 0)
    return (
      <label className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200 px-2.5 text-[11px] text-slate-500" title={`${desc.label}${desc.unit ? ` (${desc.unit})` : ''}`}>
        {desc.label}
        <input
          type="range" min={desc.min ?? 0} max={desc.max ?? 100} step={desc.step ?? 1}
          value={numValue}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={desc.label}
          className="h-1 w-20 accent-slate-900"
        />
        <span className="font-mono text-[10px]">{numValue}{desc.unit ?? ''}</span>
      </label>
    )
  }
  if (desc.control === 'toggle') {
    const on = value === true;
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        title={desc.description ?? desc.label}
        aria-label={desc.label}
        className={`flex h-8 items-center gap-2 rounded-full border px-2.5 text-[11px] font-medium transition ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}
      >
        <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? 'bg-emerald-400' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        {desc.label}
      </button>
    );
  }
  // stepper (default): compact labeled number pill for x/y/w/h style props.
  const stepValue = Number.isFinite(Number(value)) ? Math.round(Number(value)) : (desc.min ?? 0)
  return (
    <label className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-2 text-[11px] text-slate-500">
      {desc.label}
      <input
        type="number" min={desc.min} max={desc.max} step={desc.step ?? 1}
        value={stepValue}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-11 bg-transparent font-mono text-[11px] outline-none"
        aria-label={desc.label}
      />
    </label>
  )
}

/** Dark-tile live thumbnail — renders the real elements via the registry (first scene). */
function DesignThumbnail({ design }: { design: OledDesign }) {
  const w = design.display.width || 128
  const h = design.display.height || 64
  const firstScene = design.scenes?.[0]?.id
  const shown = design.elements.filter((e) => (e.sceneId ?? firstScene) === firstScene)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {shown.map((element) => <g key={element.id}>{renderSvg(element, '#f1f5f9', { playing: false, playMs: 0, idPrefix: 'th', paper: '#0c1424' })}</g>)}
    </svg>
  )
}

export function OLEDDesigner() {
  const [designs, setDesigns] = useState<OledDesign[]>(loadStoredDesigns)
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_ID_KEY) } catch { return null }
  })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof GALLERY_FILTERS)[number]>('All')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const timeOf = (d: OledDesign) => {
    const t = new Date((d.updatedAt as unknown as string | number | undefined) ?? 0).getTime()
    return Number.isFinite(t) ? t : 0
  }

  /** Pull server designs (incl. AI-saved ones) into the gallery. Newer wins per id. */
  const refreshFromServer = async (silent: boolean) => {
    setRefreshing(true)
    if (!silent) setRefreshMsg('')
    try {
      const response = await apiRequest('/api/oled/designs?limit=50')
      if (!response.ok) throw new Error('Sync failed')
      const data = await response.json()
      const incoming: OledDesign[] = Array.isArray(data?.designs) ? data.designs.map(normalizeDesign) : []
      let changed = false
      setDesigns((current) => {
        const byId = new Map(current.map((d) => [d.designId, d] as const))
        for (const inc of incoming) {
          const existing = byId.get(inc.designId)
          if (!existing || timeOf(inc) > timeOf(existing)) {
            byId.set(inc.designId, inc)
            changed = true
          }
        }
        return [...byId.values()]
      })
      if (!silent) setRefreshMsg(changed ? 'Gallery synced with server' : 'Already up to date')
    } catch {
      if (!silent) setRefreshMsg('Server unavailable')
    } finally {
      setRefreshing(false)
    }
  }

  // New-screen draft
  const [createOpen, setCreateOpen] = useState(false)
  const [draftName, setDraftName] = useState('Untitled screen')
  const [draftDriver, setDraftDriver] = useState<OledDriver>('SH1106')
  const [draftW, setDraftW] = useState(128)
  const [draftH, setDraftH] = useState(64)

  // Display settings for the open design
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Editor state (no modals — everything edits inline / in bars like Canva)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [zoom, setZoom] = useState(4)
  const [showGrid, setShowGrid] = useState(true)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const dragRef = useRef<{
    id: string
    mode: 'move' | 'resize'
    handle?: string
    startX: number
    startY: number
    originX: number
    originY: number
    originWidth: number
    originHeight: number
  } | null>(null)
  const canvasRef = useRef<SVGSVGElement | null>(null)

  const design = useMemo(
    () => designs.find((d) => d.designId === activeId) ?? null,
    [designs, activeId],
  )
  const displayWidth = design?.display.width || 128
  const displayHeight = design?.display.height || 64
  const selected = design?.elements.find((element) => element.id === selectedId) || null
  // Responsive: cap the canvas at zoom size but shrink to fit small screens.
  const canvasMaxWidth = useMemo(() => Math.max(240, Math.min(920, displayWidth * zoom)), [displayWidth, zoom])
  const fitZoom = useMemo(() => Math.max(2, Math.min(8, Math.round(560 / Math.max(1, displayWidth)))), [displayWidth])

  // Scenes — every element lives on exactly one scene.
  const scenes: SceneDef[] = useMemo(
    () => (design && Array.isArray(design.scenes) && design.scenes.length > 0
      ? design.scenes
      : [{ id: 'scene_main', name: 'Scene 1', durationMs: 2000 }]),
    [design],
  )
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const resolvedSceneId = activeSceneId && scenes.some((s) => s.id === activeSceneId) ? activeSceneId : scenes[0].id

  // Right-click context menu over canvas elements.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  // Playback clock (ms since play pressed, pauses resume where they stopped).
  const [playing, setPlaying] = useState(false)
  const [playMs, setPlayMs] = useState(0)
  const playStartRef = useRef(0)
  useEffect(() => {
    if (!playing) return
    playStartRef.current = Date.now() - playMs
    let raf = 0
    const tick = () => {
      setPlayMs(Date.now() - playStartRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // Play animates components only (marquee, teleprompter, eyes) on the open scene.
  // Scenes never auto-switch in the editor — the strip is manual.
  // Scene durations still drive the on-device loop in emitted firmware.
  const visibleSceneId = resolvedSceneId

  const visibleElements = useMemo(
    () => (design ? design.elements.filter((e) => (e.sceneId ?? scenes[0].id) === visibleSceneId) : []),
    [design, visibleSceneId, scenes],
  )

  // Reset per-design editor state when switching screens.
  useEffect(() => {
    setActiveSceneId(null)
    setSelectedId(null)
    setEditingTextId(null)
    setPlaying(false)
    setPlayMs(0)
    setMenu(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.designId])

  useEffect(() => {
    try {
      localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs))
      if (designs[0]) localStorage.setItem(LEGACY_KEY, JSON.stringify(designs[0]))
      if (activeId) localStorage.setItem(ACTIVE_ID_KEY, activeId)
      else localStorage.removeItem(ACTIVE_ID_KEY)
    } catch { /* ignore */ }
  }, [designs, activeId])

  // Auto-pull AI-saved screens whenever the gallery is shown (silent; never blocks).
  useEffect(() => {
    if (!design) void refreshFromServer(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.designId])

  useEffect(() => {
    if (!design) return
    let cancelled = false
    apiRequest(`/api/oled/designs/${encodeURIComponent(design.designId)}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.design) {
          const incoming = normalizeDesign(data.design)
          setDesigns((current) => current.map((d) => (d.designId === incoming.designId ? incoming : d)))
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.designId])

  const updateActive = (updater: (current: OledDesign) => OledDesign) => {
    if (!design) return
    setDesigns((current) => current.map((d) => (d.designId === design.designId ? { ...updater(d), updatedAt: Date.now() } : d)))
  }

  const updateElement = (id: string, patch: Partial<DesignElement>) => {
    updateActive((current) => ({ ...current, elements: current.elements.map((element) => (element.id === id ? { ...element, ...patch } : element)) }))
  }

  const addElement = (type: string) => {
    if (!design) return
    const def = getComponent(type)
    const template = defaultElement(type)
    if (!def || !template) return
    const w = displayWidth
    const h = displayHeight
    // Registry defaults give the footprint; the canvas centers it on the open scene.
    const baseW = Math.min(Math.max(1, Math.round(Number(template.width) || 32)), w)
    const baseH = Math.min(Math.max(1, Math.round(Number(template.height) || 16)), h)
    const base: DesignElement = {
      ...(template as Partial<DesignElement>),
      id: makeId(type),
      name: def.name,
      type: type as ElementType,
      x: clamp(Math.floor((w - baseW) / 2), 0, Math.max(0, w - baseW)),
      y: clamp(Math.floor((h - baseH) / 2), 0, Math.max(0, h - baseH)),
      width: baseW,
      height: baseH,
      sceneId: resolvedSceneId,
    }
    // Plain text frames hug their content from birth.
    const element = base.type === 'text'
      ? (() => {
        const fit = textFitBox(base)
        return {
          ...base,
          x: clamp(base.x, 0, Math.max(0, w - Math.min(fit.width, w))),
          y: clamp(base.y, 0, Math.max(0, h - fit.height)),
          width: Math.min(fit.width, w),
          height: fit.height,
        }
      })()
      : base
    updateActive((current) => ({ ...current, elements: [...current.elements, element] }))
    setSelectedId(element.id)
  }

  const deleteById = (id: string) => {
    updateActive((current) => ({ ...current, elements: current.elements.filter((element) => element.id !== id) }))
    if (selectedId === id) setSelectedId(null)
    if (editingTextId === id) setEditingTextId(null)
    setMenu(null)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    deleteById(selectedId)
  }

  const duplicateSelected = () => {
    if (!selected) return
    const copy: DesignElement = {
      ...JSON.parse(JSON.stringify(selected)),
      id: makeId(selected.type),
      name: `${selected.name} copy`,
      x: clamp(selected.x + 4, 0, Math.max(0, displayWidth - selected.width)),
      y: clamp(selected.y + 4, 0, Math.max(0, displayHeight - selected.height)),
    }
    updateActive((current) => {
      const index = current.elements.findIndex((element) => element.id === selected.id)
      const updated = [...current.elements]
      updated.splice(index + 1, 0, copy)
      return { ...current, elements: updated }
    })
    setSelectedId(copy.id)
    setMenu(null)
  }

  const addScene = () => {
    const scene: SceneDef = { id: makeId('scene'), name: `Scene ${scenes.length + 1}`, durationMs: 2000 }
    setPlaying(false)
    updateActive((current) => ({ ...current, scenes: [...(current.scenes ?? []), scene] }))
    setActiveSceneId(scene.id)
    setSelectedId(null)
  }

  const deleteScene = (id: string) => {
    if (scenes.length <= 1) return
    setPlaying(false)
    const remaining = scenes.filter((s) => s.id !== id)
    updateActive((current) => ({
      ...current,
      scenes: remaining,
      elements: current.elements.map((e) => (e.sceneId === id ? { ...e, sceneId: remaining[0].id } : e)),
    }))
    if (resolvedSceneId === id) setActiveSceneId(remaining[0].id)
  }

  const setSceneDuration = (id: string, ms: number) => {
    updateActive((current) => ({
      ...current,
      scenes: (current.scenes ?? []).map((s) => (s.id === id ? { ...s, durationMs: Math.max(400, Math.min(30000, Math.round(ms) || 2000)) } : s)),
    }))
  }

  // Delete / Backspace removes the selection (never while typing), Esc closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'Escape') { setMenu(null); return }
      if (typing || !selectedId || !design) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteById(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const reorderSelected = (direction: -1 | 1) => {
    if (!selectedId) return
    updateActive((current) => {
      const index = current.elements.findIndex((element) => element.id === selectedId)
      if (index < 0) return current
      const nextIndex = Math.min(current.elements.length - 1, Math.max(0, index + direction))
      if (nextIndex === index) return current
      const updated = [...current.elements]
      const [item] = updated.splice(index, 1)
      updated.splice(nextIndex, 0, item)
      return { ...current, elements: updated }
    })
  }

  const pointFromEvent = (event: React.PointerEvent) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return { x: (event.clientX - bounds.left) / (bounds.width / displayWidth), y: (event.clientY - bounds.top) / (bounds.height / displayHeight) }
  }

  const beginInlineEdit = (element: DesignElement) => {
    if (element.type !== 'text' && element.type !== 'marquee') return
    setSelectedId(element.id)
    setEditingTextId(element.id)
    setTextDraft(element.text ?? '')
  }

  const commitInlineEdit = () => {
    if (editingTextId) {
      const value = textDraft
      const current = design?.elements.find((el) => el.id === editingTextId)
      const fit = textFitBox({ ...(current ?? { font: '6x8' as FontName }), text: value } as DesignElement)
      updateElement(editingTextId, {
        text: value,
        name: value.trim() ? value.trim().slice(0, 18) : 'Text',
        // Never collapse a frame the user stretched — grow with text, keep extensions.
        width: Math.min(Math.max(fit.width, current?.width ?? 0), displayWidth),
        // Plain-text height is fully automatic so wrapped copy can also shrink back.
        height: current?.type === 'text' ? fit.height : Math.max(fit.height, current?.height ?? 0),
      })
    }
    setEditingTextId(null)
  }

  const cancelInlineEdit = () => setEditingTextId(null)

  const startDrag = (event: React.PointerEvent, element: DesignElement) => {
    if (editingTextId) return
    event.stopPropagation()
    const point = pointFromEvent(event)
    setSelectedId(element.id)
    dragRef.current = { id: element.id, mode: 'move', startX: point.x, startY: point.y, originX: element.x, originY: element.y, originWidth: element.width, originHeight: element.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const startResize = (event: React.PointerEvent, element: DesignElement, handle: string) => {
    if (editingTextId) return
    event.stopPropagation()
    const point = pointFromEvent(event)
    setSelectedId(element.id)
    dragRef.current = { id: element.id, mode: 'resize', handle, startX: point.x, startY: point.y, originX: element.x, originY: element.y, originWidth: element.width, originHeight: element.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent) => {
    if (!dragRef.current || !design) return
    const point = pointFromEvent(event)
    const element = design.elements.find((item) => item.id === dragRef.current?.id)
    if (!element) return
    const dx = point.x - dragRef.current.startX
    const dy = point.y - dragRef.current.startY

    if (dragRef.current.mode === 'move') {
      const fit = element.type === 'text' ? textFitBox(element) : null
      const effW = fit ? Math.max(fit.width, element.width) : element.width
      const effH = fit ? Math.max(fit.height, element.height) : element.height
      updateElement(dragRef.current.id, {
        x: clamp(dragRef.current.originX + dx, 0, Math.max(0, displayWidth - effW)),
        y: clamp(dragRef.current.originY + dy, 0, Math.max(0, displayHeight - effH)),
      })
      return
    }

    let x = dragRef.current.originX
    let y = dragRef.current.originY
    let width = dragRef.current.originWidth
    let height = dragRef.current.originHeight
    const handle = dragRef.current.handle ?? ''
    // Text can narrow to force line breaks (long words hard-break); the
    // marquee window is freely resizable. Height of text follows its lines.
    const narrowable = element.type === 'text' || element.type === 'marquee'
    const resizeFit = narrowable ? null : textFitBox(element)
    const minW = narrowable ? 8 : (resizeFit ? resizeFit.width : 1)
    const minH = element.type === 'text' ? 1 : (resizeFit ? resizeFit.height : 1)

    if (handle.includes('w')) {
      const nextX = clamp(dragRef.current.originX + dx, 0, dragRef.current.originX + dragRef.current.originWidth - minW)
      width = Math.max(minW, dragRef.current.originWidth - (nextX - dragRef.current.originX))
      x = nextX
    }
    if (handle.includes('e')) {
      width = clamp(dragRef.current.originWidth + dx, minW, Math.max(minW, displayWidth - dragRef.current.originX))
    }
    if (handle.includes('n')) {
      const nextY = clamp(dragRef.current.originY + dy, 0, dragRef.current.originY + dragRef.current.originHeight - minH)
      height = Math.max(minH, dragRef.current.originHeight - (nextY - dragRef.current.originY))
      y = nextY
    }
    if (handle.includes('s')) {
      height = clamp(dragRef.current.originHeight + dy, minH, Math.max(minH, displayHeight - dragRef.current.originY))
    }

    if (element.type === 'text') {
      // Height is automatic: it follows the wrapped line count live.
      const wrapped = wrapText(
        typeof element.text === 'string' ? element.text : '',
        typeof element.font === 'string' ? element.font : '6x8',
        Math.max(8, width),
        scaleOf(element),
      )
      const pad = element.invert === true ? clampPad(element.invertPadding) : 0
      height = wrapped.lines.length * wrapped.lineH + pad * 2
    }

    updateElement(dragRef.current.id, { x, y, width, height })
  }

  const endDrag = () => { dragRef.current = null }

  const save = async () => {
    if (!design) return
    setSaving(true)
    setSavedMessage('')
    try {
      const response = await apiRequest('/api/oled/designs', { method: 'POST', body: JSON.stringify({ design }) })
      if (!response.ok) throw new Error('Save failed')
      const data = await response.json()
      const incoming = normalizeDesign(data.design)
      setDesigns((current) => current.map((d) => (d.designId === incoming.designId ? incoming : d)))
      setSavedMessage(`Saved v${incoming.version}`)
    } catch {
      setSavedMessage('Saved locally; server unavailable')
    } finally { setSaving(false) }
  }

  const applyDisplaySize = (width: number, height: number, driver?: OledDriver) => {
    const nextWidth = clampDisplaySize(width, 32, 256)
    const nextHeight = clampDisplaySize(height, 8, 128)
    updateActive((current) => ({
      ...current,
      display: { ...current.display, width: nextWidth, height: nextHeight, ...(driver ? { driver } : {}) },
      elements: current.elements.map((element) => ({
        ...element,
        x: clamp(element.x, 0, Math.max(0, nextWidth - 1)),
        y: clamp(element.y, 0, Math.max(0, nextHeight - 1)),
        width: Math.max(1, Math.min(element.width, nextWidth)),
        height: Math.max(1, Math.min(element.height, nextHeight)),
      })),
    }))
  }

  const openCreate = () => {
    setDraftName(`Screen ${designs.length + 1}`)
    setDraftDriver('SH1106')
    setDraftW(128)
    setDraftH(64)
    setCreateOpen(true)
  }

  const confirmCreate = () => {
    const fresh = createDesign(draftDriver, draftW, draftH, draftName.trim() || 'Untitled screen')
    setDesigns((current) => [fresh, ...current])
    setActiveId(fresh.designId)
    setSelectedId(null)
    setCreateOpen(false)
  }

  const duplicateDesign = (id: string) => {
    const source = designs.find((d) => d.designId === id)
    if (!source) return
    const copy: OledDesign = { ...normalizeDesign(structuredClone ? structuredClone(source) : JSON.parse(JSON.stringify(source))), designId: `oled_${Math.random().toString(16).slice(2, 8)}`, name: `${source.name} copy`, version: 0, updatedAt: Date.now() }
    setDesigns((current) => [copy, ...current])
  }

  const deleteDesign = (id: string) => {
    setDesigns((current) => {
      const next = current.filter((d) => d.designId !== id)
      return next.length > 0 ? next : [createDesign()]
    })
    if (activeId === id) {
      setActiveId(null)
      setSelectedId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...designs]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .filter((d) => {
        if (filter === 'SH1106' || filter === 'SSD1306') {
          if (d.display.driver !== filter) return false
        } else if (filter !== 'All') {
          const [fw, fh] = filter.replace(/×/g, 'x').split('x').map((s) => Number(s.trim()))
          if (Number.isFinite(fw) && Number.isFinite(fh) && (d.display.width !== fw || d.display.height !== fh)) return false
        }
        if (q && !`${d.name} ${d.display.driver} ${d.display.width}x${d.display.height}`.toLowerCase().includes(q)) return false
        return true
      })
  }, [designs, filter, query])

  const draftScale = Math.min(2.2, 300 / Math.max(1, draftW), 150 / Math.max(1, draftH))

  /* ── Gallery (Canva-style, no white setup card) ─────────────────────────── */
  if (!design) {
    return (
      <section className="flex h-full w-full flex-col overflow-y-auto bg-[#f5f5f5]" aria-label="OLED screens">
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">OLED Studio</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">What are you designing for?</h2>
              <p className="mt-1 text-[13px] text-slate-500">Pick a screen to keep designing, or start a fresh one. Every card is a live preview.</p>
            </div>
            <div className="flex items-center gap-2">
              {refreshMsg && <span className="text-[11px] text-slate-500">{refreshMsg}</span>}
              <button
                type="button"
                onClick={() => void refreshFromServer(false)}
                disabled={refreshing}
                title="Pull screens saved from AI chat into the gallery"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
              >
                {refreshing ? 'Syncing…' : '↻ Sync'}
              </button>
              <button type="button" onClick={openCreate} className="rounded-full bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-slate-700">+ New screen</button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {GALLERY_FILTERS.map((pill) => (
              <button
                key={pill}
                type="button"
                onClick={() => setFilter(pill)}
                className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${filter === pill ? 'border-slate-900 bg-slate-900 font-semibold text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
              >
                {pill}
              </button>
            ))}
            <div className="ml-auto w-full sm:w-56">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search screens…"
                className="w-full rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400"
              />
            </div>
          </div>

          <div className="mt-8 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">My screens</h3>
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">See all {filtered.length} →</span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">Live pixel previews — what you see is what ships to the OLED.</p>

          {filtered.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
              <p className="text-sm font-semibold text-slate-700">No screens match</p>
              <p className="mt-1 text-xs text-slate-500">Try a different search, or start a new screen.</p>
              <button type="button" onClick={openCreate} className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">Create a screen</button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4">
              {filtered.map((item) => (
                <div key={item.designId} className="group min-w-0">
                  <button
                    type="button"
                    onClick={() => { setActiveId(item.designId); setSelectedId(null) }}
                    className="block w-full overflow-hidden rounded-xl bg-[#0c1424] shadow-sm transition group-hover:shadow-md"
                    aria-label={`Open ${item.name}`}
                  >
                    <div className="flex aspect-[2/1] items-center justify-center p-5">
                      <div className="h-full w-full overflow-hidden" style={{ filter: 'drop-shadow(0 0 14px rgba(148,163,184,0.35))' }}>
                        <DesignThumbnail design={item} />
                      </div>
                    </div>
                  </button>
                  <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-slate-900">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">by you · {item.display.driver}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">{item.display.width}×{item.display.height} · {item.elements.length} parts</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button type="button" title="Duplicate" onClick={() => duplicateDesign(item.designId)} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-500 hover:text-slate-900">⧉</button>
                      <button type="button" title="Delete" onClick={() => deleteDesign(item.designId)} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-500 hover:text-rose-600">✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">Start from a template</h3>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">Blank or pre-wired — pick a size and go.</p>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4">
            {[
              { name: 'Blank 128 × 64', driver: 'SH1106' as OledDriver, w: 128, h: 64, elements: [] as DesignElement[] },
              { name: 'Welcome 128 × 64', driver: 'SH1106' as OledDriver, w: 128, h: 64, elements: [{ id: 't1', name: 'Title', type: 'text' as ElementType, text: 'Hello', x: 44, y: 24, width: 40, height: 8, font: '8x8' as FontName, stroke: true }] },
              { name: 'Compact 128 × 32', driver: 'SSD1306' as OledDriver, w: 128, h: 32, elements: [{ id: 't2', name: 'Title', type: 'text' as ElementType, text: 'Status ok', x: 24, y: 10, width: 60, height: 8, font: '6x8' as FontName, stroke: true }] },
              {
                name: 'Robot face 128 × 64', driver: 'SH1106' as OledDriver, w: 128, h: 64,
                elements: [
                  { id: 't3', name: 'Robot eyes', type: 'eyes' as ElementType, x: 36, y: 12, width: 56, height: 26, gap: 12 },
                  { id: 't4', name: 'Caption', type: 'text' as ElementType, text: 'Hello human', x: 29, y: 46, width: 70, height: 8, font: '6x8' as FontName, stroke: true },
                ] as DesignElement[],
              },
              {
                name: 'Ticker + scenes 128 × 64', driver: 'SH1106' as OledDriver, w: 128, h: 64,
                elements: [
                  { id: 't5', name: 'Headline', type: 'text' as ElementType, text: 'CHIP NEWS', x: 3, y: 2, width: 60, height: 8, font: '6x8' as FontName, stroke: true, sceneId: 's1' },
                  { id: 't6', name: 'Marquee', type: 'marquee' as ElementType, text: 'Breaking  •  ESP32 online  •  OLED ok  •  ', x: 3, y: 16, width: 122, height: 8, font: '6x8' as FontName, stroke: true, speed: 24, direction: 'left' as const, sceneId: 's1' },
                  { id: 't7', name: 'Second eyes', type: 'eyes' as ElementType, x: 36, y: 14, width: 56, height: 26, gap: 12, sceneId: 's2' },
                  { id: 't8', name: 'Status', type: 'text' as ElementType, text: 'STANDBY', x: 41, y: 48, width: 46, height: 8, font: '6x8' as FontName, stroke: true, sceneId: 's2' },
                ] as DesignElement[],
                scenes: [{ id: 's1', name: 'News', durationMs: 4000 }, { id: 's2', name: 'Idle', durationMs: 2500 }] as SceneDef[],
              },
            ].map((tpl) => {
              const previewDesign: OledDesign = { designId: tpl.name, name: tpl.name, type: 'oled', display: { driver: tpl.driver, width: tpl.w, height: tpl.h, address: '0x3C' }, version: 0, elements: tpl.elements, scenes: (tpl as { scenes?: SceneDef[] }).scenes }
              return (
                <div key={tpl.name} className="group min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      const fresh = createDesign(tpl.driver, tpl.w, tpl.h, tpl.name)
                      const tplScenes = (tpl as { scenes?: SceneDef[] }).scenes
                      if (tplScenes && tplScenes.length > 0) {
                        const idMap = new Map(tplScenes.map((s) => [s.id, makeId('scene')] as const))
                        fresh.scenes = tplScenes.map((s) => ({ ...s, id: idMap.get(s.id) ?? s.id }))
                        fresh.elements = tpl.elements.map((e) => ({ ...e, id: makeId('el'), sceneId: idMap.get(e.sceneId ?? '') ?? fresh.scenes![0].id }))
                      } else {
                        fresh.elements = tpl.elements.map((e) => ({ ...e, id: makeId('el'), sceneId: fresh.scenes![0].id }))
                      }
                      if (tpl.elements.length === 0) fresh.elements = []
                      setDesigns((current) => [normalizeDesign(fresh), ...current])
                      setActiveId(fresh.designId)
                      setSelectedId(null)
                    }}
                    className="block w-full overflow-hidden rounded-xl bg-[#0c1424] shadow-sm transition group-hover:shadow-md"
                  >
                    <div className="flex aspect-[2/1] items-center justify-center p-5">
                      <div className="h-full w-full overflow-hidden" style={{ filter: 'drop-shadow(0 0 14px rgba(148,163,184,0.35))' }}>
                        <DesignThumbnail design={previewDesign} />
                      </div>
                    </div>
                  </button>
                  <p className="mt-2.5 truncate px-0.5 text-[13px] font-semibold text-slate-900">{tpl.name}</p>
                  <p className="mt-0.5 px-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">{tpl.driver} · {tpl.w}×{tpl.h}</p>
                </div>
              )
            })}
          </div>
        </div>

        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setCreateOpen(false)}>
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">New screen</p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">Set up your display</h3>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Name</span>
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] outline-none focus:border-slate-400 focus:bg-white" />
              </label>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Driver</p>
              <div className="flex gap-2">
                {(['SH1106', 'SSD1306'] as OledDriver[]).map((d) => (
                  <button key={d} type="button" onClick={() => setDraftDriver(d)} className={`flex-1 rounded-full border px-3 py-2 text-xs font-semibold transition ${draftDriver === d ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{d}</button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Size</p>
              <div className="flex flex-wrap gap-2">
                {SIZE_PRESETS.map((preset) => (
                  <button key={preset.label} type="button" onClick={() => { setDraftW(preset.width); setDraftH(preset.height) }} className={`rounded-full border px-3 py-1.5 font-mono text-[11px] transition ${draftW === preset.width && draftH === preset.height ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{preset.label}</button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Width</span>
                  <input type="number" min={32} max={256} value={draftW} onChange={(event) => setDraftW(clampDisplaySize(Number(event.target.value), 32, 256))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[13px] outline-none focus:border-slate-400 focus:bg-white" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Height</span>
                  <input type="number" min={8} max={128} value={draftH} onChange={(event) => setDraftH(clampDisplaySize(Number(event.target.value), 8, 128))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[13px] outline-none focus:border-slate-400 focus:bg-white" />
                </label>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl bg-[#0c1424] p-4">
                <div className="mx-auto flex items-center justify-center bg-[#070b07]" style={{ width: Math.round(draftW * draftScale), height: Math.round(draftH * draftScale), maxWidth: '100%', boxShadow: 'inset 0 0 14px rgba(0,0,0,0.7)' }}>
                  <div className="text-center font-mono" style={{ color: '#a8ff60' }}>
                    <div style={{ fontSize: 11 }}>{draftDriver}</div>
                    <div style={{ fontSize: 10, opacity: 0.85 }}>{draftW}×{draftH} · 0x3C</div>
                  </div>
                </div>
                <div className="mx-auto mt-2 flex max-w-[300px] items-center justify-between text-[10px] text-slate-400">
                  <span>{draftDriver} {draftW}×{draftH} · 0x3C</span>
                  <span className="font-semibold text-slate-200">Ready</span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-slate-400">Cancel</button>
                <button type="button" onClick={confirmCreate} className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">Open canvas</button>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  /* ── Editor: responsive, clean ──────────────────────────────────────────── */
  return (
    <section className="flex h-full w-full flex-col overflow-hidden bg-[#f5f5f5]" aria-label="OLED Design Editor">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/80 bg-[#f5f5f5] px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => { setActiveId(null); setSelectedId(null) }}
          aria-label="Back to screens"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-slate-900">{design.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{design.display.driver} · {displayWidth}×{displayHeight} · 0x3C</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900">
            Display
          </button>
          {savedMessage && <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700 sm:inline">{savedMessage}</span>}
          <button type="button" onClick={() => setPreview(true)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900">Preview</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-full bg-[#0f172a] px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save design'}</button>
        </div>
      </header>

      {/* Registry-driven properties bar: controls come from the component schema */}
      {selected && (() => {
        const def = getComponent(selected.type)
        if (!def) return null
        const record = selected as unknown as Record<string, string | number | boolean | undefined>
        const display = { width: displayWidth, height: displayHeight }
        const applyProp = (key: string, raw: string | number | boolean) => {
          let value = raw
          // Geometry keys stay display-clamped no matter what the schema allows.
          if (key === 'x' && typeof value === 'number') value = clamp(value, 0, Math.max(0, display.width - 1))
          if (key === 'y' && typeof value === 'number') value = clamp(value, 0, Math.max(0, display.height - 1))
          if (key === 'width' && typeof value === 'number') value = clamp(value, 1, display.width)
          if (key === 'height' && typeof value === 'number') value = clamp(value, 1, display.height)
          updateElement(selected.id, patchElement(selected, key, value, display) as Partial<DesignElement>)
        }
        const inlineable = (selected.type === 'text' || selected.type === 'marquee')
        return (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200/80 bg-white px-3 py-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600" title={def.description}>{def.name}</span>
            {def.props.filter((desc) => !desc.showIf || record[desc.showIf.key] === desc.showIf.value).map((desc) => (
              <PropControl
                key={desc.key}
                desc={desc}
                value={record[desc.key]}
                onChange={(v) => applyProp(desc.key, v)}
                inlineText={desc.key === 'text' && inlineable ? {
                  value: editingTextId === selected.id ? textDraft : (selected.text ?? ''),
                  onChange: (next) => {
                    if (editingTextId === selected.id) setTextDraft(next)
                    else applyProp('text', next)
                  },
                  onFocus: () => { setEditingTextId(selected.id); setTextDraft(selected.text ?? '') },
                  onBlur: commitInlineEdit,
                  onKeyDown: (event) => { if (event.key === 'Enter') commitInlineEdit(); if (event.key === 'Escape') cancelInlineEdit() },
                  placeholder: selected.type === 'marquee' ? 'Ticker text…' : 'Type on canvas…',
                } : null}
              />
            ))}
            <div className="ml-auto flex items-center gap-1">
            <button type="button" title="Send backward" onClick={() => reorderSelected(-1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-slate-900" aria-label="Send backward">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
            </button>
            <button type="button" title="Bring forward" onClick={() => reorderSelected(1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-slate-900" aria-label="Bring forward">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
            </button>
            <button type="button" title="Delete element" onClick={deleteSelected} className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 text-rose-500 hover:bg-rose-50" aria-label="Delete element">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            </button>
            </div>
          </div>
        )
      })()}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col items-center justify-start gap-3 overflow-auto p-3 sm:justify-center sm:p-6">
          {/* Registry-driven tool pill: one icon button per registered component */}
          <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-slate-200 bg-white py-1.5 pl-2 pr-2 shadow-sm">
            {TOOLBAR_ORDER.map((entryType, i) => {
              const def = getComponent(entryType)
              if (!def) return null
              const showDividerAfter = i === 4
              return (
                <span key={def.type} className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => addElement(def.type)}
                    title={`Add ${def.name.toLowerCase()} — ${def.description}`}
                    aria-label={`Add ${def.name.toLowerCase()}`}
                    className="flex h-8 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    {ICONS[def.icon] ?? def.name[0]}
                  </button>
                  {showDividerAfter && <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />}
                </span>
              )
            })}
            <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              title={playing ? 'Pause animation' : 'Play component animation'}
              aria-label={playing ? 'Pause animation' : 'Play animation'}
              aria-pressed={playing}
              className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-full transition ${playing ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              {playing
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" /></svg>}
            </button>
            <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
            <button type="button" onClick={() => setZoom((value) => Math.max(2, value - 1))} title="Zoom out" aria-label="Zoom out" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100">−</button>
            <button type="button" onClick={() => setZoom(fitZoom)} title="Fit to screen" className="shrink-0 rounded-full px-1.5 font-mono text-[11px] text-slate-500 hover:text-slate-900">{zoom}×</button>
            <button type="button" onClick={() => setZoom((value) => Math.min(8, value + 1))} title="Zoom in" aria-label="Zoom in" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100">+</button>
            <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              title="Toggle pixel grid"
              aria-label="Toggle pixel grid"
              aria-pressed={showGrid}
              className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-full transition ${showGrid ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16v16H4z" /><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" /></svg>
            </button>
          </div>
          {/* Scenes: each chip is a screen in the flow; durations drive playback + device loops */}
          <div className="flex w-full max-w-full flex-wrap items-center gap-1.5" style={{ maxWidth: canvasMaxWidth + 28 }}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Scenes</span>
            {scenes.map((s, i) => {
              const count = design.elements.filter((e) => (e.sceneId ?? scenes[0].id) === s.id).length
              // Highlight the user's selection — never the clock — so clicks always land.
              const active = s.id === resolvedSceneId
              return (
                <span key={s.id} className={`flex items-center gap-1 rounded-full border pl-2.5 text-[11px] transition ${active ? 'border-slate-900 bg-slate-900 font-medium text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                  <button type="button" onClick={() => { setPlaying(false); setActiveSceneId(s.id); setSelectedId(null) }} title={`Open ${s.name}`} className="py-1">
                    {i + 1} · {s.name} · {count}
                  </button>
                  {scenes.length > 1 && (
                    <button type="button" onClick={() => deleteScene(s.id)} title={`Delete ${s.name} (elements move to Scene 1)`} aria-label={`Delete ${s.name}`} className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${active ? 'text-slate-300 hover:text-white' : 'text-slate-400 hover:text-rose-600'}`}>×</button>
                  )}
                </span>
              )
            })}
            <button type="button" onClick={addScene} title="Add scene" aria-label="Add scene" className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-sm text-slate-500 hover:border-slate-500 hover:text-slate-900">+</button>
            <label className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-500" title="How long the open scene plays (ms)">
              ⏱
              <input
                type="number" min={400} max={30000} step={100}
                value={Math.max(400, Number(scenes.find((s) => s.id === resolvedSceneId)?.durationMs) || 2000)}
                onChange={(event) => setSceneDuration(resolvedSceneId, Number(event.target.value))}
                aria-label="Scene duration milliseconds"
                className="w-12 bg-transparent text-right outline-none"
              />
              ms
            </label>
          </div>
          <div className="w-full rounded-2xl bg-[#0c1424] p-2.5 shadow-md sm:p-3.5" style={{ maxWidth: canvasMaxWidth + 28 }}>
            <div className="w-full overflow-hidden rounded-lg bg-[#f8fafc]" style={{ aspectRatio: `${displayWidth} / ${displayHeight}` }}>
              <svg ref={canvasRef} viewBox={`0 0 ${displayWidth} ${displayHeight}`} className="block h-full w-full" preserveAspectRatio="xMidYMid meet" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerLeave={endDrag} onClick={() => setSelectedId(null)}>
                {showGrid && <path d={`M0 0H${displayWidth}V${displayHeight}H0Z`} fill="url(#pixel-grid)" />}
                <defs><pattern id="pixel-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#dbe3ec" strokeWidth="0.04" /></pattern></defs>
                {visibleElements.map((element) => {
                  const isSelected = selectedId === element.id
                  const isTextEditing = editingTextId === element.id
                  return (
                    <g
                      key={element.id}
                      onPointerDown={(event) => startDrag(event, element)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => { if (element.type === 'text' || element.type === 'marquee') { event.stopPropagation(); beginInlineEdit(element) } }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSelectedId(element.id)
                        setMenu({ x: event.clientX, y: event.clientY, id: element.id })
                      }}
                      className="cursor-move"
                    >
                      {(element.type === 'text' || element.type === 'marquee') && isTextEditing && (
                        <foreignObject x={element.x} y={element.y} width={Math.max(element.width, 30)} height={Math.max(element.height + 2, 11)}>
                          <input
                            // @ts-expect-error xmlns is required inside SVG foreignObject
                            xmlns="http://www.w3.org/1999/xhtml"
                            autoFocus
                            value={textDraft}
                            onChange={(event) => setTextDraft((event.target as HTMLInputElement).value)}
                            onBlur={commitInlineEdit}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if ((event as unknown as React.KeyboardEvent).key === 'Enter') commitInlineEdit()
                              if ((event as unknown as React.KeyboardEvent).key === 'Escape') cancelInlineEdit()
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            aria-label="Edit text on canvas"
                            style={{
                              width: '100%',
                              height: '100%',
                              fontFamily: 'monospace',
                              fontSize: (element.font === '8x8' ? 8 : element.font === '5x7' ? 5 : 6) * scaleOf(element),
                              lineHeight: 1,
                              color: '#0f172a',
                              background: 'rgba(255,255,255,0.92)',
                              border: '1px solid #2563eb',
                              borderRadius: 1,
                              padding: '0 1px',
                              outline: 'none',
                            }}
                          />
                        </foreignObject>
                      )}
                      {/* Registry render: every component draws through its definition. */}
                      {!isTextEditing && renderSvg(element, '#0f172a', { playing, playMs, idPrefix: 'cv', paper: '#f8fafc' })}
                      {isSelected && (() => {
                        // Text frames hug the letters (or the invert block) but stay stretchable.
                        const fit = element.type === 'text' ? textFitBox(element) : null
                        const bx = element.x + (fit?.ox ?? 0)
                        const by = element.y + (fit?.oy ?? 0)
                        const bw = fit ? Math.min(Math.max(fit.width, element.width), displayWidth - bx) : element.width
                        const bh = fit ? Math.max(fit.height, element.height) : element.height
                        return (
                        <g>
                          <rect x={bx - 1} y={by - 1} width={Math.max(bw, 8) + 2} height={Math.max(bh, 8) + 2} fill="none" stroke="#2563eb" strokeDasharray="3 2" strokeWidth="0.6" />
                          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => {
                            const handlePosition = (() => {
                              const offset = 1.5
                              if (handle === 'nw') return { x: bx - offset, y: by - offset }
                              if (handle === 'n') return { x: bx + bw / 2, y: by - offset }
                              if (handle === 'ne') return { x: bx + bw + offset, y: by - offset }
                              if (handle === 'e') return { x: bx + bw + offset, y: by + bh / 2 }
                              if (handle === 'se') return { x: bx + bw + offset, y: by + bh + offset }
                              if (handle === 's') return { x: bx + bw / 2, y: by + bh + offset }
                              if (handle === 'sw') return { x: bx - offset, y: by + bh + offset }
                              return { x: bx - offset, y: by + bh / 2 }
                            })()
                            return (
                              <rect
                                key={handle}
                                x={handlePosition.x - 1.1}
                                y={handlePosition.y - 1.1}
                                width={2.2}
                                height={2.2}
                                fill="#ffffff"
                                stroke="#2563eb"
                                strokeWidth="0.5"
                                onPointerDown={(event) => startResize(event, element, handle)}
                                className="cursor-pointer"
                              />
                            )
                          })}
                        </g>
                        )
                      })()}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-center gap-2" style={{ maxWidth: canvasMaxWidth + 28 }}>
            {selected ? (
              <>
                <span className="rounded-full bg-white px-3 py-2 font-mono text-[11px] text-slate-500 shadow-sm">{getComponent(selected.type)?.name ?? selected.name} · {Math.round(selected.x)},{Math.round(selected.y)}</span>
                {(selected.type === 'text' || selected.type === 'marquee') && (
                  <button type="button" onClick={() => beginInlineEdit(selected)} className="rounded-full bg-[#0f172a] px-4 py-2 text-[12px] font-medium text-white shadow-sm transition hover:bg-slate-700">
                    {editingTextId === selected.id ? 'Editing…' : 'Edit Text'}
                  </button>
                )}
                <button type="button" onClick={() => deleteById(selected.id)} className="rounded-full border border-rose-200 bg-white px-4 py-2 text-[12px] font-medium text-rose-500 shadow-sm hover:bg-rose-50">Delete</button>
                <button type="button" onClick={() => { cancelInlineEdit(); setSelectedId(null) }} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[12px] text-slate-500 shadow-sm hover:text-slate-800">Deselect</button>
              </>
            ) : (
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{displayWidth}×{displayHeight} · {zoom}× · {visibleElements.length} layers{playing ? ' · playing' : ''} · double-click text to type · right-click for more</p>
            )}
          </div>
          {/* Layers as compact chips — current scene only */}
          <div className="flex w-full flex-wrap items-center justify-center gap-1.5" style={{ maxWidth: canvasMaxWidth + 28 }}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Layers · {visibleElements.length}</span>
            {visibleElements.map((element) => (
              <button
                key={element.id}
                type="button"
                onClick={() => setSelectedId(element.id)}
                className={`max-w-28 truncate rounded-full border px-2.5 py-1 text-[11px] transition ${selectedId === element.id ? 'border-slate-900 bg-slate-900 font-medium text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                title={element.name}
              >
                {element.name}
              </button>
            ))}
          </div>
        </main>

      </div>

      {/* Right-click menu: click an action, it just happens */}
      {menu && (() => {
        const target = design.elements.find((e) => e.id === menu.id)
        if (!target) return null
        const canEditText = target.type === 'text' || target.type === 'marquee'
        const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-600 transition hover:bg-slate-100'
        return (
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
          >
            <div
              data-ctxmenu
              role="menu"
              aria-label={`Actions for ${target.name}`}
              className="absolute w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              style={{
                left: Math.max(8, Math.min(menu.x, window.innerWidth - 200)),
                top: Math.max(8, Math.min(menu.y, window.innerHeight - (canEditText ? 240 : 200))),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="truncate px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">{target.name}</p>
              {canEditText && (
                <button type="button" role="menuitem" className={item} onClick={() => { setMenu(null); beginInlineEdit(target) }}>
                  <span className="font-mono font-bold">T</span> Edit text
                </button>
              )}
              <button type="button" role="menuitem" className={item} onClick={duplicateSelected}>
                <span aria-hidden="true">⧉</span> Duplicate
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => { reorderSelected(1); setMenu(null) }}>
                <span aria-hidden="true">↓</span> Bring forward
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => { reorderSelected(-1); setMenu(null) }}>
                <span aria-hidden="true">↑</span> Send backward
              </button>
              <button type="button" role="menuitem" className={`${item} font-medium text-rose-600 hover:!bg-rose-50`} onClick={() => deleteById(target.id)}>
                <span aria-hidden="true">✕</span> Delete
              </button>
            </div>
          </div>
        )
      })()}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setSettingsOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Display settings</p>
            <h3 className="mt-1 text-base font-semibold text-slate-900">{design.name}</h3>
            <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Driver</p>
            <div className="flex gap-2">
              {(['SH1106', 'SSD1306'] as OledDriver[]).map((d) => (
                <button key={d} type="button" onClick={() => applyDisplaySize(displayWidth, displayHeight, d)} className={`flex-1 rounded-full border px-3 py-2 text-xs font-semibold transition ${design.display.driver === d ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{d}</button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Size</p>
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => applyDisplaySize(preset.width, preset.height)} className={`rounded-full border px-3 py-1.5 font-mono text-[11px] transition ${displayWidth === preset.width && displayHeight === preset.height ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{preset.label}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Width</span>
                <input type="number" min={32} max={256} value={displayWidth} onChange={(event) => applyDisplaySize(Number(event.target.value), displayHeight)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[13px] outline-none focus:border-slate-400 focus:bg-white" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-slate-500">Height</span>
                <input type="number" min={8} max={128} value={displayHeight} onChange={(event) => applyDisplaySize(displayWidth, Number(event.target.value))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[13px] outline-none focus:border-slate-400 focus:bg-white" />
              </label>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">Done</button>
          </div>
        </div>
      )}

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(false)}><div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl sm:p-5" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">OLED Preview · {scenes.find((s) => s.id === visibleSceneId)?.name ?? 'Scene'} · {displayWidth}×{displayHeight}</h2><button type="button" onClick={() => setPreview(false)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800">Close</button></div><div className="rounded-xl bg-[#0c1424] p-3 sm:p-4"><div className="w-full overflow-hidden rounded bg-white" style={{ aspectRatio: `${displayWidth} / ${displayHeight}` }}><svg viewBox={`0 0 ${displayWidth} ${displayHeight}`} className="block h-full w-full" preserveAspectRatio="xMidYMid meet">{visibleElements.map((element) => <g key={element.id}>{renderSvg(element, '#0f172a', { playing: false, playMs: 0, idPrefix: 'pv', paper: '#ffffff' })}</g>)}</svg></div></div></div></div>}
    </section>
  )
}
