/**
 * Chip Client - Generated Component Symbol Renderer
 *
 * KiCad JSON supplies metadata and pin names. Chip owns the visual symbol
 * geometry and the pin coordinates used by jumper-wire routing.
 */

import React, { useMemo } from 'react'
import { getComponentDimensions, type PositionedComponent } from './layout'

export interface SymbolProps {
  component: PositionedComponent
  isSelected: boolean
  isHovered: boolean
  onPinClick?: (pinKey: string) => void
}

type SymbolKind =
  | 'button'
  | 'capacitor'
  | 'connector'
  | 'diode'
  | 'display'
  | 'generic'
  | 'ground'
  | 'ic'
  | 'led'
  | 'mcu'
  | 'module'
  | 'power'
  | 'resistor'
  | 'sensor'
  | 'switch'
  | 'transistor'

interface PinEntry {
  num: string
  label: string
  x: number
  y: number
  side: 'left' | 'right' | 'top' | 'bottom'
}

function getKind(component: PositionedComponent): SymbolKind {
  const ref = (component.ref || '').toUpperCase()
  const lib = (component.lib || '').toUpperCase()
  const name = `${component.name || ''} ${component.value || ''}`.toUpperCase()

  // 1. High-priority feature checks (by name/function first!)
  if (ref.startsWith('DS') || lib.startsWith('DISPLAY') || name.includes('OLED') || name.includes('LCD') || name.includes('DISPLAY') || name.includes('SSD1306') || name.includes('SH1106') || name.includes('SH110X') || name.includes('GME12864') || name.includes('128X64')) return 'display'
  if (name.includes('BUZZER') || ref.startsWith('BZ') || name.includes('PIEZO')) return 'module'
  if (name.includes('SENSOR') || name.includes('OPTICAL') || name.includes('SMOKE') || name.includes('DHT')) return 'sensor'
  if (ref.startsWith('SW') || ref.startsWith('S') || lib.includes('SWITCH') || name.includes('BUTTON')) return 'button'
  if (ref.startsWith('R') || lib.includes('RESISTOR')) return 'resistor'
  if (ref.startsWith('C') || lib.includes('CAPACITOR')) return 'capacitor'
  if (ref.startsWith('D') && name.includes('LED')) return 'led'
  if (ref.startsWith('D') || lib.includes('DIODE')) return 'diode'
  if (ref.startsWith('Q') || ref.startsWith('T') || lib.includes('TRANSISTOR')) return 'transistor'
  if (lib === 'POWER' || ref.startsWith('#PWR')) return name.includes('GND') ? 'ground' : 'power'
  if (lib.startsWith('MCU') || name.includes('ESP32') || name.includes('MICROCONTROLLER')) return 'mcu'
  if (ref.startsWith('J') || ref.startsWith('P') || lib.startsWith('CONNECTOR')) return 'connector'

  const kind = (component.kind || '').toLowerCase() as SymbolKind
  if (kind && kind !== 'generic') return kind

  return Object.keys(component.pinPositions || {}).length > 8 ? 'ic' : 'module'
}

function pinLabel(pin: string | { num: string; name?: string }, fallback: string): { num: string; label: string } {
  if (typeof pin === 'string') return { num: pin, label: pin }
  return {
    num: pin.num || fallback,
    label: pin.name && pin.name !== '~' ? pin.name : pin.num || fallback,
  }
}

function getPinEntries(component: PositionedComponent): PinEntry[] {
  const { width: baseW, height: baseH, pinOffsets, pinDirections } = getComponentDimensions(component)

  // 1. If component.pins has pin definitions, use them
  if (Array.isArray(component.pins) && component.pins.length > 0) {
    return component.pins.map((pin, idx) => {
      const { num, label } = pinLabel(pin, String(idx + 1))
      const off = pinOffsets[num] || pinOffsets[label]
      const x = off ? off.x : idx === 0 ? 0 : baseW
      const y = off ? off.y : baseH / 2
      const dir = pinDirections[num] || pinDirections[label]
      const side = dir || (x <= 0 ? 'left' : x >= baseW ? 'right' : y <= 0 ? 'top' : 'bottom')
      return { num, label, x, y, side }
    })
  }

  // 2. Fallback: extract from pinOffsets, matching numeric keys to named signal aliases
  const allKeys = Object.keys(pinOffsets)
  const numKeys = allKeys.filter((k) => !Number.isNaN(Number(k))).sort((a, b) => Number(a) - Number(b))
  const namedKeys = allKeys.filter(
    (k) => Number.isNaN(Number(k)) && !k.includes('_') && !k.startsWith('GPIO') && !k.startsWith('IO')
  )

  const pins = numKeys.length > 0 ? numKeys : allKeys.slice(0, 2)
  return pins.map((pinKey, idx) => {
    const pt = pinOffsets[pinKey]
    const named = namedKeys.find((nk) => pinOffsets[nk]?.x === pt?.x && pinOffsets[nk]?.y === pt?.y)
    const label = named || pinKey
    const x = pt ? pt.x : idx === 0 ? 0 : baseW
    const y = pt ? pt.y : baseH / 2
    const dir = pinDirections[pinKey] || pinDirections[label]
    const side = dir || (x <= 0 ? 'left' : x >= baseW ? 'right' : y <= 0 ? 'top' : 'bottom')
    return { num: pinKey, label, x, y, side }
  })
}

function Labels({ component, hideLabels = false }: { component: PositionedComponent; hideLabels?: boolean }) {
  if (hideLabels) return null
  return (
    <>
      <text
        x={component.width / 2}
        y={-7}
        textAnchor="middle"
        className="text-[11px] font-bold fill-slate-900 tracking-wide select-none"
      >
        {component.ref}
      </text>
      <text
        x={component.width / 2}
        y={component.height + 15}
        textAnchor="middle"
        className="text-[9px] font-medium fill-slate-500 font-mono select-none"
      >
        {component.value || component.name || component.ref}
      </text>
    </>
  )
}

function Terminal({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return <circle cx={x} cy={y} r={3.2} fill="#ffffff" stroke={stroke} strokeWidth={1.3} />
}

function TwoPinSymbol({
  kind,
  pins,
  width,
  height,
  stroke,
  fill,
}: {
  kind: SymbolKind
  pins: PinEntry[]
  width: number
  height: number
  stroke: string
  fill: string
}) {
  const y = height / 2
  const left = pins.find((p) => p.side === 'left' || p.x <= 0) || pins[0] || { x: 0, y, label: '1', num: '1', side: 'left' as const }
  const right = pins.find((p) => p.side === 'right' || p.x >= width) || pins[1] || { x: width, y, label: '2', num: '2', side: 'right' as const }

  // 1. Resistor: Horizontal box with leads and pin numbers (R1, R2, R3 in reference image)
  if (kind === 'resistor') {
    const boxLeft = 22
    const boxRight = width - 22
    return (
      <>
        {/* Left lead & terminal */}
        <line x1={left.x} y1={y} x2={boxLeft} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={left.x} y={y} stroke={stroke} />
        <text x={left.x + 6} y={y - 4} className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          {left.num || '1'}
        </text>

        {/* Resistor body box */}
        <rect
          x={boxLeft}
          y={y - 7}
          width={boxRight - boxLeft}
          height={14}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.4}
          rx={1.5}
        />

        {/* Right lead & terminal */}
        <line x1={boxRight} y1={y} x2={right.x} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={right.x} y={y} stroke={stroke} />
        <text x={right.x - 6} y={y - 4} textAnchor="end" className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          {right.num || '2'}
        </text>
      </>
    )
  }

  // 2. Capacitor: Parallel plates
  if (kind === 'capacitor') {
    const midX = width / 2
    return (
      <>
        <line x1={left.x} y1={y} x2={midX - 7} y2={y} stroke={stroke} strokeWidth={1.5} />
        <line x1={midX - 7} y1={y - 12} x2={midX - 7} y2={y + 12} stroke={stroke} strokeWidth={1.8} />
        <line x1={midX + 7} y1={y - 12} x2={midX + 7} y2={y + 12} stroke={stroke} strokeWidth={1.8} />
        <line x1={midX + 7} y1={y} x2={right.x} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={left.x} y={y} stroke={stroke} />
        <Terminal x={right.x} y={y} stroke={stroke} />
      </>
    )
  }

  // 3. LED / Diode: Triangle + Cathode bar + Light rays for LED (D1 in reference image)
  if (kind === 'led' || kind === 'diode') {
    const midX = width / 2
    const triLeft = midX - 12
    const triRight = midX + 6
    const barX = triRight + 1

    return (
      <>
        {/* Anode lead & terminal (triangle base on left) */}
        <line x1={left.x} y1={y} x2={triLeft} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={left.x} y={y} stroke={stroke} />
        <text x={left.x + 6} y={y - 4} className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          A
        </text>

        {/* Diode Triangle */}
        <polygon
          points={`${triLeft},${y - 10} ${triLeft},${y + 10} ${triRight},${y}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.4}
        />

        {/* Cathode Bar */}
        <line x1={barX} y1={y - 11} x2={barX} y2={y + 11} stroke={stroke} strokeWidth={1.8} />

        {/* Cathode lead & terminal (bar on right) */}
        <line x1={barX} y1={y} x2={right.x} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={right.x} y={y} stroke={stroke} />
        <text x={right.x - 6} y={y - 4} textAnchor="end" className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          K
        </text>

        {/* Emitted Light Rays for LED */}
        {kind === 'led' && (
          <g stroke="#f59e0b" strokeWidth={1.3} strokeLinecap="round">
            <line x1={midX + 3} y1={y - 9} x2={midX + 13} y2={y - 19} />
            <polygon points={`${midX + 13},${y - 19} ${midX + 10},${y - 15} ${midX + 13},${y - 14}`} fill="#f59e0b" />

            <line x1={midX + 9} y1={y - 4} x2={midX + 19} y2={y - 14} />
            <polygon points={`${midX + 19},${y - 14} ${midX + 16},${y - 10} ${midX + 19},${y - 9}`} fill="#f59e0b" />
          </g>
        )}
      </>
    )
  }

  // 4. Switch / Button: Open-blade contacts (SW1 in reference image)
  if (kind === 'button' || kind === 'switch') {
    const midX = width / 2
    const c1X = midX - 12
    const c2X = midX + 12

    return (
      <>
        {/* Left lead */}
        <line x1={left.x} y1={y} x2={c1X} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={left.x} y={y} stroke={stroke} />
        <text x={left.x + 6} y={y - 4} className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          {left.num || '1'}
        </text>

        {/* Right lead */}
        <line x1={c2X} y1={y} x2={right.x} y2={y} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={right.x} y={y} stroke={stroke} />
        <text x={right.x - 6} y={y - 4} textAnchor="end" className="text-[7.5px] font-semibold fill-slate-400 font-mono select-none">
          {right.num || '2'}
        </text>

        {/* Switch Contacts */}
        <circle cx={c1X} cy={y} r={2.8} fill="#ffffff" stroke={stroke} strokeWidth={1.3} />
        <circle cx={c2X} cy={y} r={2.8} fill="#ffffff" stroke={stroke} strokeWidth={1.3} />

        {/* Switch Blade */}
        <line
          x1={c1X + 2}
          y1={y - 2}
          x2={c2X + 2}
          y2={y - 10}
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </>
    )
  }

  // Default two-terminal fallback
  return (
    <>
      <line x1={left.x} y1={y} x2={right.x} y2={y} stroke={stroke} strokeWidth={1.5} />
      <rect x={width / 2 - 14} y={y - 9} width={28} height={18} fill={fill} stroke={stroke} strokeWidth={1.2} rx={2} />
      <Terminal x={left.x} y={y} stroke={stroke} />
      <Terminal x={right.x} y={y} stroke={stroke} />
    </>
  )
}

function DisplaySymbol({
  component,
  pins,
  stroke,
  fill,
}: {
  component: PositionedComponent
  pins: PinEntry[]
  stroke: string
  fill: string
}) {
  const width = component.width
  const height = component.height

  // Standard I2C OLED pinout labels
  const oledPinNames = ['GND', 'VCC', 'SCL', 'SDA']
  const displayPins = pins.map((p, idx) => ({
    ...p,
    label:
      p.label.startsWith('Pin_') || !Number.isNaN(Number(p.label))
        ? oledPinNames[idx] || p.label
        : p.label,
  }))

  // Pins are on the left side (x=0). Body starts at x=10
  // Screen starts right of pin labels, leaving ~40px for label text area
  const pinAreaWidth = 40   // space for lead + pin label text
  const bodyLeft = 10
  const screenLeft = bodyLeft + pinAreaWidth
  const screenTop = 12
  const screenRight = width - 10
  const screenBottom = height - 12
  const screenWidth = screenRight - screenLeft
  const screenHeight = screenBottom - screenTop

  return (
    <>
      {/* Outer PCB board body */}
      <rect
        x={bodyLeft}
        y={8}
        width={width - bodyLeft - 6}
        height={height - 16}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        rx={4}
      />

      {/* OLED dark glass screen area */}
      <rect
        x={screenLeft}
        y={screenTop}
        width={screenWidth}
        height={screenHeight}
        fill="#0f172a"
        stroke="#334155"
        strokeWidth={1.2}
        rx={2}
      />

      {/* Screen text */}
      <text
        x={screenLeft + screenWidth / 2}
        y={screenTop + screenHeight / 2 - 4}
        textAnchor="middle"
        fontSize={9}
        fontWeight="bold"
        fontFamily="'JetBrains Mono', 'Courier New', monospace"
        fill="#38bdf8"
        letterSpacing="1"
        style={{ userSelect: 'none' }}
      >
        OLED
      </text>
      <text
        x={screenLeft + screenWidth / 2}
        y={screenTop + screenHeight / 2 + 9}
        textAnchor="middle"
        fontSize={7}
        fontWeight="600"
        fontFamily="'JetBrains Mono', 'Courier New', monospace"
        fill="#7dd3fc"
        style={{ userSelect: 'none' }}
      >
        128×64
      </text>

      {/* Left-side I2C Pins — same style as ConnectorSymbol */}
      {displayPins.map((pin) => (
        <g key={`${pin.num}-${pin.label}`}>
          <line x1={0} y1={pin.y} x2={bodyLeft} y2={pin.y} stroke={stroke} strokeWidth={1.3} />
          <Terminal x={0} y={pin.y} stroke={stroke} />
          <text
            x={bodyLeft + 5}
            y={pin.y + 3.5}
            textAnchor="start"
            fontSize={8}
            fontWeight="600"
            fontFamily="'JetBrains Mono', 'Courier New', monospace"
            fill="#334155"
            style={{ userSelect: 'none' }}
          >
            {pin.label}
          </text>
        </g>
      ))}
    </>
  )
}

function ConnectorSymbol({
  component,
  pins,
  stroke,
  fill,
}: {
  component: PositionedComponent
  pins: PinEntry[]
  stroke: string
  fill: string
}) {
  const width = component.width
  const height = component.height
  const firstPinX = pins[0]?.x ?? 0
  const pinsOnRight = firstPinX > width / 2
  const pinX = pinsOnRight ? width : 0
  const bodyLeft = pinsOnRight ? 6 : 14
  const bodyRight = pinsOnRight ? width - 14 : width - 6
  const ys = pins.map((p) => p.y)
  const bodyTop = Math.max(6, Math.min(...ys, 14) - 10)
  const bodyBottom = Math.min(height - 6, Math.max(...ys, height - 14) + 10)
  const labelX = pinsOnRight ? bodyLeft + 6 : bodyRight - 6
  const labelAnchor = pinsOnRight ? 'start' : 'end'

  return (
    <>
      <rect
        x={bodyLeft}
        y={bodyTop}
        width={bodyRight - bodyLeft}
        height={bodyBottom - bodyTop}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.4}
        rx={3}
      />
      {pins.map((pin) => {
        const leadStartX = pinsOnRight ? bodyRight : bodyLeft
        return (
          <g key={`${pin.num}-${pin.label}`}>
            <line x1={leadStartX} y1={pin.y} x2={pinX} y2={pin.y} stroke={stroke} strokeWidth={1.3} />
            <Terminal x={pinX} y={pin.y} stroke={stroke} />
            <text
              x={labelX}
              y={pin.y + 3.5}
              textAnchor={labelAnchor}
              className="text-[8px] font-semibold fill-slate-700 font-mono select-none"
            >
              {pin.label}
            </text>
          </g>
        )
      })}
    </>
  )
}

function BoxSymbol({
  component,
  pins,
  kind,
  stroke,
  fill,
}: {
  component: PositionedComponent
  pins: PinEntry[]
  kind: SymbolKind
  stroke: string
  fill: string
}) {
  const width = component.width
  const height = component.height
  const isMcu = kind === 'mcu'
  const isDualRow = isMcu || kind === 'ic'

  // Pin stub length: the horizontal wire that extends from the body edge to the terminal dot
  const STUB = 14

  // Body inset from the component bounding box edges (terminal dots sit at x=0 / x=width, body starts/ends inward)
  const bodyLeft = STUB
  const bodyRight = width - STUB
  const bodyTop = 0
  const bodyBottom = height

  const leftPins = pins.filter((p) => p.x <= width / 2)
  const rightPins = pins.filter((p) => p.x > width / 2)

  return (
    <>
      {/* Body rectangle — inset from terminal dots */}
      <rect
        x={bodyLeft}
        y={bodyTop}
        width={bodyRight - bodyLeft}
        height={bodyBottom - bodyTop}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        rx={3}
      />

      {/* Divider line below ref/value header */}
      {isDualRow && (
        <line
          x1={bodyLeft}
          y1={38}
          x2={bodyRight}
          y2={38}
          stroke={stroke}
          strokeWidth={0.6}
          strokeOpacity={0.35}
        />
      )}

      {/* Reference designator (e.g. U2) */}
      <text
        x={(bodyLeft + bodyRight) / 2}
        y={18}
        textAnchor="middle"
        fontSize={11}
        fontWeight="bold"
        fontFamily="Inter, sans-serif"
        fill="#0f172a"
        style={{ userSelect: 'none', letterSpacing: '-0.3px' }}
      >
        {component.ref}
      </text>

      {/* Component value / name (e.g. ESP32-WROOM-32) */}
      <text
        x={(bodyLeft + bodyRight) / 2}
        y={30}
        textAnchor="middle"
        fontSize={7.5}
        fontWeight="600"
        fontFamily="'JetBrains Mono', 'Courier New', monospace"
        fill="#475569"
        style={{ userSelect: 'none' }}
      >
        {component.value || component.name || component.lib}
      </text>

      {/* LEFT-side pins */}
      {leftPins.map((pin) => {
        const tx = 0          // terminal dot x
        const stubEnd = bodyLeft  // stub wire ends at body left edge
        return (
          <g key={`pin-L-${pin.num}`}>
            {/* Stub wire */}
            <line
              x1={tx}
              y1={pin.y}
              x2={stubEnd}
              y2={pin.y}
              stroke={stroke}
              strokeWidth={1.25}
            />
            {/* Terminal — open circle, same as all other components */}
            <Terminal x={tx} y={pin.y} stroke={stroke} />
            {/* Pin name inside body — align left, close to edge */}
            <text
              x={bodyLeft + 5}
              y={pin.y + 3.5}
              textAnchor="start"
              fontSize={7.5}
              fontFamily="'JetBrains Mono', 'Courier New', monospace"
              fontWeight="500"
              fill="#334155"
              style={{ userSelect: 'none' }}
            >
              {pin.label}
            </text>
          </g>
        )
      })}

      {/* RIGHT-side pins */}
      {rightPins.map((pin) => {
        const tx = width       // terminal dot x
        const stubEnd = bodyRight  // stub wire ends at body right edge
        return (
          <g key={`pin-R-${pin.num}`}>
            {/* Stub wire */}
            <line
              x1={stubEnd}
              y1={pin.y}
              x2={tx}
              y2={pin.y}
              stroke={stroke}
              strokeWidth={1.25}
            />
            {/* Terminal — open circle, same as all other components */}
            <Terminal x={tx} y={pin.y} stroke={stroke} />
            {/* Pin name inside body — align right */}
            <text
              x={bodyRight - 5}
              y={pin.y + 3.5}
              textAnchor="end"
              fontSize={7.5}
              fontFamily="'JetBrains Mono', 'Courier New', monospace"
              fontWeight="500"
              fill="#334155"
              style={{ userSelect: 'none' }}
            >
              {pin.label}
            </text>
          </g>
        )
      })}
    </>
  )
}

function TransistorSymbol({
  pins: _pins,
  width,
  height,
  stroke,
  fill,
}: {
  pins: PinEntry[]
  width: number
  height: number
  stroke: string
  fill: string
}) {
  const cx = width / 2
  const cy = height / 2
  const r = 18

  // Base pin at left (0, cy), Collector at (width, 12), Emitter at (width, height - 12)
  const baseY = cy
  const collY = 12
  const emitY = height - 12

  return (
    <>
      {/* Outer circular enclosure */}
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={1.3} />

      {/* Base Lead & Vertical Bar */}
      <line x1={0} y1={baseY} x2={cx - 5} y2={baseY} stroke={stroke} strokeWidth={1.4} />
      <line x1={cx - 5} y1={cy - 12} x2={cx - 5} y2={cy + 12} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <Terminal x={0} y={baseY} stroke={stroke} />
      <text x={8} y={baseY - 4} className="text-[7px] font-bold fill-slate-400 font-mono select-none">
        B
      </text>

      {/* Collector Lead */}
      <line x1={cx - 2} y1={cy - 6} x2={cx + 8} y2={cy - 12} stroke={stroke} strokeWidth={1.4} />
      <line x1={cx + 8} y1={cy - 12} x2={width} y2={collY} stroke={stroke} strokeWidth={1.4} />
      <Terminal x={width} y={collY} stroke={stroke} />
      <text x={width - 8} y={collY - 4} textAnchor="end" className="text-[7px] font-bold fill-slate-400 font-mono select-none">
        C
      </text>

      {/* Emitter Lead with Arrow */}
      <line x1={cx - 2} y1={cy + 6} x2={cx + 8} y2={cy + 12} stroke={stroke} strokeWidth={1.4} />
      <line x1={cx + 8} y1={cy + 12} x2={width} y2={emitY} stroke={stroke} strokeWidth={1.4} />
      {/* Arrow pointing outward on Emitter line */}
      <polygon
        points={`${cx + 5},${cy + 10} ${cx + 1},${cy + 7} ${cx + 3},${cy + 12}`}
        fill={stroke}
      />
      <Terminal x={width} y={emitY} stroke={stroke} />
      <text x={width - 8} y={emitY + 11} textAnchor="end" className="text-[7px] font-bold fill-slate-400 font-mono select-none">
        E
      </text>
    </>
  )
}

function PowerSymbol({
  component,
  kind,
  stroke,
}: {
  component: PositionedComponent
  kind: SymbolKind
  stroke: string
}) {
  const x = component.width / 2
  const y = component.height / 2
  if (kind === 'ground') {
    return (
      <>
        <line x1={x} y1={0} x2={x} y2={y - 6} stroke={stroke} strokeWidth={1.4} />
        <line x1={x - 12} y1={y - 6} x2={x + 12} y2={y - 6} stroke={stroke} strokeWidth={1.5} />
        <line x1={x - 8} y1={y - 1} x2={x + 8} y2={y - 1} stroke={stroke} strokeWidth={1.5} />
        <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y + 4} stroke={stroke} strokeWidth={1.5} />
        <Terminal x={x} y={0} stroke={stroke} />
      </>
    )
  }
  return (
    <>
      <line x1={x} y1={component.height} x2={x} y2={y + 6} stroke={stroke} strokeWidth={1.4} />
      <line x1={x - 10} y1={y + 6} x2={x} y2={y - 8} stroke={stroke} strokeWidth={1.4} />
      <line x1={x + 10} y1={y + 6} x2={x} y2={y - 8} stroke={stroke} strokeWidth={1.4} />
      <Terminal x={x} y={component.height} stroke={stroke} />
    </>
  )
}

export const ComponentSymbol: React.FC<SymbolProps> = ({
  component,
  isSelected,
  isHovered,
}) => {
  const stroke = isSelected ? '#2563eb' : isHovered ? '#0ea5e9' : '#1e293b'
  const fill = isSelected ? '#f8faff' : '#ffffff'
  const kind = getKind(component)
  const pins = useMemo(() => getPinEntries(component), [component])
  const isTwoPin = ['resistor', 'capacitor', 'diode', 'led', 'button', 'switch'].includes(kind)
  const isBoxed = ['ic', 'mcu', 'module', 'display', 'sensor', 'generic'].includes(kind)

  const rot = component.rotation || 0
  const baseW = component.baseWidth || component.width
  const baseH = component.baseHeight || component.height

  const unrotatedComp: PositionedComponent = useMemo(() => {
    if (!rot) return component
    return {
      ...component,
      width: baseW,
      height: baseH,
    }
  }, [component, rot, baseW, baseH])

  return (
    <g className="cursor-grab active:cursor-grabbing select-none">
      {/* Bulletproof full hit area across the component bounding box for effortless clicking & dragging */}
      <rect
        x={-6}
        y={isBoxed ? -6 : -14}
        width={component.width + 12}
        height={isBoxed ? component.height + 12 : component.height + 28}
        fill="#ffffff"
        fillOpacity={0.001}
        style={{ pointerEvents: 'all' }}
      />

      {/* Dashed selection bounding box */}
      {isSelected && (
        <rect
          x={-6}
          y={isBoxed ? -6 : -14}
          width={component.width + 12}
          height={isBoxed ? component.height + 12 : component.height + 28}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          rx={5}
        />
      )}

      {/* Symbol body with rotation transform */}
      <g
        transform={
          rot !== 0
            ? `translate(${component.width / 2}, ${component.height / 2}) rotate(${rot}) translate(${-baseW / 2}, ${-baseH / 2})`
            : undefined
        }
      >
        {kind === 'display' ? (
          <DisplaySymbol component={unrotatedComp} pins={pins} stroke={stroke} fill={fill} />
        ) : kind === 'connector' ? (
          <ConnectorSymbol component={unrotatedComp} pins={pins} stroke={stroke} fill={fill} />
        ) : isTwoPin ? (
          <TwoPinSymbol kind={kind} pins={pins} width={baseW} height={baseH} stroke={stroke} fill={fill} />
        ) : kind === 'transistor' ? (
          <TransistorSymbol pins={pins} width={baseW} height={baseH} stroke={stroke} fill={fill} />
        ) : kind === 'power' || kind === 'ground' ? (
          <PowerSymbol component={unrotatedComp} kind={kind} stroke={stroke} />
        ) : (
          <BoxSymbol component={unrotatedComp} pins={pins} kind={kind} stroke={stroke} fill={fill} />
        )}

        <Labels component={unrotatedComp} hideLabels={isBoxed} />
      </g>
    </g>
  )
}

