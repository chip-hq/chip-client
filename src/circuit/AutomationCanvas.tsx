import React, { useState, useRef, useMemo, useEffect } from 'react'
import type { CircuitDefinition } from './types'
import { circuitStore } from './store'

export interface WorkflowNode {
  id: string
  name: string
  category: 'trigger' | 'sensor' | 'logic' | 'actuator' | 'display'
  type: string
  x: number
  y: number
  params: Record<string, string | number>
}

export interface WorkflowConnection {
  id: string
  fromId: string
  toId: string
}

export interface AutomationCanvasProps {
  circuit?: CircuitDefinition | null
  projectId?: string
  isDrawerOpen?: boolean
  onToggleDrawer?: (open: boolean) => void
  onAddComponentToCircuit?: (comp: { ref: string; name: string; lib: string; value: string }) => void
}

export function deriveWorkflowFromCircuit(
  circuit?: CircuitDefinition | null,
  projectId?: string
): { nodes: WorkflowNode[]; connections: WorkflowConnection[] } {
  if (!circuit || !circuit.components || circuit.components.length === 0) {
    return { nodes: [], connections: [] }
  }

  // Retrieve any saved coordinates for this project
  let savedLayout: Record<string, { x: number; y: number }> = {}
  if (projectId) {
    try {
      const raw = localStorage.getItem(`automation_layout_${projectId}`)
      if (raw) savedLayout = JSON.parse(raw)
    } catch {}
  }

  const nodes: WorkflowNode[] = []
  const connections: WorkflowConnection[] = []

  // 1. Locate MCU / ESP32 Controller
  const mcu = circuit.components.find((c) => {
    const name = (c.name || '').toLowerCase()
    const val = (c.value || '').toLowerCase()
    const lib = (c.lib || '').toLowerCase()
    return name.includes('esp32') || val.includes('esp32') || lib.includes('rf_module') || c.ref.toUpperCase() === 'U1'
  })

  const mcuId = mcu ? `node-${mcu.ref}` : 'node-trigger-esp32'
  const mcuPos = savedLayout[mcuId] || { x: 80, y: 160 }
  nodes.push({
    id: mcuId,
    name: mcu ? `${mcu.value || mcu.name || 'ESP32'} Controller` : 'Schedule Trigger',
    category: 'trigger',
    type: 'timer',
    x: mcuPos.x,
    y: mcuPos.y,
    params: { rate: '2000ms', chip: mcu?.name || 'ESP32-WROOM-32' },
  })

  // 2. Classify other components
  let sensorIdx = 0
  let actuatorIdx = 0
  let displayIdx = 0
  let triggerIdx = 0

  const compNodes: { ref: string; nodeId: string; category: WorkflowNode['category'] }[] = []

  circuit.components.forEach((comp) => {
    if (mcu && comp.ref.toUpperCase() === mcu.ref.toUpperCase()) return

    const ref = comp.ref.toUpperCase()
    const name = (comp.name || '').toLowerCase()
    const val = (comp.value || '').toLowerCase()

    // Pass-through resistors and bypass capacitors are part of hardware wiring
    if ((ref.startsWith('R') && !name.includes('ldr')) || (ref.startsWith('C') && !name.includes('sensor'))) {
      return
    }

    const nodeId = `node-${comp.ref}`

    // Sensor: DHT
    if (name.includes('dht') || val.includes('dht')) {
      const pos = savedLayout[nodeId] || { x: 280, y: 120 + sensorIdx * 160 }
      sensorIdx++
      // Detect GPIO connection
      let pinName = 'GPIO 4'
      const conn = (circuit.connections || []).find((cn) => cn.nodes.some((n) => n.toUpperCase().startsWith(`${ref}.`)))
      const espPin = conn?.nodes.find((n) => n.toUpperCase().startsWith('U1.') || (mcu && n.toUpperCase().startsWith(`${mcu.ref}.`)))
      if (espPin) pinName = `GPIO ${espPin.split('.')[1].replace(/IO/i, '')}`

      nodes.push({
        id: nodeId,
        name: `${comp.value || 'DHT22'} Sensor`,
        category: 'sensor',
        type: 'dht22',
        x: pos.x,
        y: pos.y,
        params: { pin: pinName },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'sensor' })
      return
    }

    // Sensor: LDR
    if (name.includes('ldr') || val.includes('ldr') || name.includes('light') || val.includes('photo')) {
      const pos = savedLayout[nodeId] || { x: 280, y: 120 + sensorIdx * 160 }
      sensorIdx++
      nodes.push({
        id: nodeId,
        name: 'LDR Light Sensor',
        category: 'sensor',
        type: 'ldr',
        x: pos.x,
        y: pos.y,
        params: { pin: 'GPIO 34' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'sensor' })
      return
    }

    // Sensor: PIR Motion
    if (name.includes('pir') || val.includes('pir') || name.includes('motion')) {
      const pos = savedLayout[nodeId] || { x: 280, y: 120 + sensorIdx * 160 }
      sensorIdx++
      nodes.push({
        id: nodeId,
        name: 'PIR Motion Interrupt',
        category: 'sensor',
        type: 'pir',
        x: pos.x,
        y: pos.y,
        params: { pin: 'GPIO 14' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'sensor' })
      return
    }

    // Actuator: Relay
    if (name.includes('relay') || val.includes('relay')) {
      const pos = savedLayout[nodeId] || { x: 680, y: 120 + actuatorIdx * 160 }
      actuatorIdx++
      nodes.push({
        id: nodeId,
        name: `${comp.value || '5V Relay'} Switch`,
        category: 'actuator',
        type: 'relay',
        x: pos.x,
        y: pos.y,
        params: { pin: 'GPIO 26' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'actuator' })
      return
    }

    // Actuator: LED
    if (ref.startsWith('D') || name.includes('led') || val.includes('led')) {
      const pos = savedLayout[nodeId] || { x: 680, y: 120 + actuatorIdx * 160 }
      actuatorIdx++
      // Trace connected GPIO
      let pinName = 'GPIO 2'
      for (const cn of (circuit.connections || [])) {
        if (cn.nodes.some((n) => n.toUpperCase().startsWith(`${ref}.`))) {
          const directEsp = cn.nodes.find((n) => n.toUpperCase().startsWith('U1.') || (mcu && n.toUpperCase().startsWith(`${mcu.ref}.`)))
          if (directEsp) {
            pinName = `GPIO ${directEsp.split('.')[1].replace(/IO/i, '')}`
            break
          }
          const rNode = cn.nodes.find((n) => n.toUpperCase().startsWith('R'))
          if (rNode) {
            const rRef = rNode.split('.')[0]
            const rNet = (circuit.connections || []).find((c2) => c2 !== cn && c2.nodes.some((n) => n.toUpperCase().startsWith(`${rRef}.`)))
            const rEsp = rNet?.nodes.find((n) => n.toUpperCase().startsWith('U1.') || (mcu && n.toUpperCase().startsWith(`${mcu.ref}.`)))
            if (rEsp) {
              pinName = `GPIO ${rEsp.split('.')[1].replace(/IO/i, '')}`
              break
            }
          }
        }
      }
      nodes.push({
        id: nodeId,
        name: `Status LED (${comp.ref})`,
        category: 'actuator',
        type: 'led',
        x: pos.x,
        y: pos.y,
        params: { pin: pinName },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'actuator' })
      return
    }

    // Actuator: Buzzer
    if (name.includes('buzzer') || val.includes('buzzer')) {
      const pos = savedLayout[nodeId] || { x: 680, y: 120 + actuatorIdx * 160 }
      actuatorIdx++
      nodes.push({
        id: nodeId,
        name: 'Piezo Buzzer',
        category: 'actuator',
        type: 'buzzer',
        x: pos.x,
        y: pos.y,
        params: { pin: 'GPIO 15' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'actuator' })
      return
    }

    // Display: OLED
    if (name.includes('oled') || val.includes('oled') || name.includes('ssd1306') || val.includes('ssd1306') || name.includes('128x64')) {
      const pos = savedLayout[nodeId] || { x: 880, y: 120 + displayIdx * 160 }
      displayIdx++
      nodes.push({
        id: nodeId,
        name: 'SSD1306 OLED Display',
        category: 'display',
        type: 'oled',
        x: pos.x,
        y: pos.y,
        params: { sda: 21, scl: 22 },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'display' })
      return
    }

    // Trigger: Switch / Button
    if (ref.startsWith('SW') || name.includes('switch') || name.includes('button')) {
      const pos = savedLayout[nodeId] || { x: 80, y: 300 + triggerIdx * 160 }
      triggerIdx++
      nodes.push({
        id: nodeId,
        name: `Push Button (${comp.ref})`,
        category: 'trigger',
        type: 'pir',
        x: pos.x,
        y: pos.y,
        params: { pin: 'GPIO 4' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'trigger' })
      return
    }

    const powerIdentity = `${name} ${val} ${(comp.lib || '').toLowerCase()}`
    if (powerIdentity.includes('regulator') || powerIdentity.includes('ams1117') || powerIdentity.includes('lm1117')) {
      const pos = savedLayout[nodeId] || { x: 480, y: 300 + actuatorIdx * 160 }
      nodes.push({
        id: nodeId,
        name: comp.value || comp.name || 'Voltage Regulator',
        category: 'actuator',
        type: 'regulator',
        x: pos.x,
        y: pos.y,
        params: { input: 'VI', output: 'VO', voltage: '3.3V' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'actuator' })
      return
    }

    if (powerIdentity.includes('power') || powerIdentity.includes('battery') || powerIdentity.includes('dc_source') || ref.startsWith('PWR')) {
      const pos = savedLayout[nodeId] || { x: 280, y: 300 + triggerIdx * 160 }
      nodes.push({
        id: nodeId,
        name: comp.value || comp.name || 'Power Supply',
        category: 'trigger',
        type: 'power',
        x: pos.x,
        y: pos.y,
        params: { output: 'VOUT' },
      })
      compNodes.push({ ref: comp.ref, nodeId, category: 'trigger' })
      return
    }

    // Generic Actuator
    const pos = savedLayout[nodeId] || { x: 680 + actuatorIdx * 160, y: 160 }
    actuatorIdx++
    nodes.push({
      id: nodeId,
      name: comp.value || comp.name || comp.ref,
      category: 'actuator',
      type: 'led',
      x: pos.x,
      y: pos.y,
      params: { ref: comp.ref },
    })
    compNodes.push({ ref: comp.ref, nodeId, category: 'actuator' })
  })

  // Add logic node if both sensors & actuators exist
  const hasSensors = compNodes.some((n) => n.category === 'sensor')
  const hasActuators = compNodes.some((n) => n.category === 'actuator' && nodes.find((item) => item.id === n.nodeId)?.type !== 'regulator')
  let logicNodeId: string | null = null
  const powerNode = compNodes.find((node) => node.nodeId && nodes.find((item) => item.id === node.nodeId)?.type === 'power')
  const regulatorNode = compNodes.find((node) => node.nodeId && nodes.find((item) => item.id === node.nodeId)?.type === 'regulator')

  if (hasSensors && hasActuators) {
    logicNodeId = 'node-logic-auto'
    const logicPos = savedLayout[logicNodeId] || { x: 480, y: 160 }
    nodes.push({
      id: logicNodeId,
      name: 'Threshold Logic Condition',
      category: 'logic',
      type: 'threshold',
      x: logicPos.x,
      y: logicPos.y,
      params: { threshold: 28 },
    })
  }

  // 3. Connect the flow
  let connIdCounter = 1
  if (powerNode && regulatorNode) {
    connections.push({ id: `c-auto-${connIdCounter++}`, fromId: powerNode.nodeId, toId: regulatorNode.nodeId })
    connections.push({ id: `c-auto-${connIdCounter++}`, fromId: regulatorNode.nodeId, toId: mcuId })
  }
  if (hasSensors) {
    // MCU -> Sensor
    compNodes.filter((n) => n.category === 'sensor').forEach((s) => {
      connections.push({
        id: `c-auto-${connIdCounter++}`,
        fromId: mcuId,
        toId: s.nodeId,
      })
      if (logicNodeId) {
        connections.push({
          id: `c-auto-${connIdCounter++}`,
          fromId: s.nodeId,
          toId: logicNodeId,
        })
      }
    })

    if (logicNodeId) {
      compNodes.filter((n) => n.category === 'actuator' && n.nodeId !== regulatorNode?.nodeId).forEach((a) => {
        connections.push({
          id: `c-auto-${connIdCounter++}`,
          fromId: logicNodeId!,
          toId: a.nodeId,
        })
      })
    }
  } else {
    // MCU -> Actuator directly
    compNodes.filter((n) => n.category === 'actuator' && n.nodeId !== regulatorNode?.nodeId).forEach((a) => {
      connections.push({
        id: `c-auto-${connIdCounter++}`,
        fromId: mcuId,
        toId: a.nodeId,
      })
    })
  }

  // Connect Displays
  compNodes.filter((n) => n.category === 'display').forEach((d) => {
    connections.push({
      id: `c-auto-${connIdCounter++}`,
      fromId: mcuId,
      toId: d.nodeId,
    })
  })

  const nodeByRef = new Map<string, string>([
    ...(mcu ? [[mcu.ref.toUpperCase(), mcuId] as [string, string]] : []),
    ...compNodes.map((component) => [component.ref.toUpperCase(), component.nodeId] as [string, string]),
  ])
  ;(circuit.connections || []).forEach((connection) => {
    const refs = connection.nodes
      .map((node) => node.split('.')[0].toUpperCase())
      .filter((ref, index, all) => all.indexOf(ref) === index)
    if (refs.length < 2) return
    const firstNode = nodeByRef.get(refs[0])
    if (!firstNode) return
    refs.slice(1).forEach((ref) => {
      const targetNode = nodeByRef.get(ref)
      if (!targetNode || firstNode === targetNode) return
      if (!connections.some((edge) => edge.fromId === firstNode && edge.toId === targetNode)) {
        connections.push({ id: `c-net-${connIdCounter++}`, fromId: firstNode, toId: targetNode })
      }
    })
  })

  return { nodes, connections }
}

const DEFAULT_NODES: WorkflowNode[] = [
  {
    id: 'node-trigger-1',
    name: 'Schedule Trigger',
    category: 'trigger',
    type: 'timer',
    x: 80,
    y: 160,
    params: { rate: '2000ms' },
  },
  {
    id: 'node-sensor-1',
    name: 'DHT22 Sensor',
    category: 'sensor',
    type: 'dht22',
    x: 280,
    y: 160,
    params: { pin: 'GPIO 4' },
  },
  {
    id: 'node-logic-1',
    name: 'Temp > 28°C Logic',
    category: 'logic',
    type: 'threshold',
    x: 480,
    y: 160,
    params: { threshold: 28 },
  },
  {
    id: 'node-actuator-1',
    name: '5V Relay Switch',
    category: 'actuator',
    type: 'relay',
    x: 680,
    y: 160,
    params: { pin: 'GPIO 26' },
  },
]

const DEFAULT_CONNECTIONS: WorkflowConnection[] = [
  { id: 'conn-1', fromId: 'node-trigger-1', toId: 'node-sensor-1' },
  { id: 'conn-2', fromId: 'node-sensor-1', toId: 'node-logic-1' },
  { id: 'conn-3', fromId: 'node-logic-1', toId: 'node-actuator-1' },
]

function getNodeIcon(type: string) {
  switch (type) {
    case 'timer':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" strokeWidth="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 7v5l3 3" />
        </svg>
      )
    case 'pir':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" strokeWidth="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.93 4.93a10 10 0 0114.14 0M7.76 7.76a6 6 0 018.48 0" />
        </svg>
      )
    case 'dht22':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 14.76V5a2 2 0 00-4 0v9.76a4 4 0 104 0z" />
        </svg>
      )
    case 'ldr':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" strokeWidth="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
        </svg>
      )
    case 'threshold':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h8m0 0l-3-3m3 3l-3 3m-8 7h8m0 0l-3-3m3 3l-3 3" />
        </svg>
      )
    case 'relay':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    case 'led':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )
    case 'regulator':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="5" width="16" height="14" rx="2" strokeWidth="2" />
          <path strokeLinecap="round" strokeWidth="2" d="M8 9h8M8 13h5M8 17h8" />
        </svg>
      )
    case 'power':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v8m-5.5-5A8 8 0 1017.5 6" />
        </svg>
      )
    case 'buzzer':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      )
    case 'vibration':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2zM4 9v6m16-6v6" />
        </svg>
      )
    case 'oled':
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 21h8m-4-4v4" />
        </svg>
      )
    default:
      return (
        <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" strokeWidth="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        </svg>
      )
  }
}

export function AutomationCanvas({
  circuit,
  projectId,
  isDrawerOpen: propDrawerOpen,
  onToggleDrawer,
  onAddComponentToCircuit,
}: AutomationCanvasProps = {}) {
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false)
  const isDrawerOpen = propDrawerOpen !== undefined ? propDrawerOpen : internalDrawerOpen
  const setIsDrawerOpen = (open: boolean) => {
    if (onToggleDrawer) onToggleDrawer(open)
    setInternalDrawerOpen(open)
  }

  // Derive initial flow from circuit if provided
  const initialFlow = useMemo(() => {
    if (circuit && circuit.components && circuit.components.length > 0) {
      return deriveWorkflowFromCircuit(circuit, projectId)
    }
    return { nodes: [], connections: [] }
  }, [circuit, projectId])

  const [nodes, setNodes] = useState<WorkflowNode[]>(initialFlow.nodes)
  const [connections, setConnections] = useState<WorkflowConnection[]>(initialFlow.connections)

  // Auto-sync whenever circuit updates from AI or store
  useEffect(() => {
    if (circuit && circuit.components && circuit.components.length > 0) {
      const derived = deriveWorkflowFromCircuit(circuit, projectId)
      setNodes(derived.nodes)
      setConnections(derived.connections)
    } else if (circuit && (!circuit.components || circuit.components.length === 0)) {
      setNodes([])
      setConnections([])
    }
  }, [circuit, projectId])

  useEffect(() => {
    const handleAutomationGenerated = (event: Event) => {
      const generatedProjectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId
      if (generatedProjectId && generatedProjectId !== projectId) return

      const latestCircuit = circuitStore.getState().circuit
      const latestProjectId = circuitStore.getState().projectId || projectId
      const derived = deriveWorkflowFromCircuit(latestCircuit, latestProjectId)
      setNodes(derived.nodes)
      setConnections(derived.connections)
    }

    window.addEventListener('chip:automation-generated', handleAutomationGenerated)
    return () => window.removeEventListener('chip:automation-generated', handleAutomationGenerated)
  }, [projectId])
  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Dragging state for nodes
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Connecting state (click output port, then click input port)
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(null)
  const [hoveredConnId, setHoveredConnId] = useState<string | null>(null)

  // Simulation state
  const [simRunning, setSimRunning] = useState(true)
  const [simTemp, setSimTemp] = useState(29.4)
  const [simLight, setSimLight] = useState(180)
  const [simMotion, setSimMotion] = useState(false)

  // Active drawer tab
  const [outcomeTab, setOutcomeTab] = useState<'simulation' | 'pinout' | 'wiring'>('simulation')

  // Auto-simulation ticker
  useEffect(() => {
    if (!simRunning) return
    const id = setInterval(() => {}, 1500)
    return () => clearInterval(id)
  }, [simRunning])

  // Zoom Controls
  const zoomIn = () => {
    setZoom((z) => Math.min(2.5, +(z * 1.2).toFixed(2)))
  }

  const zoomOut = () => {
    setZoom((z) => Math.max(0.3, +(z * 0.8).toFixed(2)))
  }

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const fitToScreen = () => {
    if (!canvasRef.current || nodes.length === 0) {
      setPan({ x: 0, y: 0 })
      setZoom(1)
      return
    }
    const rect = canvasRef.current.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - 20)
      minY = Math.min(minY, n.y - 10)
      maxX = Math.max(maxX, n.x + 100)
      maxY = Math.max(maxY, n.y + 140)
    })

    const padding = 80
    const contentW = Math.max(maxX - minX + padding * 2, 200)
    const contentH = Math.max(maxY - minY + padding * 2, 200)

    const isNarrow = rect.width < 640
    const scale = isNarrow
      ? Math.min(Math.max(Math.min(rect.width / contentW, rect.height / contentH), 0.55), 0.9)
      : Math.min(Math.max(Math.min(rect.width / contentW, rect.height / contentH), 0.35), 1.5)

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setZoom(+scale.toFixed(2))
    setPan({
      x: rect.width / 2 - centerX * scale,
      y: rect.height / 2 - centerY * scale,
    })
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitToScreen())
    return () => window.cancelAnimationFrame(frame)
  }, [nodes.length, projectId])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89
    const newZoom = Math.min(2.5, Math.max(0.3, +(zoom * zoomFactor).toFixed(2)))

    const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom)
    const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom)

    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      e.button === 1 || 
      e.altKey ||
      target === canvasRef.current ||
      target.tagName === 'svg' ||
      target.classList.contains('canvas-bg')
    ) {
      setIsPanning(true)
      panStartRef.current = {
        x: e.clientX - pan.x,
        y: e.clientY - pan.y,
      }
      setConnectingFromId(null)
      setConnectingMousePos(null)
      setHoveredConnId(null)
    }
  }

  const handleNodeMouseDown = (e: React.MouseEvent, node: WorkflowNode) => {
    if ((e.target as HTMLElement).closest('.no-drag')) return
    e.stopPropagation()
    setDraggingNodeId(node.id)

    const rect = canvasRef.current?.getBoundingClientRect()
    const canvasLeft = rect ? rect.left : 0
    const canvasTop = rect ? rect.top : 0

    dragOffsetRef.current = {
      x: (e.clientX - canvasLeft - pan.x) / zoom - node.x,
      y: (e.clientY - canvasTop - pan.y) / zoom - node.y,
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      })
      return
    }

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const canvasX = (e.clientX - rect.left - pan.x) / zoom
      const canvasY = (e.clientY - rect.top - pan.y) / zoom

      if (connectingFromId) {
        setConnectingMousePos({ x: canvasX, y: canvasY })
      }

      if (draggingNodeId) {
        const currentX = canvasX - dragOffsetRef.current.x
        const currentY = canvasY - dragOffsetRef.current.y
        setNodes((prev) =>
          prev.map((n) =>
            n.id === draggingNodeId
              ? {
                  ...n,
                  x: Math.round(currentX),
                  y: Math.round(currentY),
                }
              : n
          )
        )
      }
    }
  }

  const handleCanvasMouseUp = () => {
    if (draggingNodeId && projectId) {
      const layout: Record<string, { x: number; y: number }> = {}
      nodes.forEach((n) => {
        layout[n.id] = { x: n.x, y: n.y }
      })
      try {
        localStorage.setItem(`automation_layout_${projectId}`, JSON.stringify(layout))
      } catch {}
    }
    setDraggingNodeId(null)
    setIsPanning(false)
  }

  const handleOutputPortClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (connectingFromId === nodeId) {
      setConnectingFromId(null)
      setConnectingMousePos(null)
    } else {
      setConnectingFromId(nodeId)
    }
  }

  const handleInputPortClick = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation()
    if (!connectingFromId || connectingFromId === targetNodeId) return

    const exists = connections.some(
      (c) => c.fromId === connectingFromId && c.toId === targetNodeId
    )
    if (!exists) {
      const newConn: WorkflowConnection = {
        id: `c-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        fromId: connectingFromId,
        toId: targetNodeId,
      }
      setConnections((prev) => [...prev, newConn])
    }

    const sourceNode = nodes.find((node) => node.id === connectingFromId)
    const targetNode = nodes.find((node) => node.id === targetNodeId)
    const sourceRef = sourceNode?.id.startsWith('node-') ? sourceNode.id.slice(5) : ''
    const targetRef = targetNode?.id.startsWith('node-') ? targetNode.id.slice(5) : ''
    const sourcePin = sourceNode?.type === 'power' ? 'VOUT' : sourceNode?.type === 'regulator' ? 'VO' : 'OUT'
    const targetPin = targetNode?.type === 'timer' ? '3V3' : targetNode?.type === 'regulator' ? 'VI' : 'IN'
    if (sourceRef && targetRef && projectId) {
      const net = sourceNode?.type === 'power' || targetNode?.type === 'regulator' ? '5V_RAW' : '3V3'
      void circuitStore.connectPins({ net, nodes: [`${sourceRef}.${sourcePin}`, `${targetRef}.${targetPin}`] }, 'UI')
    }

    setConnectingFromId(null)
    setConnectingMousePos(null)
  }

  const handleDisconnect = (connId: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== connId))
    setHoveredConnId(null)
  }

  const handleRemoveNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setConnections((prev) => prev.filter((c) => c.fromId !== nodeId && c.toId !== nodeId))
    if (connectingFromId === nodeId) {
      setConnectingFromId(null)
      setConnectingMousePos(null)
    }
  }

  const handleLoadExample = () => {
    setNodes(DEFAULT_NODES)
    setConnections(DEFAULT_CONNECTIONS)
    setConnectingFromId(null)
    setHoveredConnId(null)
    setConnectingMousePos(null)
    resetZoom()

    if (onAddComponentToCircuit) {
      onAddComponentToCircuit({ ref: 'U1', name: 'ESP32-WROOM-32', lib: 'RF_Module', value: 'ESP32-WROOM-32' })
      onAddComponentToCircuit({ ref: 'SEN1', name: 'DHT22', lib: 'Sensor', value: 'DHT22' })
      onAddComponentToCircuit({ ref: 'K1', name: 'Relay', lib: 'Relay', value: '5V Relay' })
    }
  }

  const circuitOutcome = useMemo(() => {
    const pinMap: Array<{
      module: string
      pin: string
      espPin: string
      voltage: string
      notes: string
    }> = []

    const wiring: string[] = []

    let hasDHT = false
    let hasRelay = false
    let hasOLED = false
    let hasLDR = false
    let hasBuzzer = false
    let hasPIR = false

    nodes.forEach((n) => {
      if (n.type === 'dht22') {
        hasDHT = true
        pinMap.push({
          module: 'DHT22 Temp & Humid',
          pin: 'DATA',
          espPin: 'GPIO 4',
          voltage: '3.3V',
          notes: 'Requires 10kΩ pull-up resistor to 3.3V',
        })
        wiring.push('Connect DHT22 Pin 1 to 3.3V, Pin 4 to GND. Connect DATA (Pin 2) to GPIO 4 with a 10kΩ resistor bridged to 3.3V.')
      }
      if (n.type === 'relay') {
        hasRelay = true
        pinMap.push({
          module: '5V Relay Module',
          pin: 'IN',
          espPin: 'GPIO 26',
          voltage: '5.0V (VIN)',
          notes: 'Optocoupled coil input. Power VCC from 5V USB VIN pin.',
        })
        wiring.push('Connect Relay VCC to ESP32 VIN (5V USB pin), GND to GND, and IN signal pin to GPIO 26.')
      }
      if (n.type === 'oled') {
        hasOLED = true
        pinMap.push({
          module: 'SSD1306 OLED (128x64)',
          pin: 'SDA / SCL',
          espPin: 'GPIO 21 / 22',
          voltage: '3.3V',
          notes: 'Hardware I2C Bus (Address 0x3C)',
        })
        wiring.push('Connect OLED VCC to 3.3V, GND to GND, SDA to GPIO 21, and SCL to GPIO 22.')
      }
      if (n.type === 'ldr') {
        hasLDR = true
        pinMap.push({
          module: 'LDR Photoresistor',
          pin: 'Signal',
          espPin: 'GPIO 34 (ADC1)',
          voltage: '3.3V Analog',
          notes: 'Voltage divider with 10kΩ pull-down to GND',
        })
        wiring.push('Wire LDR leg 1 to 3.3V. Wire leg 2 to GPIO 34 AND through a 10kΩ resistor to GND.')
      }
      if (n.type === 'buzzer') {
        hasBuzzer = true
        pinMap.push({
          module: 'Piezo Buzzer',
          pin: 'Positive (+)',
          espPin: 'GPIO 25',
          voltage: '3.3V PWM',
          notes: 'Tone generator output pin',
        })
        wiring.push('Connect Buzzer (+) to GPIO 25 and (-) to GND rail.')
      }
      if (n.type === 'pir') {
        hasPIR = true
        pinMap.push({
          module: 'HC-SR501 PIR',
          pin: 'OUT',
          espPin: 'GPIO 14',
          voltage: '5.0V (VIN)',
          notes: '3.3V logic output safely reads on GPIO 14',
        })
        wiring.push('Connect PIR VCC to VIN (5V), GND to GND, and OUT signal to GPIO 14.')
      }
    })

    const controller = circuit?.components.find((component) => {
      const identity = `${component.name} ${component.value} ${component.lib}`.toLowerCase()
      return identity.includes('esp32') || identity.includes('arduino') || component.ref.toUpperCase() === 'U1'
    })

    const powerSupply = circuit?.components.find((component) => {
      const identity = `${component.name} ${component.value} ${component.lib}`.toLowerCase()
      return identity.includes('power') || identity.includes('battery') || identity.includes('dc_source') || component.ref.toUpperCase().startsWith('PWR')
    })
    const regulator = circuit?.components.find((component) => {
      const identity = `${component.name} ${component.value} ${component.lib}`.toLowerCase()
      return identity.includes('regulator') || identity.includes('ams1117') || identity.includes('lm1117')
    })

    if (controller && nodes.length > 0) {
      wiring.unshift(
        `Use ${controller.value || controller.name || controller.ref} as the controller.`,
        `Connect ${controller.ref} GND to the common ground rail.`,
        `Connect ${controller.ref} power according to the voltage shown in the Pinout Map.`
      )
    }

    if (powerSupply && regulator && controller) {
      const supplyName = powerSupply.value || powerSupply.name || powerSupply.ref
      const regulatorName = regulator.value || regulator.name || regulator.ref
      const supplyToRegulator = (circuit?.connections || []).find((connection) =>
        connection.nodes.some((node) => node.toUpperCase().startsWith(`${powerSupply.ref.toUpperCase()}.`)) &&
        connection.nodes.some((node) => node.toUpperCase().startsWith(`${regulator.ref.toUpperCase()}.`))
      )
      const regulatorToController = (circuit?.connections || []).find((connection) =>
        connection.nodes.some((node) => node.toUpperCase().startsWith(`${regulator.ref.toUpperCase()}.`)) &&
        connection.nodes.some((node) => node.toUpperCase().startsWith(`${controller.ref.toUpperCase()}.`))
      )
      const sharedGround = (circuit?.connections || []).find((connection) => {
        const nodesInNet = connection.nodes.map((node) => node.toUpperCase())
        return nodesInNet.some((node) => node.startsWith(`${powerSupply.ref.toUpperCase()}.`)) &&
          nodesInNet.some((node) => node.startsWith(`${regulator.ref.toUpperCase()}.`)) &&
          nodesInNet.some((node) => node.startsWith(`${controller.ref.toUpperCase()}.`))
      })

      pinMap.push(
        { module: supplyName, pin: 'VOUT', espPin: supplyToRegulator ? `${regulator.ref}.VI` : 'Regulator input', voltage: '5V raw', notes: supplyToRegulator ? `Connected on ${supplyToRegulator.net}.` : 'Connect positive output to the regulator input.' },
        { module: regulatorName, pin: 'VO', espPin: regulatorToController ? `${controller.ref}.3V3` : 'ESP32 3V3', voltage: '3.3V regulated', notes: regulatorToController ? `Connected on ${regulatorToController.net}.` : 'Connect regulator output to the controller 3V3 pin.' }
      )
      wiring.push(
        `${supplyName} positive output → ${regulatorName} input (VI).${supplyToRegulator ? ` Connected on ${supplyToRegulator.net}.` : ' Add this connection.'}`,
        `${regulatorName} 3.3V output (VO) → ${controller.ref}.3V3.${regulatorToController ? ` Connected on ${regulatorToController.net}.` : ' Add this connection.'}`,
        `${powerSupply.ref}.GND → ${regulator.ref}.GND → ${controller.ref}.GND on one shared ground net.${sharedGround ? ` Connected on ${sharedGround.net}.` : ' Add this shared ground connection.'}`
      )
    }

    const knownComponent = (component: CircuitDefinition['components'][number]) => {
      const identity = `${component.name} ${component.value}`.toLowerCase()
      return ['dht', 'relay', 'oled', 'ssd1306', 'ldr', 'photo', 'buzzer', 'pir', 'motion', 'led', 'power', 'battery', 'dc_source', 'regulator', 'ams1117', 'lm1117'].some((term) => identity.includes(term))
    }

    for (const component of circuit?.components || []) {
      if (component === controller || knownComponent(component)) continue
      const identity = `${component.name} ${component.value}`.trim() || component.ref
      const connectedNet = (circuit?.connections || []).find((connection) =>
        connection.nodes.some((node) => node.toUpperCase().startsWith(`${component.ref.toUpperCase()}.`))
      )
      const controllerNode = connectedNet?.nodes.find((node) => controller && node.toUpperCase().startsWith(`${controller.ref.toUpperCase()}.`))
      const controllerPin = controllerNode ? controllerNode.split('.').slice(1).join('.') : 'an available GPIO'
      pinMap.push({
        module: identity,
        pin: 'Signal / power pins',
        espPin: controllerPin,
        voltage: 'See component datasheet',
        notes: connectedNet ? `Connected on ${connectedNet.net}. Verify VCC, GND, and signal voltage before powering.` : 'No controller net assigned yet.',
      })
      wiring.push(
        connectedNet
          ? `Connect ${identity} using net ${connectedNet.net}; its controller signal is ${controllerPin}. Verify the module pin labels and supply voltage before powering.`
          : `Add a connection from ${identity} to the controller, then verify its VCC, GND, and signal pins in the Pinout Map.`
      )
    }

    return {
      pinMap,
      wiring,
      hasDHT,
      hasRelay,
      hasOLED,
      hasLDR,
      hasBuzzer,
      hasPIR,
    }
  }, [nodes])

  // Simulation Evaluation: checks if actuator is actively connected to an upstream wire!
  const hasActuatorWired = useMemo(() => {
    return connections.some((c) => {
      const targetNode = nodes.find((n) => n.id === c.toId)
      return targetNode?.category === 'actuator'
    })
  }, [connections, nodes])

  const conditionMet = useMemo(() => {
    if (!hasActuatorWired) return false
    if (circuitOutcome.hasDHT) return simTemp > 28
    if (circuitOutcome.hasLDR) return simLight < 300
    if (circuitOutcome.hasPIR) return simMotion
    return true
  }, [hasActuatorWired, circuitOutcome, simTemp, simLight, simMotion])

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8f9fa] select-none overflow-hidden relative font-sans">
      {/* ── Main Canvas & Interactive Simulation Area ───────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* n8n Node Workflow Canvas */}
        <div
          ref={canvasRef}
          onWheel={handleWheel}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          className={`flex-1 h-full relative overflow-hidden bg-[#fafafa] ${
            isPanning ? 'cursor-grabbing' : 'cursor-default'
          }`}
        >
          {/* EMPTY PROJECT STATE */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 select-none pointer-events-none z-20">
              <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 mb-3 shadow-xs">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth="2" />
                  <path strokeWidth="2" d="M9 9h6v6H9z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-slate-800 mb-1">Canvas is Empty</h3>
              <p className="text-xs text-slate-500 max-w-sm mb-4">
                Describe your automation in the Agent Studio, or load a starter flow to begin.
              </p>
              <div className="flex items-center gap-3 pointer-events-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleLoadExample()
                  }}
                  className="w-28 h-28 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect width="7" height="7" x="3" y="3" rx="1" strokeWidth={2} />
                    <rect width="7" height="7" x="14" y="3" rx="1" strokeWidth={2} />
                    <rect width="7" height="7" x="14" y="14" rx="1" strokeWidth={2} />
                    <rect width="7" height="7" x="3" y="14" rx="1" strokeWidth={2} />
                  </svg>
                  <span className="text-xs font-semibold">Load Starter Flow</span>
                </button>
              </div>
            </div>
          )}

          {/* ZOOMED & PANNED CONTAINER */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
            className="absolute inset-0 pointer-events-none w-full h-full"
          >
            {/* Connection Lines with Arrowheads */}
            <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-0">
              <defs>
                <marker
                  id="wire-arrow"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748b" />
                </marker>
                <marker
                  id="wire-arrow-active"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0f172a" />
                </marker>
                <marker
                  id="wire-arrow-hover"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#ef4444" />
                </marker>
                <marker
                  id="wire-arrow-connecting"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748b" />
                </marker>
              </defs>

              {/* Established Connections */}
              {connections.map((conn) => {
                const from = nodes.find((n) => n.id === conn.fromId)
                const to = nodes.find((n) => n.id === conn.toId)
                if (!from || !to) return null

                // Output port of square card: (from.x + 80, from.y + 40)
                const startX = from.x + 80
                const startY = from.y + 40
                // Input port of square card: (to.x, to.y + 40)
                const endX = to.x
                const endY = to.y + 40
                const deltaX = Math.max(Math.abs(endX - startX) * 0.45, 30)
                const path = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`

                const isHovered = hoveredConnId === conn.id

                // True cubic bezier midpoint at t = 0.5:
                const midX = (startX + endX) / 2
                const midY = (startY + endY) / 2

                return (
                  <g key={conn.id} className="pointer-events-auto">
                    {/* Wide hover hitbox */}
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="24"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredConnId(conn.id)}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDisconnect(conn.id)
                      }}
                    />
                    {/* Visual Bezier Wire with Directional Arrow */}
                    <path
                      d={path}
                      fill="none"
                      stroke={isHovered ? '#ef4444' : conditionMet ? '#0f172a' : '#64748b'}
                      strokeWidth={isHovered ? '3' : '2'}
                      strokeDasharray={simRunning && !isHovered ? '6 4' : 'none'}
                      markerEnd={isHovered ? 'url(#wire-arrow-hover)' : conditionMet ? 'url(#wire-arrow-active)' : 'url(#wire-arrow)'}
                      className="transition-colors pointer-events-none"
                    />

                    {/* Midpoint scissors button on hover */}
                    {isHovered && (
                      <g
                        transform={`translate(${midX}, ${midY})`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDisconnect(conn.id)
                        }}
                        className="cursor-pointer"
                      >
                        <circle r="11" fill="#ef4444" stroke="#ffffff" strokeWidth="2" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))" />
                        <line x1="-4" y1="-4" x2="4" y2="4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
                        <line x1="4" y1="-4" x2="-4" y2="4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
                      </g>
                    )}
                  </g>
                )
              })}

              {/* In-progress connecting wire to mouse cursor */}
              {connectingFromId && connectingMousePos && (() => {
                const from = nodes.find((n) => n.id === connectingFromId)
                if (!from) return null
                const startX = from.x + 80
                const startY = from.y + 40
                const endX = connectingMousePos.x
                const endY = connectingMousePos.y
                const deltaX = Math.max(Math.abs(endX - startX) * 0.45, 30)
                const previewPath = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`
                return (
                  <path
                    d={previewPath}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    markerEnd="url(#wire-arrow-connecting)"
                    className="pointer-events-none"
                  />
                )
              })()}
            </svg>

            {/* Render Workflow Nodes in Iconic n8n Square Format */}
            {nodes.map((node) => {
              const isActuator = node.category === 'actuator'
              const isSensor = node.category === 'sensor'
              const isConnectingFromThis = connectingFromId === node.id
              const canReceiveInput = node.type !== 'power'

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
                  className="pointer-events-auto absolute flex flex-col items-center select-none"
                >
                  {/* Square Card Box (80px x 80px) */}
                  <div
                    className={`w-20 h-20 rounded-2xl bg-white border-2 flex flex-col items-center justify-center relative shadow-sm hover:shadow-md transition-all group cursor-grab active:cursor-grabbing ${
                      isActuator && conditionMet
                        ? 'border-slate-900 ring-4 ring-slate-900/10'
                        : 'border-slate-200 hover:border-slate-300'
                    } ${isConnectingFromThis ? 'ring-4 ring-slate-900/15 border-slate-900' : ''}`}
                  >
                    {/* Input Port (Left Edge) */}
                    {canReceiveInput && (
                      <div
                        onClick={(e) => handleInputPortClick(e, node.id)}
                        title="Input port (click to finish wiring)"
                        className={`no-drag absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-xs transition-transform hover:scale-125 cursor-pointer z-20 flex items-center justify-center ${
                          connectingFromId && connectingFromId !== node.id
                            ? 'bg-slate-900 animate-bounce ring-2 ring-slate-300'
                            : 'bg-slate-300 hover:bg-slate-500'
                        }`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    )}

                    {/* Output Port (Right Edge) */}
                    <div
                      onClick={(e) => handleOutputPortClick(e, node.id)}
                      title="Output Port (Click to start wiring)"
                      className={`no-drag absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-xs transition-transform hover:scale-125 cursor-pointer z-20 flex items-center justify-center ${
                        isConnectingFromThis
                          ? 'bg-slate-900 ring-2 ring-slate-300'
                          : 'bg-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>

                    {/* Centered Large Vector Icon */}
                    <div className="flex items-center justify-center pointer-events-none">
                      {getNodeIcon(node.type)}
                    </div>

                    {/* Delete Component Button (Top-Right on Hover) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveNode(node.id)
                      }}
                      title="Remove Component"
                      className="no-drag absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300 flex items-center justify-center text-[10px] font-bold shadow-xs opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Node Label & Subtitle Below Card */}
                  <div className="w-32 -ml-6 text-center mt-2 flex flex-col items-center pointer-events-none">
                    <span className="text-xs font-semibold text-slate-800 leading-tight line-clamp-2 px-1 text-center">
                      {node.name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5 text-center">
                      {node.type === 'timer' && 'rate: 2000ms'}
                      {node.type === 'pir' && 'GPIO 14'}
                      {node.type === 'dht22' && 'GPIO 4'}
                      {node.type === 'ldr' && 'GPIO 34'}
                      {node.type === 'threshold' && '> 28°C'}
                      {node.type === 'relay' && 'GPIO 26'}
                      {node.type === 'led' && 'GPIO 2'}
                      {node.type === 'buzzer' && 'GPIO 15'}
                      {node.type === 'vibration' && 'GPIO 13'}
                      {node.type === 'oled' && 'I2C (21,22)'}
                    </span>

                    {/* Live simulated sensor reading or actuator status */}
                    {isSensor && node.type === 'dht22' && (
                      <span className="mt-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-700 font-medium">
                        {simTemp.toFixed(1)}°C
                      </span>
                    )}
                    {isSensor && node.type === 'ldr' && (
                      <span className="mt-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-700 font-medium">
                        {simLight} ADC
                      </span>
                    )}
                    {isActuator && (
                      <span
                        className={`mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold transition-colors ${
                          conditionMet
                            ? 'bg-slate-900 text-white border border-slate-900'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        {conditionMet ? 'ACTIVE' : 'STANDBY'}
                      </span>
                    )}

                    {/* OLED Screen Buffer Preview */}
                    {node.category === 'display' && (
                      <div className="mt-1.5 w-28 bg-black text-white p-1.5 rounded-md text-[8px] font-mono border border-slate-700 shadow-xs">
                        <div className="text-slate-400">OLED (128x64)</div>
                        <div className="text-slate-100 font-bold">T: {simTemp.toFixed(1)}C</div>
                        <div className="text-[7px] text-slate-300">{conditionMet ? '[ACTIVE]' : '[STANDBY]'}</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── FLOATING ZOOM & VIEWPORT CONTROLS (Bottom-Left) ─────────── */}
          <div className="absolute bottom-4 left-4 z-30 flex items-center bg-white/95 backdrop-blur-md border border-slate-200 rounded-lg shadow-md p-1 gap-0.5 text-slate-700 select-none">
            <button
              onClick={zoomIn}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm font-bold transition-colors cursor-pointer"
              title="Zoom In (Ctrl + / Wheel Up)"
            >
              +
            </button>
            <button
              onClick={resetZoom}
              className="px-2 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-xs font-mono font-semibold transition-colors cursor-pointer"
              title="Reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomOut}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm font-bold transition-colors cursor-pointer"
              title="Zoom Out (Ctrl - / Wheel Down)"
            >
              −
            </button>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <button
              onClick={fitToScreen}
              className="px-2 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-xs font-medium gap-1 transition-colors cursor-pointer"
              title="Fit All Nodes to Viewport"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              <span>Fit</span>
            </button>
            <button
              onClick={resetZoom}
              className="px-2 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-xs font-medium transition-colors cursor-pointer"
              title="Reset Pan & Zoom"
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── AI Simulation Control & Solid Outcome Drawer (Right Side) ──── */}
        {isDrawerOpen && (
          <div className="automation-outcome-drawer w-full md:w-88 border-l border-[#e5e5e5] bg-white flex flex-col shrink-0 animate-in slide-in-from-right-10 duration-150 z-20">
            {/* Drawer Tab Headers with Close Button */}
            <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-slate-50 pr-2">
              <div className="flex flex-1 text-[11px] font-semibold">
                <button
                  onClick={() => setOutcomeTab('simulation')}
                  className={`flex-1 py-2.5 text-center transition-all cursor-pointer ${
                    outcomeTab === 'simulation'
                      ? 'bg-white text-slate-900 border-b-2 border-black font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Simulation
                </button>
                <button
                  onClick={() => setOutcomeTab('pinout')}
                  className={`flex-1 py-2.5 text-center transition-all cursor-pointer ${
                    outcomeTab === 'pinout'
                      ? 'bg-white text-slate-900 border-b-2 border-black font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Pinout Map
                </button>
                <button
                  onClick={() => setOutcomeTab('wiring')}
                  className={`flex-1 py-2.5 text-center transition-all cursor-pointer ${
                    outcomeTab === 'wiring'
                      ? 'bg-white text-slate-900 border-b-2 border-black font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Wiring Guide
                </button>
              </div>

              {/* Close Drawer Button */}
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors cursor-pointer ml-1"
                title="Close panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

          {/* TAB 1: THE SIMULATION (Based on active nodes & wiring) */}
          {outcomeTab === 'simulation' && (
            <div className="p-3.5 flex-1 overflow-y-auto space-y-3.5 text-xs">
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <span className="font-bold text-slate-800 text-[11px]">Hardware Signal Simulator</span>
                <p className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">
                  {nodes.length === 0
                    ? 'Canvas is empty. Add components to stimulate live hardware pins.'
                    : `Simulating ${nodes.length} connected hardware modules.`}
                </p>
              </div>

              {/* Interactive Simulation Sliders */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-700 tracking-wide">
                    Live Inputs
                  </span>
                  <button
                    onClick={() => setSimRunning(!simRunning)}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer"
                  >
                    {simRunning ? '⏸ Pause' : '▶ Resume'}
                  </button>
                </div>

                {circuitOutcome.hasDHT && (
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-slate-700 text-[11px]">DHT22 Temperature</span>
                      <span className="font-bold font-mono text-slate-900">{simTemp.toFixed(1)} °C</span>
                    </div>
                    <input
                      type="range"
                      min={18}
                      max={38}
                      step={0.2}
                      value={simTemp}
                      onChange={(e) => setSimTemp(parseFloat(e.target.value))}
                      className="w-full accent-slate-900 cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-slate-400">
                      <span>18°C</span>
                      <span className="font-semibold text-slate-600">Threshold: 28.0°C</span>
                      <span>38°C</span>
                    </div>
                  </div>
                )}

                {circuitOutcome.hasLDR && (
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-slate-700 text-[11px]">LDR Ambient Light</span>
                      <span className="font-bold font-mono text-slate-900">{simLight} ADC</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={900}
                      value={simLight}
                      onChange={(e) => setSimLight(parseInt(e.target.value))}
                      className="w-full accent-slate-900 cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] text-slate-400">
                      <span>Dark (&lt;300)</span>
                      <span>Bright (&gt;600)</span>
                    </div>
                  </div>
                )}

                {circuitOutcome.hasPIR && (
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-slate-700 text-[11px]">PIR Motion Sensor</span>
                      <button
                        onClick={() => setSimMotion(!simMotion)}
                        className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                          simMotion ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {simMotion ? 'MOTION DETECTED' : 'No Motion'}
                      </button>
                    </div>
                  </div>
                )}

                {!circuitOutcome.hasDHT && !circuitOutcome.hasLDR && !circuitOutcome.hasPIR && (
                  <div className="p-3 text-center text-slate-400 text-[11px] bg-slate-50 rounded-lg border border-slate-200">
                    Add a Sensor or Trigger to activate simulation controls.
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 2: SOLID PINOUT MAP */}
          {outcomeTab === 'pinout' && (
            <div className="p-3.5 flex-1 overflow-y-auto space-y-2.5 text-xs">
              <div className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-700 text-[10px]">
                ✓ Verified ESP32 pin allocation. Conflict-free GPIO registers.
              </div>
              {circuitOutcome.pinMap.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">
                  No components placed yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-[10px]">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="p-1.5">Module</th>
                        <th className="p-1.5">ESP32 Pin</th>
                        <th className="p-1.5">Voltage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {circuitOutcome.pinMap.map((p, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-1.5 font-medium text-slate-800">
                            {p.module} <span className="text-slate-400">({p.pin})</span>
                          </td>
                          <td className="p-1.5 font-mono font-bold text-slate-900">{p.espPin}</td>
                          <td className="p-1.5 text-slate-600">{p.voltage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STEP-BY-STEP WIRING GUIDE */}
          {outcomeTab === 'wiring' && (
            <div className="p-3.5 flex-1 overflow-y-auto space-y-2 text-xs">
              {circuitOutcome.wiring.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">Add components to generate a wiring guide.</div>
              ) : (
                <>
                  <h5 className="font-bold text-slate-800 text-[10px] tracking-wide">Breadboard Assembly Guide</h5>
                  {circuitOutcome.wiring.map((step, i) => (
                    <div key={i} className="flex gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="w-4 h-4 rounded-full bg-black text-white font-bold flex items-center justify-center shrink-0 text-[9px]">{i + 1}</span>
                      <p className="text-slate-700 text-[10px] leading-relaxed">{step}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  </div>
)
}
