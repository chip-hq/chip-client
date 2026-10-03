/**
 * chip-stk500 - Arduino AVR flashing package (STK500v1 over Web Serial).
 *
 * This is the Arduino family's answer to esptool: it speaks the optiboot
 * bootloader that ships on Uno / Nano (ATmega328P) and writes the Intel HEX
 * that PlatformIO produces. No native app, no avrdude install - the browser
 * holds the USB port, pulses DTR to reset into the bootloader, and programs
 * page by page with progress.
 *
 * Scope: ATmega328P @ STK500v1 (Uno, Nano, Nano-old-bootloader). Mega2560
 * speaks STK500v2 and is intentionally not attempted here.
 */

import { parseIntelHex, usedPages } from './ihex'

const GET_SYNC = 0x30
const GET_PARAMETER = 0x41
const ENTER_PROGMODE = 0x50
const LEAVE_PROGMODE = 0x51
const LOAD_ADDRESS = 0x55
const PROG_PAGE = 0x64
const INSYNC = 0x14
const OK = 0x10
const EOP = 0x20

export interface AvrBoardSpec {
  slug: string
  label: string
  mcu: string
  flashSize: number
  pageSize: number
  baud: number
}

export const AVR_BOARDS: Record<string, AvrBoardSpec> = {
  uno: { slug: 'uno', label: 'Arduino Uno', mcu: 'atmega328p', flashSize: 32 * 1024, pageSize: 128, baud: 115200 },
  nano: { slug: 'nano', label: 'Arduino Nano', mcu: 'atmega328p', flashSize: 32 * 1024, pageSize: 128, baud: 115200 },
  'nano-old': { slug: 'nano-old', label: 'Arduino Nano (old bootloader)', mcu: 'atmega328p', flashSize: 32 * 1024, pageSize: 128, baud: 57600 },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function closeQuiet(port: SerialPort) {
  try {
    await port.close()
  } catch {
    // already closed / never opened
  }
  await sleep(120)
}

class SerialIO {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private buf: number[] = []

  constructor(private port: SerialPort) {}

  async open(baudRate: number) {
    await closeQuiet(this.port)
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' })
    // DTR falling edge resets AVR boards into the bootloader (auto-reset
    // capacitor). Then wait for optiboot's ~1s window.
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false })
    } catch {
      // some adapters ignore signals - bootloader may already be listening
    }
    await sleep(120)
    try {
      await this.port.setSignals({ dataTerminalReady: true })
    } catch {
      // ignore
    }
    await sleep(700)
    this.reader = this.port.readable!.getReader()
    await this.drain()
  }

  async drain() {
    if (!this.reader) return
    for (let i = 0; i < 20; i++) {
      const r = await Promise.race([
        this.reader.read(),
        sleep(15).then(() => null),
      ]) as ReadableStreamReadResult<Uint8Array> | null
      if (!r || r.done || !r.value || r.value.length === 0) break
    }
  }

  async write(bytes: number[]) {
    const w = this.port.writable!.getWriter()
    try {
      await w.write(new Uint8Array(bytes))
    } finally {
      w.releaseLock()
    }
  }

  private async fill(n: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.buf.length < n) {
      const left = deadline - Date.now()
      if (left <= 0) return false
      const r = await Promise.race([
        this.reader!.read(),
        sleep(left).then(() => null),
      ]) as ReadableStreamReadResult<Uint8Array> | null
      if (!r) return false
      if (r.done) return false
      if (r.value) for (const b of r.value) this.buf.push(b)
    }
    return true
  }

  async readExact(n: number, timeoutMs = 1500): Promise<number[]> {
    const ok = await this.fill(n, timeoutMs)
    if (!ok) throw new Error('STK500 timeout - board did not answer. Wrong board selected, or it is not in bootloader mode (press Reset and retry).')
    return this.buf.splice(0, n)
  }

  async command(bytes: number[], expectLen = 2, timeoutMs = 1500): Promise<number[]> {
    await this.write([...bytes, EOP])
    const resp = await this.readExact(expectLen, timeoutMs)
    if (resp[0] !== INSYNC) {
      throw new Error(`STK500 out of sync (0x${resp[0].toString(16)}). Retry the flash.`)
    }
    if (resp[expectLen - 1] !== OK) {
      throw new Error(`STK500 command failed (0x${resp[expectLen - 1].toString(16)}).`)
    }
    return resp
  }

  async close() {
    try {
      this.reader?.releaseLock()
    } catch {
      // ignore
    }
    this.reader = null
    await closeQuiet(this.port)
  }
}

async function getSync(io: SerialIO) {
  await io.command([GET_SYNC])
}

/** Reset the board and check for an STK500v1 bootloader. Never throws. */
export async function probeAvr(port: SerialPort, baud: number): Promise<boolean> {
  const io = new SerialIO(port)
  try {
    await io.open(baud)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await getSync(io)
        // Confirm it really is STK500 (read a parameter byte).
        await io.command([GET_PARAMETER, 0x81], 3)
        return true
      } catch {
        await sleep(250)
      }
    }
    return false
  } catch {
    return false
  } finally {
    await io.close()
  }
}

export function explainAvrError(msg: string): string {
  if (/timeout|did not answer/i.test(msg)) {
    return `${msg} - the Arduino did not enter its bootloader. Check the USB cable (charge-only cables fail here), select the right board (Uno vs Nano old-bootloader), and retry.`
  }
  if (/outside .* flash|Wrong board/i.test(msg)) {
    return `${msg} - this HEX was built for a different board. Compile again with the matching board slug.`
  }
  return msg
}

/**
 * Flash an Intel HEX file to an Uno/Nano over the given (closed) port.
 * Opens the port, resets into the bootloader, programs used pages only,
 * leaves programming mode, and closes the port on the way out.
 */
export async function flashAvr(
  port: SerialPort,
  hexText: string,
  boardSlug: string,
  onProgress: (written: number, total: number) => void,
  log: (line: string) => void = () => {},
): Promise<void> {
  const spec = AVR_BOARDS[boardSlug] ?? AVR_BOARDS.uno
  const image = parseIntelHex(hexText, spec.flashSize)
  const pages = usedPages(image, spec.pageSize)
  const total = pages.reduce((a, p) => a + p.bytes.length, 0)
  log(`[AVR] ${spec.label}: ${pages.length} pages, ${(total / 1024).toFixed(1)}KB of HEX`)

  const io = new SerialIO(port)
  try {
    await io.open(spec.baud)
    log('[AVR] Reset into bootloader…')
    await getSync(io)
    await io.command([ENTER_PROGMODE])
    log('[AVR] Programming…')

    let written = 0
    for (const page of pages) {
      const wordAddr = page.address / 2
      await io.command([LOAD_ADDRESS, wordAddr & 0xff, (wordAddr >> 8) & 0xff])
      const len = page.bytes.length
      await io.command([PROG_PAGE, (len >> 8) & 0xff, len & 0xff, 0x46, ...Array.from(page.bytes)])
      written += len
      onProgress(written, total)
    }

    await io.command([LEAVE_PROGMODE])
    onProgress(total, total)
    log('[AVR] Done - board reboots into the new sketch.')
  } catch (e) {
    throw new Error(explainAvrError(e instanceof Error ? e.message : String(e)))
  } finally {
    await io.close()
  }
}
