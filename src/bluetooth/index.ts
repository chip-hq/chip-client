export type {
  BluetoothTransport,
  BtConnectionState,
  BtTerminalEntry,
  BtTransportKind,
  BtConnectResult,
  BtFailure,
  BtFailureCode,
} from './types'
export { BT_DEFAULT_BAUD, BT_DEVICE_LABEL, BT_MAX_MESSAGE_LENGTH } from './types'
export { createBluetoothTransport, isWebSerialSppAvailable } from './createTransport'
export { normalizeBtFailure } from './errors'
export {
  wrapOledText,
  sanitizeBtMessage,
  makeTerminalEntry,
  formatBtTime,
  OLED_COLS,
  OLED_ROWS,
} from './protocol'
