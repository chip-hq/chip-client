/**
 * Chip Client — Interactive Circuit Schematic Canvas
 * Renders EasyEDA-style vector schematics with pan, zoom, dragging,
 * interactive pin-to-pin wiring, and wire selection/disconnection.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { CircuitDefinition, CircuitComponent, CircuitConnection } from './types'
import { layoutComponents, routeConnections, isGroundNet, isPowerNet, type PositionedComponent, type Point, type WireRoute } from './layout'
import { ComponentSymbol } from './symbols'
import { circuitStore } from './store'

interface PinTarget {
  compRef: string
  pinKey: string
  point: Point
}

interface CircuitCanvasProps {
  circuit: CircuitDefinition | null
  layoutPositions?: Record<string, Point>
  layoutRotations?: Record<string, 0 | 90 | 180 | 270>
  selectedRef?: string | null
  selectedNet?: string | null
  onSelectComponent?: (comp: CircuitComponent | null) => void
  onSelectNet?: (net: string | null) => void
  onMoveComponent?: (ref: string, x: number, y: number) => void
  onRotateComponent?: (ref: string, delta?: number) => void
  onRemoveComponent?: (ref: string) => Promise<unknown>
  onConnectPins?: (params: { net: string; fromNode?: string; toNode?: string; nodes?: string[] }) => Promise<unknown>
  onDisconnectPins?: (params: { net?: string; node?: string }) => Promise<unknown>
  onRenameNet?: (oldNet: string, newNet: string) => Promise<unknown>
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  className?: string
}

export const CircuitCanvas: React.FC<CircuitCanvasProps> = ({
  circuit,
  layoutPositions = {},
  layoutRotations = {},
  selectedRef,
  selectedNet: propSelectedNet,
  onSelectComponent,
  onSelectNet,
  onMoveComponent,
  onRotateComponent,
  onRemoveComponent,
  onConnectPins,
  onDisconnectPins,
  onRenameNet,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Pan & Zoom state
  const [pan, setPan] = useState<Point>({ x: 40, y: 40 })
  const [zoom, setZoom] = useState<number>(1)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 })

  // Dragging component state
  const [draggingRef, setDraggingRef] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragPosition, setDragPosition] = useState<Point | null>(null)
  const isDraggingComp = useRef(false)
  const compMouseDownPos = useRef<Point>({ x: 0, y: 0 })

  // Hover & Selection states
  const [hoveredRef, setHoveredRef] = useState<string | null>(null)
  const [hoveredNet, setHoveredNet] = useState<string | null>(null)
  const [internalSelectedNet, setInternalSelectedNet] = useState<string | null>(null)
  const activeSelectedNet = propSelectedNet !== undefined ? propSelectedNet : internalSelectedNet
  const [hoveredPin, setHoveredPin] = useState<PinTarget | null>(null)

  const handleSelectNet = useCallback((net: string | null) => {
    setInternalSelectedNet(net)
    onSelectNet?.(net)
    if (net) onSelectComponent?.(null)
  }, [onSelectNet, onSelectComponent])

  // Interactive Manual Wiring State
  const [wireMode, setWireMode] = useState(false)
  const [wiringStart, setWiringStart] = useState<PinTarget | null>(null)
  const [mouseCanvasPos, setMouseCanvasPos] = useState<Point>({ x: 0, y: 0 })
  const [editingNetName, setEditingNetName] = useState(false)
  const [newNetNameInput, setNewNetNameInput] = useState('')

  // Interactive Manual Rotation Handle Dragging State
  const [rotatingRef, setRotatingRef] = useState<string | null>(null)
  const [rotationCenter, setRotationCenter] = useState<Point | null>(null)
  const [liveRotateAngle, setLiveRotateAngle] = useState<0 | 90 | 180 | 270 | null>(null)

  // Component Right-Click Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    comp: PositionedComponent
  } | null>(null)

  // Merge layout positions with active drag position
  const activePositions = useMemo(() => {
    const merged = { ...layoutPositions }
    if (draggingRef && dragPosition) {
      merged[draggingRef] = dragPosition
    }
    return merged
  }, [layoutPositions, draggingRef, dragPosition])

  // Merge layout rotations with active knob rotation angle
  const activeRotations = useMemo(() => {
    const merged = { ...layoutRotations }
    if (rotatingRef && liveRotateAngle !== null) {
      merged[rotatingRef] = liveRotateAngle
    }
    return merged
  }, [layoutRotations, rotatingRef, liveRotateAngle])

  // Compute positioned components with Connection-Driven Y-Alignment and Rotations
  const positionedComponents = useMemo(() => {
    if (!circuit?.components) return []
    return layoutComponents(circuit.components, activePositions, circuit.connections, activeRotations)
  }, [circuit?.components, circuit?.connections, activePositions, activeRotations])

  // Auto-freeze initial component positions so every component is permanently locked and independent
  useEffect(() => {
    if (!circuit?.components || positionedComponents.length === 0) return
    const uncommitted = positionedComponents.filter((c) => !layoutPositions[c.ref])
    if (uncommitted.length > 0) {
      const updated: Record<string, Point> = { ...layoutPositions }
      uncommitted.forEach((c) => {
        updated[c.ref] = { x: c.x, y: c.y }
      })
      circuitStore.setLayoutPositions(updated)
    }
  }, [circuit?.components, circuit?.projectId, positionedComponents, layoutPositions])

  // Auto-fit function to center and scale all components to screen
  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    if (positionedComponents.length === 0) {
      setPan({ x: 60, y: 60 })
      setZoom(1)
      return
    }

    // Measure bounding box of all components
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    positionedComponents.forEach((c) => {
      minX = Math.min(minX, c.x)
      minY = Math.min(minY, c.y)
      maxX = Math.max(maxX, c.x + c.width)
      maxY = Math.max(maxY, c.y + c.height)
    })

    const padding = 80
    const contentW = Math.max(maxX - minX + padding * 2, 200)
    const contentH = Math.max(maxY - minY + padding * 2, 200)

    const scale = Math.min(
      Math.max(Math.min(rect.width / contentW, rect.height / contentH), 0.35),
      1.5
    )

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setZoom(scale)
    setPan({
      x: rect.width / 2 - centerX * scale,
      y: rect.height / 2 - centerY * scale,
    })
  }, [positionedComponents])

  // Reset/auto-fit viewport when circuit project/version changes
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToScreen()
    }, 50)
    return () => clearTimeout(timer)
  }, [circuit?.projectId, circuit?.version, fitToScreen])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => fitToScreen()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [fitToScreen])

  // Wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89
    const nextZoom = Math.min(Math.max(zoom * zoomFactor, 0.25), 3)

    // Zoom toward cursor position
    const newPanX = mouseX - (mouseX - pan.x) * (nextZoom / zoom)
    const newPanY = mouseY - (mouseY - pan.y) * (nextZoom / zoom)

    setZoom(nextZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  // Selected net connection details
  const selectedNetConn = useMemo(() => {
    if (!activeSelectedNet || !circuit?.connections) return null
    return circuit.connections.find((c) => c.net.toUpperCase() === activeSelectedNet.toUpperCase()) || null
  }, [activeSelectedNet, circuit?.connections])

  // Keyboard shortcut: Escape cancels wiring, Delete removes selected net, Ctrl+Z / Ctrl+Y for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      if (e.key === 'Escape') {
        setWiringStart(null)
        setWireMode(false)
        handleSelectNet(null)
        setEditingNetName(false)
        setContextMenu(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeSelectedNet && onDisconnectPins) {
        onDisconnectPins({ net: activeSelectedNet })
        handleSelectNet(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !activeSelectedNet && selectedRef && onRemoveComponent) {
        e.preventDefault()
        onRemoveComponent(selectedRef)
        onSelectComponent?.(null)
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && (selectedRef || draggingRef) && onRotateComponent) {
        e.preventDefault()
        const targetRef = draggingRef || selectedRef!
        const delta = e.shiftKey ? -90 : 90
        onRotateComponent(targetRef, delta)
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        onUndo?.()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        onRedo?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeSelectedNet, onDisconnectPins, onUndo, onRedo, handleSelectNet, selectedRef, draggingRef, onRotateComponent, onRemoveComponent, onSelectComponent])

  const movingRef = draggingRef || rotatingRef

  // Cache last settled routes so unrelated wires NEVER recalculate or change during component adjustment
  const lastSettledRoutesRef = useRef<Record<string, WireRoute[]>>({})

  // Clear cache when circuit project or version changes
  useEffect(() => {
    lastSettledRoutesRef.current = {}
  }, [circuit?.projectId, circuit?.version])

  // Compute routed wires using deterministic Chip pin positions
  const wireRoutes = useMemo(() => {
    if (!circuit?.connections) return []

    // When no component is being adjusted, route all connections normally and update settled cache
    if (!movingRef) {
      const routes = routeConnections(circuit.connections, positionedComponents)
      const cache: Record<string, WireRoute[]> = {}
      for (const r of routes) {
        if (!cache[r.net]) cache[r.net] = []
        cache[r.net].push(r)
      }
      lastSettledRoutesRef.current = cache
      return routes
    }

    // While adjusting a component (dragging or rotating):
    // 1. Unrelated nets keep their EXACT pre-adjustment paths (zero change, zero flicker)
    // 2. Only nets directly attached to movingRef update their paths to follow its pins smoothly
    const routes: WireRoute[] = []
    const movingConnections: CircuitConnection[] = []

    for (const conn of circuit.connections) {
      const touchesMovingComp = (conn.nodes || []).some((node) => {
        const compRef = node.split('.')[0] || ''
        return compRef.toUpperCase() === movingRef.toUpperCase()
      })

      if (touchesMovingComp) {
        movingConnections.push(conn)
      } else if (lastSettledRoutesRef.current[conn.net]) {
        // Reuse pre-adjustment routes verbatim
        routes.push(...lastSettledRoutesRef.current[conn.net])
      } else {
        // Fallback if not in cache yet
        movingConnections.push(conn)
      }
    }

    if (movingConnections.length > 0) {
      const updatedRoutes = routeConnections(movingConnections, positionedComponents, movingRef)
      routes.push(...updatedRoutes)
    }

    return routes
  }, [circuit?.connections, positionedComponents, movingRef])

  // ── Pan / Zoom Handlers ───────────────────────────────────────────────────

  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const z = zoomRef.current
      const p = panRef.current
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89
      const newZoom = Math.min(Math.max(z * zoomFactor, 0.3), 3.0)
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      setZoom(newZoom)
      setPan({
        x: mouseX - (mouseX - p.x) * (newZoom / z),
        y: mouseY - (mouseY - p.y) * (newZoom / z),
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Canvas to SVG coordinates converter
  const getCanvasCoords = useCallback((clientX: number, clientY: number): Point => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    }
  }, [pan, zoom])

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | SVGElement
    const isBackground =
      target === containerRef.current ||
      target.id === 'bgGrid' ||
      target.id === 'canvasSvg' ||
      target.tagName?.toLowerCase() === 'svg'

    if (isBackground) {
      if (wiringStart) {
        setWiringStart(null)
      } else {
        setIsPanning(true)
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
        if (onSelectComponent) onSelectComponent(null)
        handleSelectNet(null)
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvasPt = getCanvasCoords(e.clientX, e.clientY)
    setMouseCanvasPos(canvasPt)

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    } else if (rotatingRef && rotationCenter) {
      const dx = canvasPt.x - rotationCenter.x
      const dy = canvasPt.y - rotationCenter.y
      let angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 90
      if (angleDeg < 0) angleDeg += 360
      const snapped = ((Math.round(angleDeg / 90) * 90) % 360) as 0 | 90 | 180 | 270
      setLiveRotateAngle(snapped)
    } else if (draggingRef) {
      const dist = Math.hypot(e.clientX - compMouseDownPos.current.x, e.clientY - compMouseDownPos.current.y)
      if (dist > 3) {
        isDraggingComp.current = true
      }
      const newX = Math.round(((e.clientX - dragOffset.x - pan.x) / zoom) / 20) * 20
      const newY = Math.round(((e.clientY - dragOffset.y - pan.y) / zoom) / 20) * 20
      setDragPosition({ x: newX, y: newY })
    }
  }

  const handleMouseUp = () => {
    if (rotatingRef && liveRotateAngle !== null && onRotateComponent) {
      const currentRot = layoutRotations[rotatingRef] ?? (circuit?.components.find((c) => c.ref === rotatingRef)?.rotation ?? 0)
      const delta = liveRotateAngle - currentRot
      if (delta !== 0) {
        onRotateComponent(rotatingRef, delta)
      }
    }
    setRotatingRef(null)
    setRotationCenter(null)
    setLiveRotateAngle(null)

    if (draggingRef && isDraggingComp.current && dragPosition && onMoveComponent) {
      onMoveComponent(draggingRef, dragPosition.x, dragPosition.y)
    }
    isDraggingComp.current = false
    setIsPanning(false)
    setDraggingRef(null)
    setDragPosition(null)
  }

  // Component Drag Initiator
  const handleComponentMouseDown = (e: React.MouseEvent, comp: PositionedComponent) => {
    e.stopPropagation()
    setContextMenu(null)
    if (wiringStart) return // Don't drag while in wiring mode

    if (onSelectComponent) onSelectComponent(comp)
    handleSelectNet(null)

    compMouseDownPos.current = { x: e.clientX, y: e.clientY }
    isDraggingComp.current = false
    setDraggingRef(comp.ref)
    setDragPosition({ x: comp.x, y: comp.y })
    setDragOffset({
      x: e.clientX - (comp.x * zoom + pan.x),
      y: e.clientY - (comp.y * zoom + pan.y),
    })
  }

  // Rotation Handle Knob Drag Initiator
  const handleRotationKnobMouseDown = (e: React.MouseEvent, comp: PositionedComponent) => {
    e.stopPropagation()
    setContextMenu(null)
    setRotatingRef(comp.ref)
    setRotationCenter({
      x: comp.x + comp.width / 2,
      y: comp.y + comp.height / 2,
    })
    setLiveRotateAngle(comp.rotation || 0)
    if (onSelectComponent) onSelectComponent(comp)
  }

  // Component Right-Click Context Menu Initiator
  const handleComponentContextMenu = (e: React.MouseEvent, comp: PositionedComponent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      comp,
    })
    if (onSelectComponent) onSelectComponent(comp)
  }

  // Pin Click Handler for Interactive Wiring
  const handlePinClick = (e: React.MouseEvent, target: PinTarget) => {
    e.stopPropagation()

    // Also select the component when its pin terminal is clicked
    const comp = positionedComponents.find((c) => c.ref === target.compRef)
    if (comp && onSelectComponent) {
      onSelectComponent(comp)
      handleSelectNet(null)
    }

    if (!wiringStart) {
      // Start wiring mode from this pin
      setWiringStart(target)
    } else {
      // Connect start pin -> target pin
      if (wiringStart.compRef === target.compRef && wiringStart.pinKey === target.pinKey) {
        setWiringStart(null)
        return
      }

      const fromNode = `${wiringStart.compRef}.${wiringStart.pinKey}`
      const toNode = `${target.compRef}.${target.pinKey}`

      // Auto-name net based on pin names (e.g. NET_IO4 or NET_D27)
      const suggestedNet = `NET_${wiringStart.pinKey.replace(/[^a-zA-Z0-9]/g, '')}`.toUpperCase()

      if (onConnectPins) {
        onConnectPins({ net: suggestedNet, fromNode, toNode })
      }
      setWiringStart(null)
    }
  }

  // Rubberband wire preview path
  const wiringPreviewPath = useMemo(() => {
    if (!wiringStart) return ''
    const p1 = wiringStart.point
    const p2 = mouseCanvasPos
    const midX = (p1.x + p2.x) / 2
    return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`
  }, [wiringStart, mouseCanvasPos])

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      className={`relative w-full h-full bg-[#f8f9fb] overflow-hidden select-none ${className}`}
      style={{ cursor: isPanning ? 'grabbing' : wiringStart ? 'crosshair' : draggingRef ? 'grabbing' : 'default' }}
    >
      {/* ── Background Grid ──────────────────────────────────────────────── */}
      <svg id="bgGrid" className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="dotGrid"
            width={20 * zoom}
            height={20 * zoom}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${pan.x % (20 * zoom)}, ${pan.y % (20 * zoom)})`}
          >
            <circle cx={2 * zoom} cy={2 * zoom} r={1.2 * Math.min(zoom, 1.2)} fill="#cbd5e1" opacity={0.7} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotGrid)" />
      </svg>

      {/* ── Main Schematic SVG Layer ───────────────────────────────────────── */}
      <svg id="canvasSvg" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* 1. Orthogonal Wire Routes */}
          {wireRoutes.map((route, i) => {
            const isHovered = hoveredNet === route.net
            const isSelected = activeSelectedNet === route.net
            const strokeColor = isSelected ? '#3b82f6' : isHovered ? '#2563eb' : route.color
            const strokeWidth = isSelected ? 4 : isHovered ? 3.5 : 2

            return (
              <g
                key={`wire-${route.net}-${i}`}
                onMouseEnter={() => setHoveredNet(route.net)}
                onMouseLeave={() => setHoveredNet(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelectNet(route.net)
                }}
                className="cursor-pointer transition-all"
              >
                {/* Invisible thick hit area */}
                <path
                  d={route.pathData}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                />

                {/* Selection Halo */}
                {isSelected && (
                  <path
                    d={route.pathData}
                    fill="none"
                    stroke="#93c5fd"
                    strokeWidth={8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.6}
                  />
                )}

                {/* Visible Wire */}
                <path
                  d={route.pathData}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Net Badge — always visible on signal wires in clear space, and on hover/select */}
                {((!isPowerNet(route.net) && !isGroundNet(route.net) && route.points.length > 1) || isSelected || isHovered) && (
                  <g transform={`translate(${route.midPoint.x}, ${route.midPoint.y - 10})`}>
                    <rect
                      x={-Math.max(route.net.length * 3.2 + 5, 16)}
                      y={-7}
                      width={Math.max(route.net.length * 6.4 + 10, 32)}
                      height={14}
                      rx={3}
                      fill="#ffffff"
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 1.8 : 1.1}
                      className="shadow-xs pointer-events-none"
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      className="text-[7.5px] font-bold fill-slate-700 font-mono tracking-tight select-none pointer-events-none"
                    >
                      {route.net}
                    </text>

                    {/* Disconnect button when wire is selected */}
                    {isSelected && onDisconnectPins && (
                      <g
                        transform="translate(0, 16)"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDisconnectPins({ net: route.net })
                          handleSelectNet(null)
                        }}
                        className="cursor-pointer group"
                      >
                        <rect
                          x={-30}
                          y={-6}
                          width={60}
                          height={13}
                          rx={3}
                          fill="#ef4444"
                          className="group-hover:fill-red-600 transition"
                        />
                        <text
                          x={0}
                          y={3}
                          textAnchor="middle"
                          className="text-[7px] font-bold fill-white font-sans tracking-wide uppercase select-none"
                        >
                          Disconnect
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            )
          })}

          {/* 2. Components Layer */}
          {positionedComponents.map((comp) => {
            const isSelected = selectedRef === comp.ref
            const isHovered = hoveredRef === comp.ref
            const isLiveRotating = rotatingRef === comp.ref && liveRotateAngle !== null

            return (
              <g
                key={comp.ref}
                transform={`translate(${comp.x}, ${comp.y})`}
                style={{ pointerEvents: 'all' }}
                onMouseDown={(e) => handleComponentMouseDown(e, comp)}
                onClick={(e) => {
                  e.stopPropagation()
                  if (onSelectComponent) onSelectComponent(comp)
                  handleSelectNet(null)
                }}
                onContextMenu={(e) => handleComponentContextMenu(e, comp)}
                onMouseEnter={() => setHoveredRef(comp.ref)}
                onMouseLeave={() => setHoveredRef(null)}
              >
                <ComponentSymbol
                  component={comp}
                  isSelected={isSelected}
                  isHovered={isHovered}
                />

                {/* Interactive Lollipop Rotation Handle & Quick Controls on Selected Component */}
                {isSelected && (
                  <g className="pointer-events-auto select-none">
                    {/* Dotted Lollipop Stem */}
                    <line
                      x1={comp.width / 2}
                      y1={0}
                      x2={comp.width / 2}
                      y2={-22}
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                    />

                    {/* Circular Lollipop Knob Handle */}
                    <g
                      transform={`translate(${comp.width / 2}, -22)`}
                      className="cursor-grab active:cursor-grabbing group"
                      onMouseDown={(e) => handleRotationKnobMouseDown(e, comp)}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRotateComponent?.(comp.ref, 90)
                      }}
                    >
                      {/* Generous invisible hit zone */}
                      <circle cx={0} cy={0} r={14} fill="transparent" />

                      {/* Visible Knob Circle */}
                      <circle
                        cx={0}
                        cy={0}
                        r={8}
                        fill="#ffffff"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        className="group-hover:fill-blue-50 group-hover:scale-110 transition-transform origin-center drop-shadow-sm"
                      />

                      {/* Circular Arrow Icon */}
                      <path
                        d="M-3 -1 A 3.5 3.5 0 1 1 1 3.5 M 1 1 L 1 3.5 L 3.5 3.5"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={1.3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="pointer-events-none"
                      />
                    </g>

                    {/* Floating 3-Button Quick Action Pill [ ↺ -90° ] [ Angle ] [ ↻ +90° ] */}
                    <g
                      transform={`translate(${comp.width / 2}, -48)`}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* Pill Background Container */}
                      <rect
                        x={-64}
                        y={-12}
                        width={128}
                        height={24}
                        rx={12}
                        fill="#0f172a"
                        stroke="#334155"
                        strokeWidth={1.2}
                        className="shadow-lg"
                      />

                      {/* ↺ Rotate -90° Button */}
                      <g
                        className="cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRotateComponent?.(comp.ref, -90)
                        }}
                      >
                        <rect
                          x={-60}
                          y={-9}
                          width={32}
                          height={18}
                          rx={9}
                          fill="transparent"
                          className="group-hover:fill-slate-800 transition"
                        />
                        <text
                          x={-44}
                          y={3.5}
                          textAnchor="middle"
                          className="text-[9.5px] font-bold fill-blue-400 group-hover:fill-blue-300 select-none"
                        >
                          ↺ -90°
                        </text>
                      </g>

                      {/* Center Angle Display & Quick Step */}
                      <g
                        className="cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRotateComponent?.(comp.ref, 90)
                        }}
                      >
                        <rect
                          x={-26}
                          y={-9}
                          width={52}
                          height={18}
                          rx={9}
                          fill="#1e293b"
                          stroke={isLiveRotating ? '#10b981' : '#3b82f6'}
                          strokeWidth={1}
                          className="group-hover:fill-blue-950 transition"
                        />
                        <text
                          x={0}
                          y={3.5}
                          textAnchor="middle"
                          className={`text-[9.5px] font-mono font-bold select-none ${
                            isLiveRotating ? 'fill-emerald-400' : 'fill-white'
                          }`}
                        >
                          {isLiveRotating ? `${liveRotateAngle}°` : `${comp.rotation || 0}°`}
                        </text>
                      </g>

                      {/* ↻ Rotate +90° Button */}
                      <g
                        className="cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRotateComponent?.(comp.ref, 90)
                        }}
                      >
                        <rect
                          x={28}
                          y={-9}
                          width={32}
                          height={18}
                          rx={9}
                          fill="transparent"
                          className="group-hover:fill-slate-800 transition"
                        />
                        <text
                          x={44}
                          y={3.5}
                          textAnchor="middle"
                          className="text-[9.5px] font-bold fill-blue-400 group-hover:fill-blue-300 select-none"
                        >
                          +90° ↻
                        </text>
                      </g>
                    </g>
                  </g>
                )}
              </g>
            )
          })}

          {/* 3. Interactive Pin Terminal Ports (Click to Wire) */}
          {positionedComponents.map((comp) => (
            <g key={`pin-ports-${comp.ref}`}>
              {Object.entries(comp.pinPositions || {}).map(([pinKey, pt]) => {
                const isStartPin = wiringStart?.compRef === comp.ref && wiringStart?.pinKey === pinKey
                const isHovered = hoveredPin?.compRef === comp.ref && hoveredPin?.pinKey === pinKey
                const target: PinTarget = { compRef: comp.ref, pinKey, point: pt }

                return (
                  <g
                    key={`port-${comp.ref}-${pinKey}`}
                    transform={`translate(${pt.x}, ${pt.y})`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handlePinClick(e, target)}
                    onMouseEnter={() => setHoveredPin(target)}
                    onMouseLeave={() => setHoveredPin(null)}
                    className="cursor-crosshair group"
                  >
                    {/* Invisible click target */}
                    <circle cx={0} cy={0} r={10} fill="#ffffff" fillOpacity={0.001} style={{ pointerEvents: 'all' }} />

                    {/* Animated Pulsing Target Ring & Terminal on Hover/Wiring/WireMode */}
                    {(isStartPin || isHovered || wiringStart || wireMode) && (
                      <>
                        <circle
                          cx={0}
                          cy={0}
                          r={isStartPin ? 6 : isHovered ? 5.5 : 4}
                          fill={isStartPin ? '#3b82f6' : isHovered ? '#10b981' : wireMode ? '#3b82f6' : '#60a5fa'}
                          opacity={isStartPin ? 0.9 : isHovered ? 0.8 : wireMode ? 0.5 : 0.4}
                          className="animate-pulse"
                        />
                        <circle
                          cx={0}
                          cy={0}
                          r={2.5}
                          fill="#ffffff"
                          stroke={isStartPin ? '#3b82f6' : isHovered ? '#10b981' : wireMode ? '#2563eb' : '#334155'}
                          strokeWidth={1.5}
                        />
                      </>
                    )}

                    {/* Pin Name Tooltip on Hover */}
                    {isHovered && (
                      <g transform="translate(0, -12)" className="pointer-events-none">
                        <rect
                          x={-Math.max((comp.ref.length + pinKey.length) * 3.5 + 8, 20)}
                          y={-8}
                          width={Math.max((comp.ref.length + pinKey.length) * 7 + 16, 40)}
                          height={16}
                          rx={3}
                          fill="#1e293b"
                        />
                        <text
                          x={0}
                          y={3}
                          textAnchor="middle"
                          className="text-[8px] font-bold fill-white font-mono"
                        >
                          {comp.ref}.{pinKey}
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          ))}

          {/* 4. Live Interactive Rubberband Wiring Preview */}
          {wiringStart && wiringPreviewPath && (
            <g className="pointer-events-none">
              <path
                d={wiringPreviewPath}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2.5}
                strokeDasharray="5 3"
                className="animate-pulse"
              />
              <circle
                cx={wiringStart.point.x}
                cy={wiringStart.point.y}
                r={4.5}
                fill="#3b82f6"
              />
              <circle
                cx={mouseCanvasPos.x}
                cy={mouseCanvasPos.y}
                r={4}
                fill="#3b82f6"
              />
            </g>
          )}
        </g>
      </svg>

      {/* ── Active Manual Wire Mode Prompt ───────────────────────────────── */}
      {wireMode && !wiringStart && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 rounded-xl shadow-md flex items-center gap-2 text-xs font-medium z-30 transition-all animate-in fade-in slide-in-from-top-2 duration-150">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-slate-600">Manual Wire Mode: Click any component pin to begin wire</span>
          <button
            onClick={() => setWireMode(false)}
            className="ml-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer"
          >
            Exit (Esc)
          </button>
        </div>
      )}

      {/* ── Active Manual Wiring Status Banner (Clean Chip Theme) ────────── */}
      {wiringStart && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 rounded-xl shadow-md flex items-center gap-2.5 text-xs font-medium z-30 transition-all animate-in fade-in slide-in-from-top-2 duration-150">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
          </span>
          <span className="text-slate-500 text-[11px]">Wiring from</span>
          <span className="font-mono font-bold px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-800 rounded text-[11px]">
            {wiringStart.compRef}.{wiringStart.pinKey}
          </span>
          <span className="text-slate-400 text-[11px] hidden sm:inline">— click target pin to connect</span>
          <button
            onClick={() => {
              setWiringStart(null)
              setWireMode(false)
            }}
            className="ml-1 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 rounded-md transition flex items-center gap-1 cursor-pointer"
            title="Cancel wiring (Esc)"
          >
            <span>Cancel</span>
            <kbd className="text-[9px] font-mono px-1 bg-white rounded border border-slate-300 text-slate-500 shadow-2xs">Esc</kbd>
          </button>
        </div>
      )}

      {/* ── Selected Wire / Net Quick Editor ──────────────────────────────── */}
      {activeSelectedNet && !wiringStart && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 rounded-xl shadow-md flex items-center gap-2.5 text-xs font-medium z-30 transition-all animate-in fade-in slide-in-from-top-2 duration-150">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-slate-500 text-[11px]">Wire:</span>
          {editingNetName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (newNetNameInput.trim() && newNetNameInput.trim() !== activeSelectedNet && onRenameNet) {
                  onRenameNet(activeSelectedNet, newNetNameInput.trim())
                }
                setEditingNetName(false)
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                autoFocus
                value={newNetNameInput}
                onChange={(e) => setNewNetNameInput(e.target.value)}
                className="font-mono text-xs px-1.5 py-0.5 border border-blue-400 rounded bg-white text-slate-900 outline-hidden w-28 uppercase"
              />
              <button
                type="submit"
                className="px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-semibold cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingNetName(false)}
                className="px-1.5 py-0.5 text-slate-500 hover:text-slate-800 text-[10px] cursor-pointer"
              >
                ✕
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-800 rounded text-[11px]">
                {activeSelectedNet}
              </span>
              {onRenameNet && (
                <button
                  onClick={() => {
                    setNewNetNameInput(activeSelectedNet)
                    setEditingNetName(true)
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition cursor-pointer"
                  title="Rename wire / net"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Connected Pins in this net */}
          {selectedNetConn && selectedNetConn.nodes.length > 0 && (
            <div className="flex items-center gap-1 hidden md:flex">
              <span className="text-slate-400 text-[10px]">pins:</span>
              {selectedNetConn.nodes.slice(0, 4).map((node) => (
                <span
                  key={node}
                  className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200 flex items-center gap-1"
                >
                  {node}
                  {onDisconnectPins && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDisconnectPins({ net: activeSelectedNet, node })
                      }}
                      title={`Disconnect pin ${node} from ${activeSelectedNet}`}
                      className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="w-px h-3.5 bg-slate-200 mx-0.5" />

          {/* Disconnect entire net button */}
          {onDisconnectPins && (
            <button
              onClick={() => {
                onDisconnectPins({ net: activeSelectedNet })
                handleSelectNet(null)
              }}
              className="px-2 py-0.5 text-[11px] font-medium text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 rounded-md transition cursor-pointer"
              title="Disconnect entire wire (Delete)"
            >
              Disconnect
            </button>
          )}

          <button
            onClick={() => handleSelectNet(null)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 cursor-pointer"
            title="Deselect (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Floating Zoom, Undo/Redo & Viewport Controls ───────────────────── */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg shadow-md p-1 z-20">
        {/* Undo / Redo */}
        {onUndo && (
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2a5 5 0 01-5 5H11M3 10l6-6M3 10l6 6" />
            </svg>
          </button>
        )}

        {onRedo && (
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2a5 5 0 005 5h2M21 10l-6-6m6 6l-6 6" />
            </svg>
          </button>
        )}

        {(onUndo || onRedo) && <div className="w-px h-4 bg-slate-200 mx-0.5" />}

        {/* Manual Wire Tool Toggle */}
        <button
          onClick={() => {
            setWireMode((w) => !w)
            if (wiringStart) setWiringStart(null)
          }}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded transition cursor-pointer ${
            wireMode || wiringStart
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
          }`}
          title={wireMode ? 'Exit Wire Tool (Esc)' : 'Manual Wire Tool — click pins to connect'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Wire</span>
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        {/* Zoom In */}
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.2, 3))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition cursor-pointer"
          title="Zoom In (+)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <span className="text-[11px] font-mono font-semibold text-slate-500 px-1 select-none min-w-[36px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        {/* Zoom Out */}
        <button
          onClick={() => setZoom((z) => Math.max(z / 1.2, 0.25))}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition cursor-pointer"
          title="Zoom Out (-)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        <button
          onClick={fitToScreen}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition cursor-pointer"
          title="Fit entire schematic to screen"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Fit All
        </button>

        <button
          onClick={() => {
            setZoom(1)
            setPan({ x: 60, y: 60 })
          }}
          className="px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition cursor-pointer"
          title="Reset View (100%)"
        >
          1:1
        </button>
      </div>

      {/* ── Empty State Placeholder ───────────────────────────────────────── */}
      {(!circuit || positionedComponents.length === 0) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 pointer-events-none">
          <div className="w-14 h-14 mb-3 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">No Circuit Loaded</p>
          <p className="text-xs text-slate-400 mt-1">Use + New Version or create components via chat.</p>
        </div>
      )}

      {/* ── Right-Click Context Menu Overlay ─────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50 pointer-events-auto"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu(null)
          }}
        >
          <div
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 240),
            }}
            className="absolute bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-2xl py-1.5 min-w-[210px] text-xs z-50 text-slate-700 select-none animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
              <span className="font-bold text-slate-800">{contextMenu.comp.ref}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-md font-semibold">
                {contextMenu.comp.rotation || 0}°
              </span>
            </div>

            <button
              onClick={() => {
                onRotateComponent?.(contextMenu.comp.ref, 90)
                setContextMenu(null)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between group cursor-pointer transition"
            >
              <span className="flex items-center gap-2">
                <span className="text-blue-500 font-bold">↻</span> Rotate 90° Clockwise
              </span>
              <span className="text-[10px] text-slate-400 font-mono group-hover:text-slate-600">R</span>
            </button>

            <button
              onClick={() => {
                onRotateComponent?.(contextMenu.comp.ref, -90)
                setContextMenu(null)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between group cursor-pointer transition"
            >
              <span className="flex items-center gap-2">
                <span className="text-blue-500 font-bold">↺</span> Rotate 90° Counter-CW
              </span>
              <span className="text-[10px] text-slate-400 font-mono group-hover:text-slate-600">⇧R</span>
            </button>

            <button
              onClick={() => {
                onRotateComponent?.(contextMenu.comp.ref, 180)
                setContextMenu(null)
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between group cursor-pointer transition"
            >
              <span className="flex items-center gap-2">
                <span className="text-indigo-500 font-bold">⇅</span> Rotate 180°
              </span>
            </button>

            <div className="my-1 border-t border-slate-100" />

            {onRemoveComponent && (
              <button
                onClick={() => {
                  onRemoveComponent(contextMenu.comp.ref)
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-600 flex items-center justify-between group cursor-pointer transition"
              >
                <span className="flex items-center gap-2">
                  <span>✕</span> Delete Component
                </span>
                <span className="text-[10px] text-rose-400 font-mono group-hover:text-rose-600">Del</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
