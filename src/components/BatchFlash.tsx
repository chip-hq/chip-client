/**
 * BatchFlash - flash many boards over USB concurrently.
 * Each board gets its own WebSerial port + esptool-js session; all run in
 * parallel with independent progress. One binary goes to every board
 * (grouped by detected chip so mismatches are visible before you start).
 */
import { useState, useRef, useEffect } from 'react'
import { ESPLoader, Transport } from 'esptool-js'

interface BatchFlashProps {
  baud: number
  file: { name: string; size: number; data: Uint8Array } | null
  offset: string
  eraseAll: boolean
  showAlert: (type: 'success' | 'error' | 'info', message: string, title?: string) => void
}

interface BatchBoard {
  key: string
  port: SerialPort
  label: string
  chip: string | null
  status: 'ready' | 'flashing' | 'done' | 'error'
  progress: number
  error?: string
}

const WEB_SERIAL_OK = typeof navigator !== 'undefined' && 'serial' in navigator

function parseOffset(raw: string): number {
  const clean = raw.trim()
  return clean.startsWith('0x') || clean.startsWith('0X') ? parseInt(clean, 16) : parseInt(clean, 10)
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}

function explainFlashError(msg: string): string {
  if (/failed to connect|timed out|no serial data|invalid head of packet/i.test(msg)) {
    return `${msg} - board is not in flash mode. Hold BOOT, tap EN, release BOOT, and retry. Unpowered hubs cause this too.`
  }
  if (/brownout|brown-out/i.test(msg)) {
    return `${msg} - USB brownout. Use a POWERED hub or shorter cable; too many boards on one unpowered hub browns out.`
  }
  if (/wrong|chip mismatch|unexpected chip|not an ESP32/i.test(msg)) {
    return `${msg} - binary/chip mismatch. Group boards by chip and flash each group with its own build.`
  }
  if (/No port selected|port.*(closed|removed)|device has been lost/i.test(msg)) {
    return `${msg} - cable unplugged or port released. Re-add the board.`
  }
  return msg
}

const quietTerminal = { clean: () => {}, writeLine: () => {}, write: () => {} }

export function BatchFlash({ baud, file, offset, eraseAll, showAlert }: BatchFlashProps) {
  const [boards, setBoards] = useState<BatchBoard[]>([])
  const [busy, setBusy] = useState(false)
  const boardsRef = useRef<BatchBoard[]>([])
  useEffect(() => { boardsRef.current = boards }, [boards])

  if (!WEB_SERIAL_OK) {
    return <p className="hint">Batch USB flashing needs Web Serial (Chrome/Edge desktop).</p>
  }

  const patchBoard = (key: string, patch: Partial<BatchBoard>) => {
    setBoards((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)))
  }

  const addBoard = async () => {
    try {
      const port = await navigator.serial.requestPort({})
      const key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const label = `Board ${boardsRef.current.length + 1}`
      setBoards((prev) => [...prev, { key, port, label, chip: null, status: 'flashing', progress: 0 }])
      // Quick chip detect so boards can be grouped before flashing.
      try {
        const transport = new Transport(port)
        const loader = new ESPLoader({ transport, baudrate: baud, terminal: quietTerminal })
        const chip = await loader.main()
        try { await transport.disconnect() } catch { /* ignore */ }
        patchBoard(key, { chip: String(chip), status: 'ready' })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        patchBoard(key, { chip: 'unknown', status: 'ready', error: `Detect: ${explainFlashError(msg)}` })
      }
    } catch (e) {
      if (!/No port selected/i.test(e instanceof Error ? e.message : String(e))) {
        showAlert('error', e instanceof Error ? e.message : String(e), 'Add Board')
      }
    }
  }

  const removeBoard = (key: string) => {
    const board = boardsRef.current.find((b) => b.key === key)
    if (board?.status === 'flashing') return
    setBoards((prev) => prev.filter((b) => b.key !== key))
  }

  const flashOne = async (board: BatchBoard, data: Uint8Array, offsetNum: number) => {
    patchBoard(board.key, { status: 'flashing', progress: 0, error: undefined })
    try {
      const transport = new Transport(board.port)
      const loader = new ESPLoader({ transport, baudrate: baud, terminal: quietTerminal })
      const chip = await loader.main()
      patchBoard(board.key, { chip: String(chip) })
      await loader.writeFlash({
        fileArray: [{ data, address: offsetNum }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll,
        compress: true,
        reportProgress: (_i: number, written: number, total: number) => {
          patchBoard(board.key, { progress: Math.round((written / total) * 100) })
        },
      })
      try {
        await loader.after('hard_reset')
      } catch { /* board may already be rebooting */ }
      patchBoard(board.key, { status: 'done', progress: 100 })
    } catch (e) {
      patchBoard(board.key, { status: 'error', error: explainFlashError(e instanceof Error ? e.message : String(e)) })
    }
  }

  const flashAll = async () => {
    if (!file || busy) return
    const targets = boardsRef.current.filter((b) => b.status === 'ready' || b.status === 'error')
    if (targets.length === 0) {
      showAlert('info', 'Add at least one board first.', 'Batch Flash')
      return
    }
    setBusy(true)
    const offsetNum = parseOffset(offset)
    showAlert('info', `Flashing ${file.name} (${formatBytes(file.size)}) to ${targets.length} board(s) in parallel…`, 'Batch Flash')
    await Promise.allSettled(targets.map((b) => flashOne(b, file.data, offsetNum)))
    const done = boardsRef.current.filter((b) => b.status === 'done').length
    const failed = boardsRef.current.filter((b) => b.status === 'error').length
    showAlert(failed === 0 ? 'success' : 'error', `Batch finished: ${done} ok, ${failed} failed.`, 'Batch Flash')
    setBusy(false)
  }

  const chips = [...new Set(boards.map((b) => b.chip).filter(Boolean))]
  const mixed = chips.length > 1

  return (
    <div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <button type="button" className="ghost" onClick={() => void addBoard()} disabled={busy}>+ Add board</button>
        <button
          type="button"
          className="h-8 px-4 bg-black hover:bg-[#222222] text-white text-xs font-medium rounded transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          onClick={() => void flashAll()}
          disabled={busy || !file || boards.length === 0}
        >
          {busy ? 'Flashing all…' : `Flash all (${boards.length})`}
        </button>
        {boards.some((b) => b.status === 'done' || b.status === 'error') && !busy && (
          <button type="button" className="ghost sm" onClick={() => setBoards((prev) => prev.filter((b) => b.status !== 'done' && b.status !== 'error'))}>
            Clear finished
          </button>
        )}
        {!file && <span className="hint" style={{ margin: 0 }}>Pick a .bin above first.</span>}
      </div>
      {mixed && (
        <p className="hint" style={{ color: '#b45309' }}>
          Mixed chips detected ({chips.join(', ')}) sharing one binary - flash each chip group with its matching build.
        </p>
      )}
      {boards.length === 0 && (
        <p className="hint">Each click grants one more USB port. Use a powered hub past 3–4 boards.</p>
      )}
      {boards.map((b) => (
        <div key={b.key} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
          <div className="flex items-center gap-2">
            <strong className="text-[13px]">{b.label}</strong>
            <span className="pill">{b.chip ?? 'detecting…'}</span>
            <span className={`pill ${b.status === 'done' ? 'on' : ''}`}>
              {b.status === 'ready' ? 'ready' : b.status === 'flashing' ? `flashing ${b.progress}%` : b.status}
            </span>
            {b.status !== 'flashing' && (
              <button type="button" className="ghost sm" onClick={() => removeBoard(b.key)}>Remove</button>
            )}
          </div>
          {(b.status === 'flashing' || b.status === 'done') && (
            <div className="progress"><div className="bar" style={{ width: `${b.progress}%` }} /></div>
          )}
          {b.error && <p className="hint" style={{ color: '#dc2626' }}>{b.error}</p>}
        </div>
      ))}
    </div>
  )
}
