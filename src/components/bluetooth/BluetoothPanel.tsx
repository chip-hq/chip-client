import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BT_DEVICE_LABEL,
  BT_MAX_MESSAGE_LENGTH,
  createBluetoothTransport,
  formatBtTime,
  isWebSerialSppAvailable,
  makeTerminalEntry,
  normalizeBtFailure,
  sanitizeBtMessage,
  type BtConnectionState,
  type BtFailure,
  type BtTerminalEntry,
  type BluetoothTransport,
} from '../../bluetooth'
import { OledPreview } from './OledPreview'

function statusLabel(state: BtConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'error':
      return 'Error'
    case 'unsupported':
      return 'Unsupported'
    default:
      return 'Disconnected'
  }
}

function oledStatus(
  state: BtConnectionState,
  phase: 'idle' | 'live' | 'sent' | 'acked',
): 'Connected' | 'Waiting' | 'Message received' | 'Disconnected' {
  if (state !== 'connected') return 'Disconnected'
  if (phase === 'acked') return 'Message received'
  if (phase === 'sent') return 'Connected'
  if (phase === 'live') return 'Waiting'
  return 'Connected'
}

const IDLE_OLED = 'Waiting\nBT ready'

interface BluetoothPanelProps {
  oledPreviewEnabled?: boolean
}

export function BluetoothPanel({ oledPreviewEnabled = false }: BluetoothPanelProps) {
  const transportRef = useRef<BluetoothTransport | null>(null)
  if (!transportRef.current) {
    transportRef.current = createBluetoothTransport()
  }
  const transport = transportRef.current

  const [state, setState] = useState<BtConnectionState>(() => transport.getState())
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [oledText, setOledText] = useState(IDLE_OLED)
  const [oledPhase, setOledPhase] = useState<'idle' | 'live' | 'sent' | 'acked'>('idle')
  const [failure, setFailure] = useState<BtFailure | null>(null)
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [entries, setEntries] = useState<BtTerminalEntry[]>(() => [
    makeTerminalEntry(
      'system',
      isWebSerialSppAvailable()
        ? 'Bridge ready: pair your Bluetooth module in OS settings, then Connect (Web Serial SPP).'
        : 'Classic Bluetooth SPP modules cannot be accessed directly from this browser. Use Chrome/Edge on desktop with an OS-paired serial port, or a native companion.',
    ),
  ])
  const termEndRef = useRef<HTMLDivElement | null>(null)
  const termScrollRef = useRef<HTMLDivElement | null>(null)
  const panelScrollRef = useRef<HTMLDivElement | null>(null)
  const wasConnectedRef = useRef(false)

  const push = useCallback((kind: BtTerminalEntry['kind'], text: string) => {
    setEntries((prev) => [...prev, makeTerminalEntry(kind, text)].slice(-200))
  }, [])

  const resetIdleUi = useCallback(() => {
    setDeviceName(null)
    setOledText(IDLE_OLED)
    setOledPhase('idle')
    if (ackTimerRef.current) {
      clearTimeout(ackTimerRef.current)
      ackTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const offState = transport.onConnectionStateChange((next) => {
      setState(next)
      setDeviceName(transport.getDeviceName())

      if (wasConnectedRef.current && next === 'disconnected') {
        wasConnectedRef.current = false
        resetIdleUi()
        setFailure({
          code: 'failed',
          message: 'Bluetooth link dropped. You can Connect again when ready.',
          recoverable: true,
        })
        push('info', 'Bluetooth link dropped — back to disconnected.')
      }
      if (next === 'connected') {
        wasConnectedRef.current = true
        setFailure(null)
      }
    })
    const offMsg = transport.onMessage((line) => {
      push('rx', `RX ← ${line}`)
      if (/^ESP32 connected/i.test(line)) {
        push('info', 'ESP32 firmware is online over Bluetooth UART')
      }
      if (/^OLED:\s*/i.test(line)) {
        const shown = line.replace(/^OLED:\s*/i, '').trim()
        setOledText(shown)
        setOledPhase('acked')
        if (ackTimerRef.current) {
          clearTimeout(ackTimerRef.current)
          ackTimerRef.current = null
        }
        push('info', 'OLED updated (board ACK)')
      }
    })
    return () => {
      offState()
      offMsg()
    }
  }, [transport, push, resetIdleUi])

  useEffect(() => {
    // Keep the panel pinned to the connection card on open — only scroll the terminal box.
    const box = termScrollRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [entries])

  useEffect(() => {
    panelScrollRef.current?.scrollTo({ top: 0 })
  }, [])

  const connected = state === 'connected'
  const unsupported = state === 'unsupported' || transport.kind === 'unsupported'

  const handleConnect = async () => {
    setBusy(true)
    setFailure(null)
    try {
      if (connected) {
        push('info', 'Releasing previous Bluetooth port before switching…')
      }
      push('info', 'Connecting via serial SPP bridge…')
      const result = await transport.connect()

      if (!result.ok) {
        resetIdleUi()
        if (result.failure.code === 'cancelled') {
          push('info', result.failure.message)
        } else {
          setFailure(result.failure)
          push('error', result.failure.message)
        }
        return
      }

      setDeviceName(transport.getDeviceName())
      setOledText(IDLE_OLED)
      setOledPhase('idle')
      setFailure(null)
      push('info', `Bluetooth connected: ${transport.getDeviceName() ?? BT_DEVICE_LABEL}`)
      push('info', 'Waiting for ESP32 UART traffic (send a message to update the OLED)…')
    } catch (err) {
      // Belt-and-suspenders: connect should not throw, but never leave the UI stuck.
      const mapped = normalizeBtFailure(err)
      resetIdleUi()
      try {
        await transport.disconnect()
      } catch {
        /* ignore */
      }
      setFailure(mapped)
      push('error', mapped.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    setFailure(null)
    wasConnectedRef.current = false
    try {
      await transport.disconnect()
      push('info', 'Bluetooth disconnected')
    } catch {
      push('info', 'Disconnected (forced cleanup).')
    } finally {
      resetIdleUi()
      setBusy(false)
    }
  }

  const handleSend = async () => {
    const message = sanitizeBtMessage(draft)
    if (!message) return
    setBusy(true)
    setFailure(null)
    // Update OLED preview immediately (real-time), then wait for board ACK.
    setOledText(message)
    setOledPhase('sent')
    try {
      await transport.send(message)
      push('tx', `TX → ${message}`)
      setDraft('')

      if (ackTimerRef.current) clearTimeout(ackTimerRef.current)
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null
        setOledPhase((phase) => {
          // TX already reached the board if the physical OLED updated — missing ACK is common on SPP and not a failure.
          if (phase === 'acked') return phase
          return 'sent'
        })
      }, 4000)
    } catch (err) {
      const mapped = normalizeBtFailure(err)
      setFailure(mapped)
      push('error', mapped.message)
      if (mapped.code === 'not_connected' || /link dropped|not connected/i.test(mapped.message)) {
        wasConnectedRef.current = false
        resetIdleUi()
      }
    } finally {
      setBusy(false)
    }
  }

  const remaining = BT_MAX_MESSAGE_LENGTH - draft.length
  const canSend = connected && !busy && sanitizeBtMessage(draft).length > 0

  // Live OLED mirror: typing updates the preview immediately.
  const previewText = useMemo(() => {
    if (connected && draft.trim()) return draft.trim()
    return oledText
  }, [connected, draft, oledText])

  const previewPhase = useMemo(() => {
    if (!connected) return 'idle' as const
    if (oledPhase === 'acked') return 'acked' as const
    if (oledPhase === 'sent') return 'sent' as const
    if (draft.trim()) return 'live' as const
    return 'idle' as const
  }, [connected, oledPhase, draft])

  const stateClass = useMemo(() => {
    if (connected) return 'bt-ok'
    if (state === 'connecting') return 'bt-wait'
    if (failure || unsupported) return 'bt-bad'
    return 'bt-idle'
  }, [connected, state, unsupported, failure])

  return (
    <div className="bt-panel">
      <div className="bt-panel-scroll" ref={panelScrollRef}>
        <section className="bt-card">
          <div className="bt-card-head">
            <div className="bt-card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m7 7 10 10-5 5V2l5 5L7 17" />
              </svg>
              <span>Bluetooth Bridge</span>
            </div>
            <span className={`bt-pill ${stateClass}`}>{statusLabel(state === 'error' ? 'disconnected' : state)}</span>
          </div>

          <div className="bt-meta">
            <div>
              <span className="bt-meta-label">Device</span>
              <span className="bt-meta-value">{deviceName ?? BT_DEVICE_LABEL}</span>
            </div>
            <div>
              <span className="bt-meta-label">Transport</span>
              <span className="bt-meta-value">{transport.label}</span>
            </div>
          </div>

          {unsupported && (
            <p className="bt-warn">
              Classic Bluetooth SPP modules cannot be accessed directly from this browser. Use the
              supported bridge (Chrome/Edge + OS-paired serial port), or a native companion.
            </p>
          )}

          {failure && (
            <div className={`bt-banner ${failure.recoverable ? 'bt-banner-soft' : 'bt-banner-hard'}`} role="alert">
              <p className="bt-banner-text">{failure.message}</p>
              <div className="bt-banner-actions">
                {failure.recoverable && !connected && !unsupported && (
                  <button
                    type="button"
                    className="bt-btn primary"
                    disabled={busy}
                    onClick={() => {
                      setFailure(null)
                      push('info', 'Retrying connection…')
                      window.setTimeout(() => void handleConnect(), failure.code === 'busy' ? 1200 : 0)
                    }}
                  >
                    {failure.code === 'busy' ? 'Wait & retry' : 'Try again'}
                  </button>
                )}
                <button
                  type="button"
                  className="bt-btn"
                  onClick={() => setFailure(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="bt-actions">
            {!connected ? (
              <button
                type="button"
                className="bt-btn primary"
                onClick={() => void handleConnect()}
                disabled={busy || unsupported}
              >
                {state === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button
                type="button"
                className="bt-btn"
                onClick={() => void handleDisconnect()}
                disabled={busy}
              >
                Disconnect
              </button>
            )}
          </div>
        </section>

        <section className="bt-card">
          <div className="bt-card-head">
            <div className="bt-card-title">Message</div>
            <span className="bt-meta-label">{remaining} left</span>
          </div>
          <div className="bt-composer">
            <input
              type="text"
              className="bt-input"
              value={draft}
              maxLength={BT_MAX_MESSAGE_LENGTH}
              placeholder="Type a message for the OLED…"
              disabled={!connected || busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSend) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
            />
            <button
              type="button"
              className="bt-btn primary"
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              Send
            </button>
          </div>
        </section>

        <section className="bt-card bt-term-card">
          <div className="bt-card-head">
            <div className="bt-card-title">Live terminal</div>
            <button
              type="button"
              className="ghost sm"
              onClick={() => setEntries([])}
            >
              Clear
            </button>
          </div>
          <div className="bt-term" ref={termScrollRef}>
            {entries.length === 0 && <div className="bt-term-empty">No messages yet.</div>}
            {entries.map((e) => (
              <div key={e.id} className={`bt-term-line bt-${e.kind}`}>
                <span className="bt-term-time">{formatBtTime(e.ts)}</span>
                <span className="bt-term-text">{e.text}</span>
              </div>
            ))}
            <div ref={termEndRef} />
          </div>
        </section>

        {oledPreviewEnabled && (
          <section className="bt-card bt-oled-card">
            <div className="bt-card-head">
              <div className="bt-card-title">OLED Preview</div>
            </div>
            <OledPreview text={previewText} status={oledStatus(state, previewPhase)} />
          </section>
        )}
      </div>
    </div>
  )
}
