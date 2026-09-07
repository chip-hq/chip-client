import type { BluetoothTransport } from './types'
import { UnsupportedBluetoothTransport } from './unsupportedTransport'
import { WebSerialSppTransport } from './webSerialSppTransport'

/** Factory — picks the best available Classic SPP bridge for this environment. */
export function createBluetoothTransport(): BluetoothTransport {
  if (typeof navigator !== 'undefined' && 'serial' in navigator) {
    return new WebSerialSppTransport()
  }
  return new UnsupportedBluetoothTransport()
}

export function isWebSerialSppAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}
