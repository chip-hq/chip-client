import { wrapOledText, OLED_COLS, OLED_ROWS } from '../../bluetooth'

interface OledPreviewProps {
  /** Exact text currently shown on the physical OLED (not connection status). */
  text: string
  status: 'Connected' | 'Waiting' | 'Message received' | 'Disconnected'
}

/** Simulated 128×64 SH1106 OLED — mirrors display content only, no blink/fade. */
export function OledPreview({ text, status }: OledPreviewProps) {
  const lines = wrapOledText(text, OLED_COLS, OLED_ROWS)

  return (
    <div className="bt-oled">
      <div className="bt-oled-bezel">
        <div className="bt-oled-screen" aria-label="SH1106 OLED preview">
          {Array.from({ length: OLED_ROWS }, (_, row) => (
            <div key={row} className="bt-oled-line">
              {(lines[row] ?? '').padEnd(OLED_COLS, ' ')}
            </div>
          ))}
        </div>
      </div>
      <div className="bt-oled-caption">
        <span>SH1106 128×64 · 0x3C</span>
        <span className="bt-oled-status">{status}</span>
      </div>
    </div>
  )
}
