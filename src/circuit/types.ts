/**
 * Chip Client — Circuit Data & Schema Types
 */

export interface CircuitPin {
  num: string
  name: string
  func?: string
  electricalType?: string
  shape?: string
  x?: number
  y?: number
  angle?: number
  length?: number
}

export interface CircuitComponent {
  ref: string
  name: string
  lib: string
  kind?: string
  renderer?: string
  value?: string
  footprint?: string
  pinCount?: number
  pins?: string[] | CircuitPin[]
  x?: number
  y?: number
  rotation?: 0 | 90 | 180 | 270
}

export interface CircuitConnection {
  net: string
  nodes: string[]
}

export interface CircuitDefinition {
  circuitName: string
  projectId: string
  version?: number
  generatedAt: string
  libraryPath?: string
  components: CircuitComponent[]
  connections: CircuitConnection[]
  ercErrors: string[]
  ercWarnings: string[]
  ercValid?: boolean
}

export interface CircuitManifest {
  projectId: string
  version: number
  generatedAt: string
  artifacts: {
    netlist?: string
    circuitDefinition?: string
    [key: string]: string | undefined
  }
  componentCount: number
  connectionCount: number
  ercErrorCount: number
  ercWarningCount: number
}

export interface CircuitVersionSummary {
  version: number
  versionTag: string
  isCurrent: boolean
  createdAt: string | null
  circuitName: string | null
  componentCount: number
  connectionCount: number
  ercErrorCount: number
  ercWarningCount: number
  artifacts: Record<string, string> | null
}

export interface ComponentSearchResult {
  library: string
  symbol: string
  identifier: string
  file: string
  displayName?: string
  referencePrefix?: string
  description?: string
  keywords?: string
  kind?: string
  renderer?: string
  pinCount?: number
  verificationStatus?: string
}

export interface ComponentDetails {
  success: boolean
  library: string
  part: string
  refPrefix?: string
  description?: string
  displayName?: string
  keywords?: string
  kind?: string
  renderer?: string
  footprint?: string
  footprintFilters?: string[]
  verification?: unknown
  pinCount: number
  pins: CircuitPin[]
  error?: string | null
}

export interface ComponentPosition {
  x: number
  y: number
  rotation?: number
}

export interface VisualLayout {
  projectId: string
  version?: number
  positions: Record<string, ComponentPosition>
  updatedAt: string
}
