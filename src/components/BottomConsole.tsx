import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { CompanionPreview } from './CompanionPreview'
import { BluetoothPanel } from './bluetooth/BluetoothPanel'

export type ConsoleTab = 'log' | 'preview'

const MIN_HEIGHT = 120
const MAX_HEIGHT_RATIO = 0.7
const DEFAULT_HEIGHT = 160
const MIN_BT_PCT = 22
const MAX_BT_PCT = 70
const DEFAULT_BT_PCT = 40

interface BottomConsoleProps {
  log: string[]
  onClearLog: () => void
  activeTab: ConsoleTab
  onTabChange: (tab: ConsoleTab) => void
  companionHtml: string | null
  companionTitle: string | null
  recentSerialLine: string | null
  oledPreviewEnabled?: boolean
}

export function BottomConsole({
  log,
  onClearLog,
  activeTab,
  onTabChange,
  companionHtml,
  companionTitle,
  recentSerialLine,
  oledPreviewEnabled = false,
}: BottomConsoleProps) {
  const [open, setOpen] = useState(true)
  const [btOpen, setBtOpen] = useState(false)
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem('chip_console_height_v2'))
    return Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT
  })
  const [btWidthPct, setBtWidthPct] = useState(() => {
    const saved = Number(localStorage.getItem('chip_bt_width_pct'))
    return Number.isFinite(saved) && saved >= MIN_BT_PCT && saved <= MAX_BT_PCT
      ? saved
      : DEFAULT_BT_PCT
  })
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const prevTabRef = useRef(activeTab)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const widthDragRef = useRef<{ startX: number; startPct: number; bodyW: number } | null>(null)

  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      setOpen(true)
      prevTabRef.current = activeTab
    }
  }, [activeTab])

  useEffect(() => {
    if (open && activeTab === 'log') {
      logEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [log, open, activeTab])

  useEffect(() => {
    localStorage.setItem('chip_console_height_v2', String(height))
  }, [height])

  useEffect(() => {
    localStorage.setItem('chip_bt_width_pct', String(btWidthPct))
  }, [btWidthPct])

  const toggle = () => setOpen((o) => !o)

  const selectTab = (tab: ConsoleTab) => {
    onTabChange(tab)
    setOpen(true)
  }

  const toggleBluetooth = () => {
    setBtOpen((v) => !v)
    setOpen(true)
  }

  const onResizeStart = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      dragRef.current = { startY: clientY, startH: height }
      setOpen(true)

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!dragRef.current) return
        const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY
        const delta = dragRef.current.startY - y
        const maxH = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO)
        const next = Math.min(maxH, Math.max(MIN_HEIGHT, dragRef.current.startH + delta))
        setHeight(next)
      }

      const onUp = () => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onUp)
    },
    [height],
  )

  const onBtWidthResizeStart = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const bodyW = bodyRef.current?.getBoundingClientRect().width ?? 0
      if (bodyW <= 0) return
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      widthDragRef.current = { startX: clientX, startPct: btWidthPct, bodyW }

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!widthDragRef.current) return
        const x = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
        // Dragging the handle left grows the Bluetooth panel.
        const deltaPct = ((widthDragRef.current.startX - x) / widthDragRef.current.bodyW) * 100
        const next = Math.min(
          MAX_BT_PCT,
          Math.max(MIN_BT_PCT, widthDragRef.current.startPct + deltaPct),
        )
        setBtWidthPct(next)
      }

      const onUp = () => {
        widthDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onUp)
    },
    [btWidthPct],
  )

  return (
    <div className={`bottom-console ${open ? 'open' : 'closed'} ${btOpen ? 'bt-split' : ''}`}>
      <div
        className="bottom-console-resize"
        onMouseDown={onResizeStart}
        onTouchStart={onResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize console"
        title="Drag to resize"
      />

      <div
        className="bottom-console-bar"
      >
        <div className="bottom-console-tabs" onClick={(e) => e.stopPropagation()} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'log'}
            onClick={() => selectTab('log')}
            className={`bottom-console-tab ${activeTab === 'log' ? 'active' : ''}`}
          >
            Serial Logs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'preview'}
            onClick={() => selectTab('preview')}
            className={`bottom-console-tab ${activeTab === 'preview' ? 'active' : ''}`}
          >
            <span className="bottom-console-tab-dot" aria-hidden="true" />
            <span className="bottom-console-tab-full">Live AI Companion</span>
            <span className="bottom-console-tab-short">Companion</span>
            {companionHtml && <span className="bottom-console-live">Live</span>}
          </button>
        </div>

        <div className="bottom-console-actions" onClick={(e) => e.stopPropagation()}>
          {open && activeTab === 'log' && (
            <button type="button" className="ghost sm" onClick={onClearLog}>
              Clear
            </button>
          )}
          <button
            type="button"
            className={`bottom-console-bt-btn ${btOpen ? 'active' : ''}`}
            onClick={toggleBluetooth}
            aria-pressed={btOpen}
            aria-label={btOpen ? 'Hide Bluetooth panel' : 'Show Bluetooth panel'}
            title="Bluetooth panel"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m7 7 10 10-5 5V2l5 5L7 17" />
            </svg>
          </button>
          <button
            type="button"
            className="bottom-console-toggle"
            onClick={toggle}
            aria-label={open ? 'Collapse console' : 'Expand console'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{
                transform: open ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.18s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="bottom-console-body" style={{ height }} ref={bodyRef}>
          <div
            className="bottom-console-main"
            style={btOpen ? { flex: `1 1 ${100 - btWidthPct}%`, width: `${100 - btWidthPct}%`, maxWidth: `${100 - btWidthPct}%` } : undefined}
          >
            <div className={`bottom-console-pane ${activeTab === 'log' ? 'active' : ''}`}>
              <pre className="console">
                {log.length === 0 && <span className="muted">Waiting for actions…</span>}
                {log.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                <div ref={logEndRef} />
              </pre>
            </div>
            <div className={`bottom-console-pane ${activeTab === 'preview' ? 'active' : ''}`}>
              <CompanionPreview
                htmlContent={companionHtml}
                jobTitle={companionTitle || undefined}
                recentSerialLine={recentSerialLine}
                fill
              />
            </div>
          </div>

          {btOpen && (
            <>
              <div
                className="bottom-console-bt-resize"
                onMouseDown={onBtWidthResizeStart}
                onTouchStart={onBtWidthResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Bluetooth panel"
                title="Drag to resize Bluetooth panel"
              />
              <aside
                className="bottom-console-bt"
                aria-label="Bluetooth panel"
                style={{ flex: `0 0 ${btWidthPct}%`, width: `${btWidthPct}%`, maxWidth: `${btWidthPct}%` }}
              >
                <BluetoothPanel oledPreviewEnabled={oledPreviewEnabled} />
              </aside>
            </>
          )}
        </div>
      )}
    </div>
  )
}
