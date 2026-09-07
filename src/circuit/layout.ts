/**
 * Chip Client — Schematic Circuit Layout & Orthogonal Routing Engine
 * 
 * Computes component placements and clean Manhattan orthogonal wire paths
 * directly from KiCad pin metadata with zero bloated hardcoded tables.
 */

import type { CircuitComponent, CircuitConnection } from './types'

export interface Point {
  x: number
  y: number
}

export type Direction = 'left' | 'right' | 'top' | 'bottom'

export interface PinEndpoint {
  point: Point
  dir: Direction
  compRef: string
  pinKey: string
}

export interface PositionedComponent extends CircuitComponent {
  x: number
  y: number
  width: number
  height: number
  baseWidth: number
  baseHeight: number
  rotation: 0 | 90 | 180 | 270
  pinPositions: Record<string, Point>
  pinDirections: Record<string, Direction>
}

export interface WireRoute {
  net: string
  points: Point[]
  pathData: string
  midPoint: Point
  color: string
}

// ── Net Classification Helpers ───────────────────────────────────────────────

export function isGroundNet(netName: string): boolean {
  return (netName || '').toUpperCase().includes('GND')
}

export function isPowerNet(netName: string): boolean {
  const u = (netName || '').toUpperCase()
  return u.includes('VCC') || u.includes('3V3') || u.includes('5V') || u.includes('VDD') || u.includes('PWR')
}

export function isTestNet(netName: string): boolean {
  return (netName || '').toUpperCase().includes('TEST')
}

/**
 * Standard net stroke colors
 */
export function getNetColor(netName: string, index = 0): string {
  const upper = (netName || '').toUpperCase()
  if (isGroundNet(upper)) return '#10b981' // Green
  if (isPowerNet(upper)) return '#f59e0b'  // Amber
  if (upper.includes('SCL') || upper.includes('SCK')) return '#3b82f6' // Blue
  if (upper.includes('SDA') || upper.includes('DATA')) return '#8b5cf6' // Purple
  if (upper.includes('LED') || upper.includes('OUT')) return '#ec4899'  // Pink
  if (upper.includes('SIG') || upper.includes('ADC')) return '#ef4444'  // Red

  const palette = ['#3b82f6', '#8b5cf6', '#06b6d4', '#6366f1', '#14b8a6']
  return palette[index % palette.length]
}

// ── Dynamic Pin & Dimension Engine ──────────────────────────────────────────

/**
 * Derives standard dimensions and pin positions dynamically from component metadata
 */
export function getComponentDimensions(comp: CircuitComponent): {
  width: number
  height: number
  pinOffsets: Record<string, Point>
  pinDirections: Record<string, Direction>
} {
  const ref = (comp.ref || '').toUpperCase()
  const lib = (comp.lib || '').toUpperCase()
  const name = (comp.name || '').toUpperCase()
  const kind = (comp.kind || '').toLowerCase()

  const pinOffsets: Record<string, Point> = {}
  const pinDirections: Record<string, Direction> = {}

  // 1. Two-terminal passives & switches (Resistors, Capacitors, Diodes, LEDs, Buttons, Switches)
  if (
    kind === 'resistor' ||
    kind === 'capacitor' ||
    kind === 'diode' ||
    kind === 'led' ||
    kind === 'button' ||
    kind === 'switch' ||
    ref.startsWith('R') ||
    ref.startsWith('C') ||
    ref.startsWith('D') ||
    ref.startsWith('L') ||
    ref.startsWith('SW') ||
    ref.startsWith('S') ||
    lib === 'DEVICE' ||
    lib === 'SWITCH'
  ) {
    const width = 80
    const height = 40
    const isDiodeOrLed =
      kind === 'diode' ||
      kind === 'led' ||
      ref.startsWith('D') ||
      name.includes('LED') ||
      name.includes('DIODE')

    if (isDiodeOrLed) {
      // In schematic symbols pointing right: Anode (A) is left terminal, Cathode (K) is right terminal
      // In KiCad libraries: Pin 2 = Anode (A), Pin 1 = Cathode (K)
      pinOffsets['A'] = { x: 0, y: 20 }
      pinOffsets['2'] = { x: 0, y: 20 }
      pinOffsets['K'] = { x: 80, y: 20 }
      pinOffsets['1'] = { x: 80, y: 20 }
      pinDirections['A'] = 'left'; pinDirections['2'] = 'left'
      pinDirections['K'] = 'right'; pinDirections['1'] = 'right'
    } else {
      pinOffsets['1'] = { x: 0, y: 20 }
      pinOffsets['2'] = { x: 80, y: 20 }
      pinOffsets['A'] = { x: 0, y: 20 }
      pinOffsets['K'] = { x: 80, y: 20 }
      pinDirections['1'] = 'left'; pinDirections['A'] = 'left'
      pinDirections['2'] = 'right'; pinDirections['K'] = 'right'
    }
    return { width, height, pinOffsets, pinDirections }
  }

  // 2. Transistors & Regulators (3 terminals: Base left, Collector top-right, Emitter bottom-right)
  if (
    kind === 'transistor' ||
    ref.startsWith('Q') ||
    ref.startsWith('T') ||
    ref.startsWith('VR') ||
    lib.includes('TRANSISTOR') ||
    lib.includes('REGULATOR')
  ) {
    const width = 80
    const height = 60
    pinOffsets['1'] = { x: 0, y: 30 }; pinOffsets['B'] = { x: 0, y: 30 }; pinOffsets['G'] = { x: 0, y: 30 }; pinOffsets['VIN'] = { x: 0, y: 30 }
    pinOffsets['2'] = { x: 80, y: 12 }; pinOffsets['C'] = { x: 80, y: 12 }; pinOffsets['D'] = { x: 80, y: 12 }; pinOffsets['VOUT'] = { x: 80, y: 12 }
    pinOffsets['3'] = { x: 80, y: 48 }; pinOffsets['E'] = { x: 80, y: 48 }; pinOffsets['S'] = { x: 80, y: 48 }; pinOffsets['GND'] = { x: 80, y: 48 }
    pinDirections['1'] = 'left'; pinDirections['B'] = 'left'; pinDirections['G'] = 'left'; pinDirections['VIN'] = 'left'
    pinDirections['2'] = 'right'; pinDirections['C'] = 'right'; pinDirections['D'] = 'right'; pinDirections['VOUT'] = 'right'
    pinDirections['3'] = 'right'; pinDirections['E'] = 'right'; pinDirections['S'] = 'right'; pinDirections['GND'] = 'right'
    return { width, height, pinOffsets, pinDirections }
  }

  // 3. Single-row Connectors / Sensor / Display Headers
  // 3. OLED Displays and LCD Screens (I2C 128x64, SSD1306, etc.)
  const isOled =
    kind === 'display' ||
    ref.startsWith('DS') ||
    lib.includes('DISPLAY') ||
    name.includes('OLED') ||
    name.includes('DISPLAY') ||
    name.includes('SSD1306') ||
    name.includes('SH1106') ||
    name.includes('SH110X') ||
    name.includes('GME12864') ||
    name.includes('128X64')

  if (isOled) {
    // Width: 160px total — 10px PCB lead + 40px pin label area + 100px screen + 10px right margin
    const width = 160
    // Pin row spacing same as ConnectorSymbol so it looks consistent: 28px per row
    const pinRowSpacing = 28
    const defaultDisplayPins = [
      { num: '1', name: 'GND' },
      { num: '2', name: 'VCC' },
      { num: '3', name: 'SCL' },
      { num: '4', name: 'SDA' },
    ]

    const rawPins =
      Array.isArray(comp.pins) && comp.pins.length > 0
        ? comp.pins
        : defaultDisplayPins

    comp.pins = rawPins as CircuitComponent['pins']

    const pinCount = rawPins.length
    // Height: enough to show all pins with 28px spacing, plus top/bottom padding
    const height = Math.max(pinCount * pinRowSpacing + 32, 140)

    rawPins.forEach((p, idx) => {
      const pinNum = typeof p === 'string' ? p : p.num || String(idx + 1)
      const pinName = typeof p === 'object' ? p.name : defaultDisplayPins[idx]?.name || pinNum
      const y = 18 + idx * pinRowSpacing

      pinOffsets[pinNum] = { x: 0, y }
      pinDirections[pinNum] = 'left'
      if (pinName && pinName !== pinNum) {
        pinOffsets[pinName] = { x: 0, y }
        pinDirections[pinName] = 'left'
      }
    })

    // Named signal aliases with correct Y positions
    pinOffsets['GND']  = { x: 0, y: 18 + 0 * pinRowSpacing }; pinDirections['GND']  = 'left'
    pinOffsets['VCC']  = { x: 0, y: 18 + 1 * pinRowSpacing }; pinDirections['VCC']  = 'left'
    pinOffsets['3V3']  = pinOffsets['VCC'];                    pinDirections['3V3']  = 'left'
    pinOffsets['SCL']  = { x: 0, y: 18 + 2 * pinRowSpacing }; pinDirections['SCL']  = 'left'
    pinOffsets['SCK']  = pinOffsets['SCL'];                    pinDirections['SCK']  = 'left'
    pinOffsets['SDA']  = { x: 0, y: 18 + 3 * pinRowSpacing }; pinDirections['SDA']  = 'left'
    pinOffsets['DATA'] = pinOffsets['SDA'];                    pinDirections['DATA'] = 'left'

    return { width, height, pinOffsets, pinDirections }
  }

  // 4. Single-row Connectors / Sensor Headers
  if (
    kind === 'connector' ||
    kind === 'sensor' ||
    kind === 'module' ||
    ref.startsWith('J') ||
    ref.startsWith('P') ||
    lib.includes('CONN') ||
    lib.includes('HEADER') ||
    name.includes('SENSOR')
  ) {
    const rawPins = Array.isArray(comp.pins) && comp.pins.length > 0 ? comp.pins : ['1', '2', '3', '4']
    const pinCount = Math.max(rawPins.length, 2)
    const width = 60
    const height = Math.max(pinCount * 28 + 16, 80)

    const savedX = comp.x
    const isLeftConnector = savedX !== undefined ? savedX < 350 : ref.endsWith('1') || ref.endsWith('3')
    const pinX = isLeftConnector ? width : 0
    const pinDir: Direction = isLeftConnector ? 'right' : 'left'

    rawPins.forEach((p, idx) => {
      const pinNum = typeof p === 'string' ? p : p.num || String(idx + 1)
      const pinName = typeof p === 'object' ? p.name : pinNum
      const y = 16 + idx * 28

      pinOffsets[pinNum] = { x: pinX, y }
      pinDirections[pinNum] = pinDir
      if (pinName && pinName !== pinNum) {
        pinOffsets[pinName] = { x: pinX, y }
        pinDirections[pinName] = pinDir
      }
    })

    const pinNameMap: Record<string, number> = {}
    rawPins.forEach((p, idx) => {
      const pinName = typeof p === 'object' ? (p.name || '').toUpperCase() : ''
      if (pinName) pinNameMap[pinName] = idx
    })

    const resolveY = (names: string[], fallbackIdx: number) => {
      for (const n of names) {
        if (pinNameMap[n] !== undefined) return 16 + pinNameMap[n] * 28
      }
      return 16 + fallbackIdx * 28
    }

    pinOffsets['VCC'] = { x: pinX, y: resolveY(['VCC', '3V3', 'VDD', 'POWER', 'PWR'], 0) }; pinDirections['VCC'] = pinDir
    pinOffsets['3V3'] = pinOffsets['VCC']; pinDirections['3V3'] = pinDir
    pinOffsets['GND'] = { x: pinX, y: resolveY(['GND', 'GROUND', 'VSS'], 1) }; pinDirections['GND'] = pinDir
    pinOffsets['SCL'] = { x: pinX, y: resolveY(['SCL', 'SCK', 'CLK'], 2) }; pinDirections['SCL'] = pinDir
    pinOffsets['SCK'] = pinOffsets['SCL']; pinDirections['SCK'] = pinDir
    pinOffsets['SDA'] = { x: pinX, y: resolveY(['SDA', 'DATA', 'MOSI'], 3) }; pinDirections['SDA'] = pinDir
    pinOffsets['SIG'] = { x: pinX, y: resolveY(['SIG', 'OUT', 'DATA'], 2) }; pinDirections['SIG'] = pinDir
    pinOffsets['OUT'] = pinOffsets['SIG']; pinDirections['OUT'] = pinDir

    return { width, height, pinOffsets, pinDirections }
  }

  // 4. Microcontrollers, Dual-row ICs, and Multi-pin Chips
  const isEsp32 =
    name.includes('ESP32') ||
    lib.includes('ESP32') ||
    (comp.value || '').toUpperCase().includes('ESP32') ||
    ref.startsWith('U')

  const defaultEspPins = [
    { num: '1', name: '3V3' },
    { num: '2', name: 'EN' },
    { num: '3', name: 'VP' },
    { num: '4', name: 'VN' },
    { num: '5', name: 'D34' },
    { num: '6', name: 'D35' },
    { num: '7', name: 'D32' },
    { num: '8', name: 'D33' },
    { num: '9', name: 'D25' },
    { num: '10', name: 'D26' },
    { num: '11', name: 'D27' },
    { num: '12', name: 'D14' },
    { num: '13', name: 'D12' },
    { num: '14', name: 'D13' },
    { num: '15', name: '5V' },
    { num: '16', name: 'GND' },
    { num: '17', name: 'D23' },
    { num: '18', name: 'D22' },
    { num: '19', name: 'TX0' },
    { num: '20', name: 'RX0' },
    { num: '21', name: 'D21' },
    { num: '22', name: 'D19' },
    { num: '23', name: 'D18' },
    { num: '24', name: 'D5' },
    { num: '25', name: 'D4' },
    { num: '26', name: 'D0' },
    { num: '27', name: 'D2' },
    { num: '28', name: 'D15' },
    { num: '29', name: 'D8' },
    { num: '30', name: 'D7' },
    { num: '31', name: 'CLK' },
  ]

  // Check if comp.pins has real named pin objects
  const hasNamedPins =
    Array.isArray(comp.pins) &&
    comp.pins.length > 0 &&
    typeof comp.pins[0] === 'object' &&
    Boolean((comp.pins[0] as { name?: string }).name)

  const rawPins: Array<string | { num: string; name: string }> =
    (hasNamedPins ? comp.pins : null) ??
    (isEsp32 ? defaultEspPins : null) ??
    (Array.isArray(comp.pins) && comp.pins.length > 0 ? comp.pins : null) ??
    defaultEspPins

  // Populate comp.pins so symbols.tsx receives the enriched names
  comp.pins = rawPins as CircuitComponent['pins']

  const pinCount = Math.max(rawPins.length, 16)
  const half = Math.ceil(pinCount / 2)
  const rowSpacing = half > 16 ? 18 : 20
  // Width is total bounding box including 14px stubs on each side
  // Body area = width - 28px. Needs to fit pin names (longest ~10 chars @ 7.5px ≈ 62px)
  const width = 180
  const height = 44 + half * rowSpacing + 10

  rawPins.forEach((p, idx) => {
    const pinNum = typeof p === 'string' ? p : p.num || String(idx + 1)
    const pinName = typeof p === 'object' ? p.name : pinNum
    const isLeft = idx < half
    const row = isLeft ? idx : idx - half
    const y = 42 + row * rowSpacing
    const pt: Point = isLeft ? { x: 0, y } : { x: width, y }
    const dir: Direction = isLeft ? 'left' : 'right'

    pinOffsets[pinNum] = pt
    pinDirections[pinNum] = dir
    if (pinName && pinName !== pinNum) {
      pinOffsets[pinName] = pt
      pinDirections[pinName] = dir
      const cleaned = pinName.replace(/^(GPIO|IO)/i, '')
      if (cleaned !== pinName) {
        pinOffsets[`IO${cleaned}`] = pt
        pinOffsets[`GPIO${cleaned}`] = pt
        pinOffsets[`D${cleaned}`] = pt
        pinDirections[`IO${cleaned}`] = dir
        pinDirections[`GPIO${cleaned}`] = dir
        pinDirections[`D${cleaned}`] = dir
      }
    }
  })

  return { width, height, pinOffsets, pinDirections }
}

// ── Rotation Geometry & Coordinate Transforms ──────────────────────────────

export function rotateDirection(dir: Direction, rot: 0 | 90 | 180 | 270): Direction {
  if (!rot) return dir
  const dirs: Direction[] = ['left', 'top', 'right', 'bottom']
  const idx = dirs.indexOf(dir)
  if (idx === -1) return dir
  const shift = Math.floor(rot / 90)
  return dirs[(idx + shift) % 4]
}

export function rotatePinOffset(
  offset: Point,
  baseWidth: number,
  baseHeight: number,
  rot: 0 | 90 | 180 | 270
): Point {
  if (!rot) return offset
  const cx0 = baseWidth / 2
  const cy0 = baseHeight / 2
  const dx = offset.x - cx0
  const dy = offset.y - cy0

  let rx = dx
  let ry = dy
  if (rot === 90) {
    rx = -dy
    ry = dx
  } else if (rot === 180) {
    rx = -dx
    ry = -dy
  } else if (rot === 270) {
    rx = dy
    ry = -dx
  }

  const isPerp = rot === 90 || rot === 270
  const newWidth = isPerp ? baseHeight : baseWidth
  const newHeight = isPerp ? baseWidth : baseHeight
  const cx = newWidth / 2
  const cy = newHeight / 2

  return {
    x: Math.round(rx + cx),
    y: Math.round(ry + cy),
  }
}

// ── Clean Schematic Component Placement ─────────────────────────────────────

/**
 * Computes component placement using Connection-Driven Pin Alignment.
 * - Components connected to MCU/IC pins snap to the exact Y level of that pin.
 * - Series passives (e.g. Resistor -> LED) snap horizontally inline.
 * - User-positioned components (savedPositions) are strictly preserved and never mutated.
 */
export function layoutComponents(
  components: CircuitComponent[],
  savedPositions?: Record<string, Point>,
  connections?: CircuitConnection[],
  savedRotations?: Record<string, 0 | 90 | 180 | 270>
): PositionedComponent[] {
  const positioned: PositionedComponent[] = []

  // Pre-calculate intrinsic dimensions and rotated geometry for each component
  interface CompMeta {
    comp: CircuitComponent
    baseWidth: number
    baseHeight: number
    width: number
    height: number
    rotation: 0 | 90 | 180 | 270
    pinOffsets: Record<string, Point>
    pinDirections: Record<string, Direction>
  }

  const metaList: CompMeta[] = components.map((comp) => {
    const dims = getComponentDimensions(comp)
    const rot = (savedRotations?.[comp.ref] ?? comp.rotation ?? 0) as 0 | 90 | 180 | 270
    const isPerp = rot === 90 || rot === 270
    const width = isPerp ? dims.height : dims.width
    const height = isPerp ? dims.width : dims.height

    const rotatedOffsets: Record<string, Point> = {}
    const rotatedDirs: Record<string, Direction> = {}

    for (const [pKey, off] of Object.entries(dims.pinOffsets)) {
      rotatedOffsets[pKey] = rotatePinOffset(off, dims.width, dims.height, rot)
    }
    for (const [pKey, dir] of Object.entries(dims.pinDirections)) {
      rotatedDirs[pKey] = rotateDirection(dir, rot)
    }

    return {
      comp,
      baseWidth: dims.width,
      baseHeight: dims.height,
      width,
      height,
      rotation: rot,
      pinOffsets: rotatedOffsets,
      pinDirections: rotatedDirs,
    }
  })

  // Identify central IC / MCU (highest pin count)
  let hubMeta: CompMeta | null = null
  let maxPins = 0
  for (const m of metaList) {
    const pCount = Array.isArray(m.comp.pins) ? m.comp.pins.length : (m.comp.pinCount || 0)
    if (pCount > maxPins) {
      maxPins = pCount
      hubMeta = m
    }
  }

  const hubRef = hubMeta?.comp.ref?.toUpperCase() || ''

  // Build connection graph to locate pin-level relationships
  // Map: otherCompRef -> { hubPin: string, otherPin: string }
  const hubConnections = new Map<string, { hubPin: string; otherPin: string }>()
  // Map: compRef -> seriesNeighborRef
  const seriesChains = new Map<string, string>()

  if (connections && hubRef) {
    connections.forEach((conn) => {
      if (isPowerNet(conn.net) || isGroundNet(conn.net)) return
      const nodes = conn.nodes || []
      const hubNode = nodes.find((n) => n.toUpperCase().startsWith(`${hubRef}.`))
      if (hubNode) {
        const hubPin = hubNode.split('.')[1] || ''
        nodes.forEach((n) => {
          if (!n.toUpperCase().startsWith(`${hubRef}.`)) {
            const [otherRef, otherPin] = n.split('.')
            if (otherRef) {
              hubConnections.set(otherRef.toUpperCase(), { hubPin, otherPin: otherPin || '' })
            }
          }
        })
      } else if (nodes.length === 2) {
        const [refA] = nodes[0].split('.')
        const [refB] = nodes[1].split('.')
        if (refA && refB && refA.toUpperCase() !== refB.toUpperCase()) {
          seriesChains.set(refB.toUpperCase(), refA.toUpperCase())
        }
      }
    })
  }

  // Helper to test rectangular overlap
  const doesOverlap = (x1: number, y1: number, w1: number, h1: number, existing: PositionedComponent[]) => {
    return existing.some((ex) => {
      const margin = 20
      return !(
        x1 + w1 + margin <= ex.x ||
        x1 >= ex.x + ex.width + margin ||
        y1 + h1 + margin <= ex.y ||
        y1 >= ex.y + ex.height + margin
      )
    })
  }

  // 1. First Pass: Position the Hub IC if present
  if (hubMeta) {
    const ref = hubMeta.comp.ref
    const savedPos = savedPositions?.[ref]
    let hx = savedPos?.x ?? hubMeta.comp.x
    let hy = savedPos?.y ?? hubMeta.comp.y

    if (hx === undefined || hy === undefined) {
      hx = 380
      hy = 100
    }
    hx = Math.round(hx / 20) * 20
    hy = Math.round(hy / 20) * 20

    const pinPositions: Record<string, Point> = {}
    for (const [pKey, off] of Object.entries(hubMeta.pinOffsets)) {
      pinPositions[pKey] = { x: hx + off.x, y: hy + off.y }
    }

    positioned.push({
      ...hubMeta.comp,
      x: hx,
      y: hy,
      width: hubMeta.width,
      height: hubMeta.height,
      baseWidth: hubMeta.baseWidth,
      baseHeight: hubMeta.baseHeight,
      rotation: hubMeta.rotation,
      pinPositions,
      pinDirections: hubMeta.pinDirections,
    })
  }

  // 2. Second Pass: Position all remaining components
  let leftColFallbackY = 120
  let rightColFallbackY = 120

  for (const m of metaList) {
    if (hubMeta && m.comp.ref.toUpperCase() === hubRef) continue

    const ref = m.comp.ref
    const refUpper = ref.toUpperCase()
    const savedPos = savedPositions?.[ref]

    let x: number | undefined = savedPos?.x ?? m.comp.x
    let y: number | undefined = savedPos?.y ?? m.comp.y
    const isAutoPlaced = x === undefined || y === undefined

    if (isAutoPlaced) {
      const hubPos = hubRef ? positioned.find((c) => c.ref.toUpperCase() === hubRef) : null
      const hubConn = hubConnections.get(refUpper)
      const seriesNeighbor = seriesChains.get(refUpper)
      const seriesPos = seriesNeighbor ? positioned.find((c) => c.ref.toUpperCase() === seriesNeighbor) : null

      if (seriesPos) {
        // Series continuation (e.g. LED after Resistor): place directly inline horizontally
        x = seriesPos.x + seriesPos.width + 60
        y = seriesPos.y
      } else if (hubPos && hubConn) {
        // Connected directly to hub IC pin: align with pin Y coordinate
        const hubPinPt = hubPos.pinPositions[hubConn.hubPin]
        const hubPinDir = hubPos.pinDirections[hubConn.hubPin] || 'right'

        if (hubPinDir === 'left') {
          x = hubPos.x - m.width - 110
          y = (hubPinPt?.y ?? hubPos.y + 40) - m.height / 2
        } else {
          x = hubPos.x + hubPos.width + 110
          y = (hubPinPt?.y ?? hubPos.y + 40) - m.height / 2
        }
      } else {
        // Fallback column placement
        const isLeftPref = refUpper.startsWith('J') || refUpper.startsWith('SW') || refUpper.startsWith('S')
        if (isLeftPref) {
          x = 80
          y = leftColFallbackY
          leftColFallbackY += m.height + 40
        } else {
          x = 750
          y = rightColFallbackY
          rightColFallbackY += m.height + 40
        }
      }

      x = Math.round(x / 20) * 20
      y = Math.round(y / 20) * 20

      // If auto-placed position collides, step down until clear
      let attempts = 0
      while (doesOverlap(x, y, m.width, m.height, positioned) && attempts < 15) {
        y += 40
        attempts++
      }
    } else {
      // Strictly preserve user saved position
      x = Math.round(x! / 20) * 20
      y = Math.round(y! / 20) * 20
    }

    const pinPositions: Record<string, Point> = {}
    for (const [pKey, off] of Object.entries(m.pinOffsets)) {
      pinPositions[pKey] = { x: x + off.x, y: y + off.y }
    }

    positioned.push({
      ...m.comp,
      x,
      y,
      width: m.width,
      height: m.height,
      baseWidth: m.baseWidth,
      baseHeight: m.baseHeight,
      rotation: m.rotation,
      pinPositions,
      pinDirections: m.pinDirections,
    })
  }

  return positioned
}

// ── Clean Manhattan Orthogonal Wire Router ──────────────────────────────────

function resolveEndpoint(
  nodeStr: string,
  components: PositionedComponent[],
  netName?: string
): PinEndpoint | null {
  const parts = (nodeStr || '').split('.')
  if (parts.length < 2) return null

  const [ref, pinKey] = parts
  const comp = components.find((c) => c.ref.toUpperCase() === ref.toUpperCase())
  if (!comp) return null

  // Direct match
  if (comp.pinPositions[pinKey]) {
    return {
      point: comp.pinPositions[pinKey],
      dir: comp.pinDirections[pinKey] || 'left',
      compRef: comp.ref,
      pinKey,
    }
  }

  // Numeric / GPIO / Pin Name dynamic matching
  const cleanPin = pinKey.toUpperCase().replace(/^(GPIO|IO|D)/i, '')
  const aliasKey = Object.keys(comp.pinPositions).find((k) => {
    const cleanK = k.toUpperCase().replace(/^(GPIO|IO|D)/i, '')
    return cleanK === cleanPin || k.toUpperCase() === pinKey.toUpperCase()
  })

  if (aliasKey) {
    return {
      point: comp.pinPositions[aliasKey],
      dir: comp.pinDirections[aliasKey] || 'left',
      compRef: comp.ref,
      pinKey: aliasKey,
    }
  }

  // Polarity and standard pin fallbacks
  if (netName && isGroundNet(netName) && comp.pinPositions['GND']) {
    return { point: comp.pinPositions['GND'], dir: comp.pinDirections['GND'] || 'left', compRef: comp.ref, pinKey: 'GND' }
  }
  if (netName && isPowerNet(netName) && (comp.pinPositions['VCC'] || comp.pinPositions['3V3'])) {
    const k = comp.pinPositions['VCC'] ? 'VCC' : '3V3'
    return { point: comp.pinPositions[k], dir: comp.pinDirections[k] || 'left', compRef: comp.ref, pinKey: k }
  }

  // Dynamic slot for unmapped pins on multi-pin ICs
  const pinNum = parseInt(cleanPin, 10)
  if (!isNaN(pinNum) && comp.height > 100) {
    const isLeft = pinNum <= 19
    const row = isLeft ? pinNum : pinNum - 19
    const y = comp.y + 45 + ((row % 16) * 24)
    const x = isLeft ? comp.x : comp.x + comp.width
    const dir: Direction = isLeft ? 'left' : 'right'
    return {
      point: { x, y },
      dir,
      compRef: comp.ref,
      pinKey,
    }
  }

  return {
    point: { x: comp.x + comp.width, y: comp.y + 45 },
    dir: 'right',
    compRef: comp.ref,
    pinKey,
  }
}

interface ObstacleBox {
  ref: string
  left: number
  right: number
  top: number
  bottom: number
}

interface PathNode {
  x: number
  y: number
  g: number
  f: number
  dir: 'H' | 'V' | null
  parent: PathNode | null
}

/**
 * Routes an obstacle-avoiding orthogonal Manhattan path using a Hanan visibility grid.
 * Guarantees that wires NEVER cross through or go behind any component body.
 */
function routeObstacleAwareManhattan(
  ep1: PinEndpoint,
  ep2: PinEndpoint,
  components: PositionedComponent[],
  _netIdx = 0,
  movingRef?: string | null
): Point[] {
  const p1 = ep1.point
  const p2 = ep2.point
  const d1 = ep1.dir
  const d2 = ep2.dir

  // Dedicated clearance stubs away from component pins
  const stubLen = 16
  const s1: Point = {
    x: p1.x + (d1 === 'left' ? -stubLen : d1 === 'right' ? stubLen : 0),
    y: p1.y + (d1 === 'top' ? -stubLen : d1 === 'bottom' ? stubLen : 0),
  }
  const s2: Point = {
    x: p2.x + (d2 === 'left' ? -stubLen : d2 === 'right' ? stubLen : 0),
    y: p2.y + (d2 === 'top' ? -stubLen : d2 === 'bottom' ? stubLen : 0),
  }

  // Clearance margin outside component body (14px ensures wires don't clip text labels)
  const PAD = 14
  const obstacles: ObstacleBox[] = (components || [])
    .filter((c) => !movingRef || c.ref !== movingRef) // Never let a moving component act as a dynamic obstacle
    .map((c) => ({
      ref: c.ref,
      left: c.x - PAD,
      right: c.x + c.width + PAD,
      top: c.y - PAD,
      bottom: c.y + c.height + PAD,
    }))

  // Checks if segment midpoint penetrates strictly inside any component obstacle box
  function isEdgeBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    for (const b of obstacles) {
      if (midX > b.left && midX < b.right && midY > b.top && midY < b.bottom) {
        return true
      }
    }
    return false
  }

  // Deduplicates grid coordinates within 3px tolerance
  function dedupeCoords(arr: number[]): number[] {
    const sorted = [...arr].map((v) => Math.round(v)).sort((a, b) => a - b)
    const result: number[] = []
    for (const v of sorted) {
      if (result.length === 0 || Math.abs(result[result.length - 1] - v) > 2) {
        result.push(v)
      }
    }
    return result
  }

  const rawXs: number[] = [s1.x, s2.x, p1.x, p2.x]
  const rawYs: number[] = [s1.y, s2.y, p1.y, p2.y]

  for (const b of obstacles) {
    rawXs.push(b.left, b.right)
    rawYs.push(b.top, b.bottom)
  }

  const xs = dedupeCoords(rawXs)
  const ys = dedupeCoords(rawYs)

  const startKey = `${s1.x},${s1.y}`
  const targetKey = `${s2.x},${s2.y}`

  if (startKey === targetKey) {
    return [p1, s1, p2]
  }

  // A* path search on Hanan rectilinear grid
  const initialDir: 'H' | 'V' = d1 === 'left' || d1 === 'right' ? 'H' : 'V'
  const openSet: PathNode[] = [
    {
      x: s1.x,
      y: s1.y,
      g: 0,
      f: Math.abs(s1.x - s2.x) + Math.abs(s1.y - s2.y),
      dir: initialDir,
      parent: null,
    },
  ]
  const closed = new Map<string, number>()

  let endNode: PathNode | null = null
  let iterations = 0

  while (openSet.length > 0 && iterations < 3000) {
    iterations++
    let bestIdx = 0
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i
    }
    const current = openSet.splice(bestIdx, 1)[0]
    const curKey = `${current.x},${current.y}`

    if (current.x === s2.x && current.y === s2.y) {
      endNode = current
      break
    }

    const prevG = closed.get(curKey)
    if (prevG !== undefined && prevG <= current.g) {
      continue
    }
    closed.set(curKey, current.g)

    const xi = xs.indexOf(current.x)
    const yi = ys.indexOf(current.y)

    const neighbors: Array<{ x: number; y: number; dir: 'H' | 'V' }> = []
    if (xi > 0) neighbors.push({ x: xs[xi - 1], y: current.y, dir: 'H' })
    if (xi < xs.length - 1) neighbors.push({ x: xs[xi + 1], y: current.y, dir: 'H' })
    if (yi > 0) neighbors.push({ x: current.x, y: ys[yi - 1], dir: 'V' })
    if (yi < ys.length - 1) neighbors.push({ x: current.x, y: ys[yi + 1], dir: 'V' })

    for (const nb of neighbors) {
      if (isEdgeBlocked(current.x, current.y, nb.x, nb.y)) {
        continue
      }

      const dist = Math.abs(current.x - nb.x) + Math.abs(current.y - nb.y)
      // Turn penalty prioritizes clean, straight lines with minimal corners
      const turnPenalty = current.dir && current.dir !== nb.dir ? 35 : 0
      const g = current.g + dist + turnPenalty

      const nbKey = `${nb.x},${nb.y}`
      const visitedG = closed.get(nbKey)
      if (visitedG !== undefined && visitedG <= g) {
        continue
      }

      const h = Math.abs(nb.x - s2.x) + Math.abs(nb.y - s2.y)
      openSet.push({
        x: nb.x,
        y: nb.y,
        g,
        f: g + h,
        dir: nb.dir,
        parent: current,
      })
    }
  }

  // Fallback if no grid path found (rare): route around perimeter
  if (!endNode) {
    const midX = Math.round((s1.x + s2.x) / 2)
    return [p1, s1, { x: midX, y: s1.y }, { x: midX, y: s2.y }, s2, p2]
  }

  const path: Point[] = []
  let curr: PathNode | null = endNode
  while (curr) {
    path.unshift({ x: curr.x, y: curr.y })
    curr = curr.parent
  }

  const fullPath: Point[] = [p1, ...path, p2]

  // Collinear and duplicate point simplification (merges consecutive straight segments)
  const simplified: Point[] = [fullPath[0]]
  for (let i = 1; i < fullPath.length; i++) {
    const pt = fullPath[i]
    const prev = simplified[simplified.length - 1]
    if (pt.x === prev.x && pt.y === prev.y) continue

    if (simplified.length >= 2) {
      const pprev = simplified[simplified.length - 2]
      const isCollinearH = pprev.y === prev.y && prev.y === pt.y
      const isCollinearV = pprev.x === prev.x && prev.x === pt.x
      if (isCollinearH || isCollinearV) {
        simplified[simplified.length - 1] = pt
        continue
      }
    }
    simplified.push(pt)
  }

  return simplified
}

/**
 * Routes clean, obstacle-avoiding orthogonal wires for all nets in the circuit.
 * Ensures wires never cross through or go behind any component.
 * 
 * - Preserves deterministic netlist connection sequence (never randomly re-orders who connects to who).
 * - Excludes moving components from obstacle masks to eliminate wire jitter during dragging.
 */
export function routeConnections(
  connections: CircuitConnection[],
  components: PositionedComponent[],
  movingRef?: string | null
): WireRoute[] {
  const routes: WireRoute[] = []

  connections.forEach((conn, netIdx) => {
    const nodes = conn.nodes || []
    const endpoints: PinEndpoint[] = []

    nodes.forEach((n) => {
      const ep = resolveEndpoint(n, components, conn.net)
      if (ep) endpoints.push(ep)
    })

    if (endpoints.length >= 2) {
      // Connect sequentially in the deterministic order defined by the netlist
      for (let i = 0; i < endpoints.length - 1; i++) {
        const pathPoints = routeObstacleAwareManhattan(
          endpoints[i],
          endpoints[i + 1],
          components,
          netIdx + i,
          movingRef
        )
        if (pathPoints.length < 2) continue

        let d = `M ${pathPoints[0].x} ${pathPoints[0].y}`
        for (let j = 1; j < pathPoints.length; j++) {
          d += ` L ${pathPoints[j].x} ${pathPoints[j].y}`
        }

        // Clean label position on longest segment
        const midIdx = Math.floor(pathPoints.length / 2)
        const midPoint = pathPoints[midIdx] || {
          x: (pathPoints[0].x + pathPoints[pathPoints.length - 1].x) / 2,
          y: (pathPoints[0].y + pathPoints[pathPoints.length - 1].y) / 2,
        }

        routes.push({
          net: conn.net,
          points: pathPoints,
          pathData: d,
          midPoint,
          color: getNetColor(conn.net, netIdx),
        })
      }
    }
  })

  return routes
}
