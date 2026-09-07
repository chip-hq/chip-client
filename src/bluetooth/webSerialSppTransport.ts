import type { BluetoothTransport, BtConnectionState } from './types'
import type { BtConnectResult } from './errors'
import { normalizeBtFailure } from './errors'
import { BT_DEFAULT_BAUD, BT_DEVICE_LABEL, BT_MAX_MESSAGE_LENGTH } from './types'

type MessageCb = (line: string) => void
type StateCb = (state: BtConnectionState) => void

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const OPEN_OPTIONS: SerialOptions = {
  baudRate: BT_DEFAULT_BAUD,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
  bufferSize: 255,
}

/**
 * Bridge for Classic Bluetooth SPP modules via the OS COM/serial port.
 * Failures always leave the transport disconnected and retryable.
 */
export class WebSerialSppTransport implements BluetoothTransport {
  readonly kind = 'web-serial-spp' as const
  readonly label = 'Web Serial (OS-paired SPP)'

  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoopActive = false
  private readLoopPromise: Promise<void> | null = null
  private state: BtConnectionState = 'disconnected'
  private deviceName: string | null = null
  private rxBuffer = ''
  private readonly messageListeners = new Set<MessageCb>()
  private readonly stateListeners = new Set<StateCb>()

  getState(): BtConnectionState {
    return this.state
  }

  getDeviceName(): string | null {
    return this.deviceName
  }

  onMessage(callback: MessageCb): () => void {
    this.messageListeners.add(callback)
    return () => this.messageListeners.delete(callback)
  }

  onConnectionStateChange(callback: StateCb): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  async connect(): Promise<BtConnectResult> {
    if (!('serial' in navigator)) {
      this.setState('unsupported')
      return {
        ok: false,
        failure: {
          code: 'unsupported',
          message:
            'Classic Bluetooth SPP is not available in this browser. Use Chrome/Edge on desktop with an OS-paired serial port.',
          recoverable: false,
        },
      }
    }

    if (this.state === 'connecting') {
      return {
        ok: false,
        failure: {
          code: 'busy',
          message: 'Still connecting… please wait a second.',
          recoverable: true,
        },
      }
    }

    this.setState('connecting')

    try {
      // Drop our session cleanly before connecting.
      await this.cleanup()
      await sleep(150)

      let port: SerialPort
      try {
        port = await navigator.serial.requestPort({})
      } catch (err) {
        this.setState('disconnected')
        return { ok: false, failure: normalizeBtFailure(err) }
      }

      // If this port was left open by this transport, close it before reopening.
      await this.safeClosePort(port)

      const delays = [0, 600, 1400]
      let lastFailure: BtConnectResult | null = null

      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) await sleep(delays[i])
        await this.safeClosePort(port)
        const result = await this.openPort(port)
        if (result.ok) return result
        lastFailure = result
        if (result.failure.code !== 'busy') break
      }

      this.setState('disconnected')
      return (
        lastFailure ?? {
          ok: false,
          failure: {
            code: 'busy',
            message:
              'Serial port is still locked by Windows. Click Try again in a couple seconds, or unplug/replug the Bluetooth link in OS settings.',
            recoverable: true,
          },
        }
      )
    } catch (err) {
      await this.cleanup()
      this.setState('disconnected')
      return { ok: false, failure: normalizeBtFailure(err) }
    }
  }

  private async safeClosePort(port: SerialPort): Promise<void> {
    try {
      // Port already closed — readable/writable are null.
      if (!port.readable && !port.writable) return
      try {
        await port.readable?.cancel()
      } catch {
        /* ignore */
      }
      try {
        await port.writable?.abort()
      } catch {
        /* ignore */
      }
      await port.close()
    } catch {
      /* ignore — may already be closed or held elsewhere */
    }
  }

  private async openPort(port: SerialPort): Promise<BtConnectResult> {
    try {
      await port.open(OPEN_OPTIONS)
      this.port = port
      this.deviceName = BT_DEVICE_LABEL
      if (port.writable) this.writer = port.writable.getWriter()
      this.readLoopActive = true
      this.readLoopPromise = this.startReadLoop()
      this.setState('connected')

      port.addEventListener('disconnect', () => {
        void this.handleUnexpectedDisconnect()
      })

      return { ok: true }
    } catch (err) {
      await this.safeClosePort(port)
      await this.cleanup()
      return { ok: false, failure: normalizeBtFailure(err) }
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.cleanup()
    } finally {
      this.setState('disconnected')
    }
  }

  async send(message: string): Promise<void> {
    if (this.state !== 'connected' || !this.writer) {
      throw new Error('Bluetooth bridge is not connected.')
    }
    const trimmed = message.trim()
    if (!trimmed) throw new Error('Message is empty.')
    if (trimmed.length > BT_MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long (max ${BT_MAX_MESSAGE_LENGTH} characters).`)
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) {
      throw new Error('Message contains invalid control characters.')
    }

    try {
      const payload = `${trimmed}\r\n`
      const bytes = new TextEncoder().encode(payload)
      await this.writer.write(bytes)
    } catch (err) {
      await this.cleanup()
      this.setState('disconnected')
      throw new Error(
        normalizeBtFailure(err).message || 'Send failed because the Bluetooth link dropped.',
      )
    }
  }

  private async startReadLoop(): Promise<void> {
    if (!this.port?.readable) return
    const decoder = new TextDecoder()
    try {
      this.reader = this.port.readable.getReader()
      while (this.readLoopActive && this.reader) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (!value) continue
        this.rxBuffer += decoder.decode(value, { stream: true })
        let idx = this.rxBuffer.indexOf('\n')
        while (idx !== -1) {
          const line = this.rxBuffer.slice(0, idx).replace(/\r$/, '').trim()
          this.rxBuffer = this.rxBuffer.slice(idx + 1)
          if (line) {
            for (const cb of this.messageListeners) cb(line)
          }
          idx = this.rxBuffer.indexOf('\n')
        }
      }
    } catch {
      /* port closed */
    } finally {
      try {
        this.reader?.releaseLock()
      } catch {
        /* ignore */
      }
      this.reader = null
      if (this.readLoopActive && this.state === 'connected') {
        void this.handleUnexpectedDisconnect()
      }
    }
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    await this.cleanup()
    this.setState('disconnected')
  }

  private async cleanup(): Promise<void> {
    this.readLoopActive = false

    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock()
    } catch {
      /* ignore */
    }
    this.reader = null

    if (this.readLoopPromise) {
      try {
        await Promise.race([this.readLoopPromise, sleep(400)])
      } catch {
        /* ignore */
      }
      this.readLoopPromise = null
    }

    try {
      this.writer?.releaseLock()
    } catch {
      /* ignore */
    }
    this.writer = null

    if (this.port) {
      await this.safeClosePort(this.port)
    }
    this.port = null
    this.deviceName = null
    this.rxBuffer = ''
  }

  private setState(next: BtConnectionState): void {
    if (this.state === next) return
    this.state = next
    for (const cb of this.stateListeners) cb(next)
  }
}
