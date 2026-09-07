import type { BtTerminalEntry } from './types'
import { BT_MAX_MESSAGE_LENGTH } from './types'

/** Word-wrap for SH1106 128×64 at ~21 chars/line (Adafruit GFX size 1). */
export const OLED_COLS = 21
export const OLED_ROWS = 8

export function wrapOledText(text: string, cols = OLED_COLS, rows = OLED_ROWS): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    if (lines.length >= rows) break
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }

    let current = ''
    for (const word of words) {
      if (lines.length >= rows) break
      if (word.length > cols) {
        if (current) {
          lines.push(current)
          current = ''
          if (lines.length >= rows) break
        }
        for (let i = 0; i < word.length && lines.length < rows; i += cols) {
          lines.push(word.slice(i, i + cols))
        }
        continue
      }
      const next = current ? `${current} ${word}` : word
      if (next.length <= cols) {
        current = next
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current && lines.length < rows) lines.push(current)
  }

  return lines.slice(0, rows)
}

export function sanitizeBtMessage(raw: string): string {
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, BT_MAX_MESSAGE_LENGTH)
}

export function makeTerminalEntry(
  kind: BtTerminalEntry['kind'],
  text: string,
): BtTerminalEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    kind,
    text,
  }
}

export function formatBtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
