import type { BluetoothTransport, BtConnectionState } from './types'
import type { BtConnectResult } from './errors'

/**
 * Fallback when Web Serial is unavailable.
 * Never reports a fake Connected state; connect always fails gracefully.
 */
export class UnsupportedBluetoothTransport implements BluetoothTransport {
  readonly kind = 'unsupported' as const
  readonly label = 'Unsupported'

  private readonly state: BtConnectionState = 'unsupported'

  getState(): BtConnectionState {
    return this.state
  }

  getDeviceName(): string | null {
    return null
  }

  onMessage(): () => void {
    return () => undefined
  }

  onConnectionStateChange(callback: (state: BtConnectionState) => void): () => void {
    callback(this.state)
    return () => undefined
  }

  async connect(): Promise<BtConnectResult> {
    return {
      ok: false,
      failure: {
        code: 'unsupported',
        message:
          'Classic Bluetooth SPP modules cannot be accessed directly from this browser. Use Chrome/Edge on desktop with an OS-paired serial port, or a native companion.',
        recoverable: false,
      },
    }
  }

  async disconnect(): Promise<void> {
    /* no-op */
  }

  async send(): Promise<void> {
    throw new Error('Bluetooth bridge is not available in this browser.')
  }
}
