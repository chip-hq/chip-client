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

// Per-type visual config
const THEME = {
  error: {
    bar: '#ef4444',
    icon: '#ef4444',
    bg: 'rgba(20,20,20,0.97)',
    border: 'rgba(239,68,68,0.35)',
    title: '#f87171',
    msg: '#d1d5db',
  },
  success: {
    bar: '#22c55e',
    icon: '#22c55e',
    bg: 'rgba(20,20,20,0.97)',
    border: 'rgba(34,197,94,0.35)',
    title: '#4ade80',
    msg: '#d1d5db',
  },
  info: {
    bar: '#60a5fa',
    icon: '#60a5fa',
    bg: 'rgba(20,20,20,0.97)',
    border: 'rgba(96,165,250,0.35)',
    title: '#93c5fd',
    msg: '#d1d5db',
  },
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

  // slide-in / slide-out state
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // progress bar width (100 → 0)
  const [progress, setProgress] = useState(100)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const [paused, setPaused] = useState(false)

  // Trigger enter on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss countdown via rAF
  useEffect(() => {
    if (paused) return

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const elapsed = ts - startRef.current
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        handleDismiss()
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [paused, duration]) // eslint-disable-line

  const handleDismiss = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(() => onDismiss(alert.id), 320)
  }

  const handleMouseEnter = () => {
    setPaused(true)
    pausedAtRef.current = Date.now()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  const handleMouseLeave = () => {
    // Adjust startRef so remaining time is preserved
    if (pausedAtRef.current !== null && startRef.current !== null) {
      const pausedDuration = Date.now() - pausedAtRef.current
      startRef.current += pausedDuration
      pausedAtRef.current = null
    }
    setPaused(false)
  }

  const translateY = visible && !leaving ? '0' : '-110%'
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
        borderLeft: `3px solid ${theme.bar}`,
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        width: '100%',
        maxWidth: '360px',
        position: 'relative',
        cursor: 'default',
      }}
      role="alert"
    >
      {/* Content row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px 14px' }}>
        {/* Icon */}
        <div style={{ flexShrink: 0, marginTop: '2px' }}>
          <TypeIcon type={alert.type} />
        </div>

        {/* Text */}
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

        {/* Dismiss X */}
        <button
          onClick={handleDismiss}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: '#6b7280',
            lineHeight: 0,
            borderRadius: '4px',
            transition: 'color 0.15s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.color = '#e5e7eb')}
          onMouseOut={(e) => (e.currentTarget.style.color = '#6b7280')}
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Countdown progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '2.5px',
          width: `${progress}%`,
          background: theme.bar,
          transition: paused ? 'none' : 'width 0.1s linear',
          borderRadius: '0 0 0 10px',
          opacity: 0.85,
        }}
      />
    </div>
  )
}

export function AlertToast({ alerts, onDismiss }: AlertToastProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
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
