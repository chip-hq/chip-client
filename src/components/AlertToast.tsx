import { useEffect, useRef, useState } from 'react'

export type AlertType = 'error' | 'success' | 'info'

export interface AlertItem {
  id: string
  type: AlertType
  title?: string
  message: string
  duration?: number
}

interface AlertToastProps {
  alerts: AlertItem[]
  onDismiss: (id: string) => void
}

// Shared amber palette for all alert types (light #f9e3b3 fill, dark amber text).
const AMBER = {
  icon: '#92400e',
  bg: '#f9e3b3',
  border: 'rgba(120,53,15,0.35)',
  title: '#7c2d12',
  msg: '#7c2d12',
}
const THEME = {
  error: AMBER,
  success: AMBER,
  info: AMBER,
}

function TypeIcon({ type }: { type: AlertType }) {
  const c = THEME[type].icon
  if (type === 'success') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  if (type === 'error') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function SingleAlert({ alert, onDismiss }: { alert: AlertItem; onDismiss: (id: string) => void }) {
  const duration = alert.duration ?? (alert.type === 'error' ? 6000 : 4500)
  const theme = THEME[alert.type]

  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const remainingRef = useRef(duration)
  const startRef = useRef<number | null>(null)

  const handleDismiss = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(() => onDismiss(alert.id), 320)
  }

  // Trigger enter on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss after `duration`; pauses while hovered and resumes with time remaining
  useEffect(() => {
    if (paused) return
    startRef.current = Date.now()
    const t = setTimeout(handleDismiss, remainingRef.current)
    return () => {
      clearTimeout(t)
      if (startRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only on pause toggle; handleDismiss stays out so the timer isn't reset each render
  }, [paused])

  const handleMouseEnter = () => setPaused(true)
  const handleMouseLeave = () => setPaused(false)

  const translateY = visible && !leaving ? '0' : '110%'
  const opacity = visible && !leaving ? '1' : '0'

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `translateY(${translateY})`,
        opacity,
        transition: leaving
          ? 'transform 0.32s cubic-bezier(0.4,0,1,1), opacity 0.28s ease'
          : 'transform 0.38s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease',
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
        pointerEvents: 'auto',
        width: '100%',
        maxWidth: '360px',
        cursor: 'default',
      }}
      role="alert"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px' }}>
        <div style={{ flexShrink: 0, marginTop: '2px' }}>
          <TypeIcon type={alert.type} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {alert.title && (
            <div style={{ fontSize: '12px', fontWeight: 600, color: theme.title, marginBottom: '2px', letterSpacing: '-0.01em' }}>
              {alert.title}
            </div>
          )}
          <div style={{ fontSize: '12px', color: theme.msg, lineHeight: '1.55', wordBreak: 'break-word', fontWeight: 400 }}>
            {alert.message}
          </div>
        </div>

        <button
          onClick={handleDismiss}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: 'rgba(124,45,18,0.55)',
            lineHeight: 0,
            borderRadius: '4px',
            transition: 'color 0.15s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.color = '#7c2d12')}
          onMouseOut={(e) => (e.currentTarget.style.color = 'rgba(124,45,18,0.55)')}
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function AlertToast({ alerts, onDismiss }: AlertToastProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '360px',
        pointerEvents: 'none',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {alerts.map((alert) => (
        <SingleAlert key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
