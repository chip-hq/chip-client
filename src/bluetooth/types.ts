/**
 * Bluetooth transport abstraction for Chip dashboard.
 * Classic SPP modules (e.g. HC-05/06 and similar) are not reachable via Web Bluetooth.
 */

import type { BtConnectResult } from './errors'

export type BtConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unsupported'

export type BtTransportKind = 'web-serial-spp' | 'unsupported'

export interface BtTerminalEntry {
  id: string
  ts: number
  kind: 'info' | 'tx' | 'rx' | 'error' | 'system'
  text: string
}

export interface BluetoothTransport {
  readonly kind: BtTransportKind
  readonly label: string
  /** Connect without throwing for expected failures — always leaves a usable state. */
  connect(): Promise<BtConnectResult>
  disconnect(): Promise<void>
  send(message: string): Promise<void>
  getState(): BtConnectionState
  getDeviceName(): string | null
  onMessage(callback: (line: string) => void): () => void
  onConnectionStateChange(callback: (state: BtConnectionState) => void): () => void
}

export const BT_MAX_MESSAGE_LENGTH = 120
export const BT_DEFAULT_BAUD = 9600
export const BT_DEVICE_LABEL = 'Bluetooth module'

export type { BtConnectResult, BtFailure, BtFailureCode } from './errors'
