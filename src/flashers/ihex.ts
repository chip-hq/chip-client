/**
 * Minimal Intel HEX parser for AVR flashing.
 * Produces a flat flash image (0xFF-filled) plus the address span that
 * actually contains data, so the STK500 writer only programs used pages.
 */

export interface HexImage {
  /** Full image, 0xFF-filled, length = flashSize. */
  data: Uint8Array
  flashSize: number
  /** Lowest / highest byte addresses holding real data. */
  dataStart: number
  dataEnd: number
}

export function parseIntelHex(text: string, flashSize = 32 * 1024): HexImage {
  const data = new Uint8Array(flashSize).fill(0xff)
  let base = 0
  let dataStart = flashSize
  let dataEnd = 0
  let records = 0

  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!line.startsWith(':')) throw new Error('Not Intel HEX (line must start with ":").')
    const bytes: number[] = []
    for (let i = 1; i < line.length; i += 2) {
      const b = parseInt(line.slice(i, i + 2), 16)
      if (Number.isNaN(b)) throw new Error('Corrupt Intel HEX line.')
      bytes.push(b)
    }
    if (bytes.length < 5) throw new Error('Truncated Intel HEX line.')
    const len = bytes[0]
    const addr = (bytes[1] << 8) | bytes[2]
    const type = bytes[3]
    const payload = bytes.slice(4, 4 + len)
    if (payload.length !== len) throw new Error('Truncated Intel HEX record.')

    // Checksum: sum of all bytes (incl. checksum) must be 0 mod 256.
    const sum = bytes.slice(0, 4 + len + 1).reduce((a, b) => a + b, 0)
    if ((sum & 0xff) !== 0) throw new Error('Intel HEX checksum mismatch - file is corrupt.')

    if (type === 0x00) {
      const abs = base + addr
      for (let i = 0; i < payload.length; i++) {
        const at = abs + i
        if (at < 0 || at >= flashSize) {
          throw new Error(`HEX data outside ${flashSize / 1024}KB flash (addr 0x${at.toString(16)}). Wrong board selected?`)
        }
        data[at] = payload[i]
      }
      if (payload.length > 0) {
        dataStart = Math.min(dataStart, abs)
        dataEnd = Math.max(dataEnd, abs + payload.length - 1)
      }
      records++
    } else if (type === 0x01) {
      break // end of file
    } else if (type === 0x04) {
      base = ((payload[0] << 8) | payload[1]) << 16
    } else if (type === 0x02 || type === 0x03 || type === 0x05) {
      // segment / start-address records - irrelevant for flat AVR flash
      continue
    } else {
      throw new Error(`Unsupported Intel HEX record type 0x${type.toString(16)}.`)
    }
  }

  if (records === 0) throw new Error('Intel HEX contains no data records.')
  return { data, flashSize, dataStart, dataEnd }
}

/** Split the used span into page-sized chunks, skipping all-0xFF pages. */
export function usedPages(image: HexImage, pageSize: number): Array<{ address: number; bytes: Uint8Array }> {
  const out: Array<{ address: number; bytes: Uint8Array }> = []
  const firstPage = Math.floor(image.dataStart / pageSize)
  const lastPage = Math.floor(image.dataEnd / pageSize)
  for (let p = firstPage; p <= lastPage; p++) {
    const address = p * pageSize
    const slice = image.data.slice(address, address + pageSize)
    if (slice.every((b) => b === 0xff)) continue
    out.push({ address, bytes: slice })
  }
  return out
}
