/**
 * Friendly Bluetooth bridge errors — never surface raw browser exceptions in the UI.
 */

export type BtFailureCode =
  | 'cancelled'
  | 'busy'
  | 'unsupported'
  | 'not_connected'
  | 'invalid_message'
  | 'failed'

export interface BtFailure {
  code: BtFailureCode
  message: string
  /** User can retry Connect without changing settings. */
  recoverable: boolean
}

export type BtConnectResult =
  | { ok: true }
  | { ok: false; failure: BtFailure }

export function normalizeBtFailure(err: unknown): BtFailure {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error')

  if (/No port selected|user cancelled|NotFoundError|canceled|cancelled/i.test(raw)) {
    return {
      code: 'cancelled',
      message: 'Connection cancelled. Pick a serial port when you are ready.',
      recoverable: true,
    }
  }

  if (/Failed to open serial port|NetworkError|InvalidStateError|port.*open|Access denied|busy/i.test(raw)) {
    return {
      code: 'busy',
      message:
        'That COM port is still locked. Wait ~2 seconds and Try again, or unplug and replug the USB/Bluetooth connection, then Connect.',
      recoverable: true,
    }
  }

  if (/Classic SPP|cannot access it directly|Unsupported|serial.*not/i.test(raw)) {
    return {
      code: 'unsupported',
      message: raw,
      recoverable: false,
    }
  }

  if (/not connected|bridge is not connected/i.test(raw)) {
    return {
      code: 'not_connected',
      message: 'Not connected. Connect a Bluetooth serial port first, then send.',
      recoverable: true,
    }
  }

  if (/empty|too long|invalid control/i.test(raw)) {
    return {
      code: 'invalid_message',
      message: raw,
      recoverable: true,
    }
  }

  // Strip cryptic browser prefixes when possible
  const cleaned = raw
    .replace(/^Failed to execute '[^']+' on '[^']+':\s*/i, '')
    .replace(/^DOMException:\s*/i, '')
    .trim()

  return {
    code: 'failed',
    message: cleaned || 'Something went wrong with the Bluetooth bridge. Try Connect again.',
    recoverable: true,
  }
}
