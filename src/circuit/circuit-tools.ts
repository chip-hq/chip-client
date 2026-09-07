/**
 * Chip Client — WebMCP Circuit Tools Adapter
 * Connects WebMCP agent requests directly to the typed Circuit API & State Store.
 */

import {
  listProjectsApi,
  getProjectApi,
  listCircuitVersionsApi,
  searchComponentsApi,
  getComponentDetailsApi,
  getComponentPinsApi,
  listCircuitArtifactsApi,
  getCircuitArtifactApi,
  testCircuitApi,
  healthCheckApi,
} from './api'
import { circuitStore } from './store'

function formatResult(data: unknown): WebMCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  }
}

function formatError(error: unknown): WebMCPToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: true, message }, null, 2),
      },
    ],
  }
}

// ── 1. Project Tools ─────────────────────────────────────────────────────────

export async function listProjects(): Promise<WebMCPToolResult> {
  try {
    circuitStore.logActivity('AI: Listing workspace projects', 'info')
    const data = await listProjectsApi()
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

export async function getProject(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    circuitStore.logActivity(`AI: Querying project ${projectId}`, 'info')
    const data = await getProjectApi(projectId)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

// ── 2. Circuit Tools ─────────────────────────────────────────────────────────

export async function generateCircuit(args: {
  projectId: string
  circuit?: Record<string, unknown>
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.generateCircuit(args.circuit, 'AI')
    if (!res.success) {
      return formatError(res.error || 'Circuit generation failed')
    }
    const state = circuitStore.getState()
    return formatResult(state.circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function getCurrentCircuit(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    circuitStore.logActivity(`AI: Loading current circuit for ${projectId}`, 'info')
    await circuitStore.loadProjectCircuit(projectId)
    const state = circuitStore.getState()
    return formatResult(state.circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function getCircuitVersion(args: {
  projectId: string
  version: number
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  const version = Number(args?.version)
  if (isNaN(version) || version < 1) {
    return formatError('Missing or invalid required parameter: version')
  }
  try {
    circuitStore.logActivity(`AI: Switched canvas to version v${version}`, 'info')
    await circuitStore.selectVersion(version)
    const state = circuitStore.getState()
    return formatResult(state.circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function listCircuitVersions(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    circuitStore.logActivity(`AI: Listing versions for ${projectId}`, 'info')
    const data = await listCircuitVersionsApi(projectId)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

export async function validateCircuit(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    const valid = await circuitStore.validateCircuit('AI')
    const state = circuitStore.getState()
    return formatResult({
      projectId,
      version: state.selectedVersion,
      valid,
      ercErrors: state.circuit?.ercErrors || [],
      ercWarnings: state.circuit?.ercWarnings || [],
    })
  } catch (err) {
    return formatError(err)
  }
}

export async function getComponents(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    circuitStore.logActivity(`AI: Inspecting components in ${projectId}`, 'info')
    const state = circuitStore.getState()
    if (state.projectId !== projectId || !state.circuit) {
      await circuitStore.loadProjectCircuit(projectId)
    }
    return formatResult(circuitStore.getState().circuit?.components || [])
  } catch (err) {
    return formatError(err)
  }
}

export async function getConnections(args: { projectId: string }): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    circuitStore.logActivity(`AI: Inspecting connections in ${projectId}`, 'info')
    const state = circuitStore.getState()
    if (state.projectId !== projectId || !state.circuit) {
      await circuitStore.loadProjectCircuit(projectId)
    }
    return formatResult(circuitStore.getState().circuit?.connections || [])
  } catch (err) {
    return formatError(err)
  }
}

// ── 3. Incremental Circuit Editing Tools (Step 8) ────────────────────────────

export async function addComponent(args: {
  projectId: string
  ref: string
  lib?: string
  part?: string
  name?: string
  value?: string
  x?: number
  y?: number
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const ref = args?.ref?.trim()
  if (!projectId || !ref) return formatError('Missing required parameters: projectId and ref')

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.addComponent(args, 'AI')
    if (!res.success) return formatError(res.error || 'Failed to add component')
    return formatResult(circuitStore.getState().circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function removeComponent(args: {
  projectId: string
  ref: string
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const ref = args?.ref?.trim()
  if (!projectId || !ref) return formatError('Missing required parameters: projectId and ref')

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.removeComponent(ref, 'AI')
    if (!res.success) return formatError(res.error || 'Failed to remove component')
    return formatResult(circuitStore.getState().circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function updateComponent(args: {
  projectId: string
  ref: string
  value?: string
  name?: string
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const ref = args?.ref?.trim()
  if (!projectId || !ref) return formatError('Missing required parameters: projectId and ref')

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.updateComponent(ref, { value: args.value, name: args.name }, 'AI')
    if (!res.success) return formatError(res.error || 'Failed to update component')
    return formatResult(circuitStore.getState().circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function moveComponent(args: {
  projectId: string
  ref: string
  x: number
  y: number
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const ref = args?.ref?.trim()
  const x = Number(args?.x)
  const y = Number(args?.y)
  if (!projectId || !ref || isNaN(x) || isNaN(y)) {
    return formatError('Missing required parameters: projectId, ref, x, y')
  }

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    circuitStore.moveComponent(ref, x, y, 'AI')
    return formatResult({ success: true, ref, x, y })
  } catch (err) {
    return formatError(err)
  }
}

export async function rotateComponent(args: {
  projectId: string
  ref: string
  deltaDegrees?: number
  angle?: 0 | 90 | 180 | 270
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const ref = args?.ref?.trim()
  if (!projectId || !ref) {
    return formatError('Missing required parameters: projectId, ref')
  }

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const state = circuitStore.getState()
    let delta = args?.deltaDegrees !== undefined ? Number(args.deltaDegrees) : 90
    if (args?.angle !== undefined) {
      const currentRot = state.layoutRotations[ref] ?? (state.circuit?.components.find((c) => c.ref === ref)?.rotation ?? 0)
      delta = Number(args.angle) - currentRot
    }
    circuitStore.rotateComponent(ref, delta, 'AI')
    const finalRot = circuitStore.getState().layoutRotations[ref] ?? 0
    return formatResult({ success: true, ref, rotation: finalRot })
  } catch (err) {
    return formatError(err)
  }
}

export async function connectPins(args: {
  projectId: string
  net: string
  fromNode?: string
  toNode?: string
  nodes?: string[]
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const net = args?.net?.trim()
  if (!projectId || !net) return formatError('Missing required parameters: projectId and net')

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.connectPins(args, 'AI')
    if (!res.success) return formatError(res.error || 'Failed to connect pins')
    return formatResult(circuitStore.getState().circuit)
  } catch (err) {
    return formatError(err)
  }
}

export async function disconnectPins(args: {
  projectId: string
  net?: string
  node?: string
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId || (!args?.net && !args?.node)) {
    return formatError('Missing required parameters: projectId and at least net or node')
  }

  try {
    if (circuitStore.getState().projectId !== projectId) {
      circuitStore.setProject(projectId)
    }
    const res = await circuitStore.disconnectPins(args, 'AI')
    if (!res.success) return formatError(res.error || 'Failed to disconnect pins')
    return formatResult(circuitStore.getState().circuit)
  } catch (err) {
    return formatError(err)
  }
}

// ── 4. Library Tools ─────────────────────────────────────────────────────────

export async function searchComponents(args: { query?: string }): Promise<WebMCPToolResult> {
  try {
    const data = await searchComponentsApi(args?.query || '')
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

interface ComponentLookupArgs {
  library?: string
  part?: string
  symbol?: string
  identifier?: string
  query?: string
}

async function resolveComponentLookup(args: ComponentLookupArgs): Promise<{ library: string; part: string }> {
  const identifier = args?.identifier?.trim()
  if (identifier?.includes(':')) {
    const [library, ...symbolParts] = identifier.split(':')
    const part = symbolParts.join(':').trim()
    if (library.trim() && part) return { library: library.trim(), part }
  }

  const library = args?.library?.trim()
  const part = (args?.symbol || args?.part)?.trim()
  if (library && part) return { library, part }

  const query = (args?.query || args?.part || args?.symbol || identifier || '').trim()
  if (!query) throw new Error('Missing component lookup. Provide identifier, library+symbol, library+part, or query.')

  const search = await searchComponentsApi(query)
  const exact = search.results?.find((result) =>
    result.identifier.toUpperCase() === query.toUpperCase() ||
    result.symbol.toUpperCase() === query.toUpperCase()
  )
  const selected = exact || search.results?.[0]
  if (!selected) throw new Error(`No KiCad component found for '${query}'.`)

  return { library: selected.library, part: selected.symbol }
}

export async function getComponent(args: {
  library?: string
  part?: string
  symbol?: string
  identifier?: string
  query?: string
}): Promise<WebMCPToolResult> {
  try {
    const { library, part } = await resolveComponentLookup(args)
    const data = await getComponentDetailsApi(library, part)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

export async function getComponentPins(args: {
  library?: string
  part?: string
  symbol?: string
  identifier?: string
  query?: string
}): Promise<WebMCPToolResult> {
  try {
    const { library, part } = await resolveComponentLookup(args)
    const data = await getComponentPinsApi(library, part)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

// ── 5. Artifact Tools ────────────────────────────────────────────────────────

export async function listCircuitArtifacts(args: {
  projectId: string
  version?: number
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  if (!projectId) return formatError('Missing required parameter: projectId')
  try {
    const data = await listCircuitArtifactsApi(projectId, args?.version)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

export async function getCircuitArtifact(args: {
  projectId: string
  artifactName: string
  version?: number
}): Promise<WebMCPToolResult> {
  const projectId = args?.projectId?.trim()
  const artifactName = args?.artifactName?.trim()
  if (!projectId || !artifactName) {
    return formatError('Missing required parameters: projectId and artifactName')
  }
  try {
    const data = await getCircuitArtifactApi(projectId, artifactName)
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

// ── 6. Testing & Health ──────────────────────────────────────────────────────

export async function testCircuit(): Promise<WebMCPToolResult> {
  try {
    const data = await testCircuitApi()
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

export async function healthCheck(): Promise<WebMCPToolResult> {
  try {
    const data = await healthCheckApi()
    return formatResult(data)
  } catch (err) {
    return formatError(err)
  }
}

// ── Tool Descriptors ─────────────────────────────────────────────────────────

export const circuitToolDescriptors: WebMCPToolDescriptor[] = [
  {
    name: 'list_projects',
    description: 'List the projects in the workspace along with their circuit status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List projects', readOnlyHint: true },
    execute: () => listProjects(),
  },
  {
    name: 'get_project',
    description: 'Get project details, circuit status, and active version number.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Get project info', readOnlyHint: true },
    execute: (args) => getProject(args as { projectId: string }),
  },
  {
    name: 'generate_circuit',
    description:
      'Generate a new baseline circuit version for a project using SKiDL and KiCad symbol libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        circuit: {
          type: 'object',
          description: 'Optional circuit parameters, e.g. { resistorValue: "330" }',
        },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Generate circuit version', readOnlyHint: false },
    execute: (args) =>
      generateCircuit(args as { projectId: string; circuit?: Record<string, unknown> }),
  },
  {
    name: 'add_component',
    description: 'Add a new component to the active circuit and optionally position it on the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        ref: { type: 'string', description: 'Component reference (e.g. "C1", "R2", "D2")' },
        lib: { type: 'string', description: 'KiCad library name (e.g. "Device", "C", "R", "LED")' },
        part: { type: 'string', description: 'Part name (e.g. "C", "R", "LED", "ESP32-PICO-D4")' },
        value: { type: 'string', description: 'Component value (e.g. "100nF", "10k", "Red")' },
        x: { type: 'number', description: 'Optional canvas X coordinate' },
        y: { type: 'number', description: 'Optional canvas Y coordinate' },
      },
      required: ['projectId', 'ref'],
    },
    annotations: { title: 'Add component', readOnlyHint: false },
    execute: (args) => addComponent(args as Parameters<typeof addComponent>[0]),
  },
  {
    name: 'remove_component',
    description: 'Remove a component from the active circuit and disconnect attached nets.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        ref: { type: 'string', description: 'Component reference to remove (e.g. "C1")' },
      },
      required: ['projectId', 'ref'],
    },
    annotations: { title: 'Remove component', readOnlyHint: false },
    execute: (args) => removeComponent(args as Parameters<typeof removeComponent>[0]),
  },
  {
    name: 'update_component',
    description: 'Update the value or label of an existing component in the circuit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        ref: { type: 'string', description: 'Component reference (e.g. "R1")' },
        value: { type: 'string', description: 'New value (e.g. "470", "10uF")' },
        name: { type: 'string', description: 'Optional new name/label' },
      },
      required: ['projectId', 'ref'],
    },
    annotations: { title: 'Update component', readOnlyHint: false },
    execute: (args) => updateComponent(args as Parameters<typeof updateComponent>[0]),
  },
  {
    name: 'move_component',
    description: 'Reposition a component on the visual canvas and dynamically re-route attached wires.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        ref: { type: 'string', description: 'Component reference (e.g. "C1", "U1")' },
        x: { type: 'number', description: 'Target canvas X position' },
        y: { type: 'number', description: 'Target canvas Y position' },
      },
      required: ['projectId', 'ref', 'x', 'y'],
    },
    annotations: { title: 'Move component position', readOnlyHint: false },
    execute: (args) => moveComponent(args as Parameters<typeof moveComponent>[0]),
  },
  {
    name: 'rotate_component',
    description: 'Rotate a component on the schematic canvas by 90, 180, or 270 degrees (or set an exact angle: 0, 90, 180, 270) and dynamically re-route attached wires.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        ref: { type: 'string', description: 'Component reference (e.g. "R1", "D1", "U1")' },
        deltaDegrees: { type: 'number', description: 'Degrees to rotate clockwise (e.g. 90, 180, -90). Default 90.' },
        angle: { type: 'number', description: 'Target absolute orientation angle (0, 90, 180, 270).' },
      },
      required: ['projectId', 'ref'],
    },
    annotations: { title: 'Rotate component', readOnlyHint: false },
    execute: (args) => rotateComponent(args as Parameters<typeof rotateComponent>[0]),
  },
  {
    name: 'connect_pins',
    description: 'Connect component pins together with an electrical net.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        net: { type: 'string', description: 'Net name (e.g. "3V3", "GND", "GPIO4", "MID2")' },
        fromNode: { type: 'string', description: 'First pin node (e.g. "U1.3V3", "C1.1")' },
        toNode: { type: 'string', description: 'Second pin node (e.g. "C1.1", "C1.2")' },
        nodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of multiple nodes (e.g. ["U1.3V3", "C1.1"])',
        },
      },
      required: ['projectId', 'net'],
    },
    annotations: { title: 'Connect pins / net', readOnlyHint: false },
    execute: (args) => connectPins(args as Parameters<typeof connectPins>[0]),
  },
  {
    name: 'disconnect_pins',
    description: 'Disconnect a pin node or remove an entire net from the circuit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        net: { type: 'string', description: 'Optional net name to clear' },
        node: { type: 'string', description: 'Optional pin node to detach (e.g. "C1.1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Disconnect pin or net', readOnlyHint: false },
    execute: (args) => disconnectPins(args as Parameters<typeof disconnectPins>[0]),
  },
  {
    name: 'get_current_circuit',
    description: 'Retrieve the active circuit definition, components, connections, and manifest.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Get current circuit', readOnlyHint: true },
    execute: (args) => getCurrentCircuit(args as { projectId: string }),
  },
  {
    name: 'get_circuit_version',
    description: 'Retrieve a specific historical circuit version by version number.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        version: { type: 'number', description: 'Version number to retrieve (e.g. 1, 2)' },
      },
      required: ['projectId', 'version'],
    },
    annotations: { title: 'Get circuit version', readOnlyHint: true },
    execute: (args) =>
      getCircuitVersion(args as { projectId: string; version: number }),
  },
  {
    name: 'list_circuit_versions',
    description: 'List all saved circuit versions for a project with summary metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'List circuit versions', readOnlyHint: true },
    execute: (args) => listCircuitVersions(args as { projectId: string }),
  },
  {
    name: 'validate_circuit',
    description: 'Run electrical rules check (ERC) and validate the current circuit for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Validate circuit (ERC)', readOnlyHint: true },
    execute: (args) => validateCircuit(args as { projectId: string }),
  },
  {
    name: 'get_components',
    description: 'List the components (ref, name, value, pins) in the active circuit version.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Get circuit components', readOnlyHint: true },
    execute: (args) => getComponents(args as { projectId: string }),
  },
  {
    name: 'get_connections',
    description: 'List all electrical connections (nets and node connections) in the active circuit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'Get circuit connections', readOnlyHint: true },
    execute: (args) => getConnections(args as { projectId: string }),
  },
  {
    name: 'search_components',
    description: 'Search available KiCad symbol libraries for matching component parts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (e.g. "esp32", "led", "resistor")' },
      },
    },
    annotations: { title: 'Search KiCad components', readOnlyHint: true },
    execute: (args) => searchComponents(args as { query?: string }),
  },
  {
    name: 'get_component',
    description: 'Get detailed metadata for the exact KiCad symbol. Prefer identifier from search_components, e.g. "Library:Symbol".',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Exact search result identifier, e.g. "MCU_Espressif:ESP32-WROOM-32" or "Device:R"' },
        library: { type: 'string', description: 'KiCad library name from search_components, e.g. "MCU_Espressif" or "Device"' },
        symbol: { type: 'string', description: 'KiCad symbol name from search_components, e.g. "ESP32-WROOM-32" or "R"' },
        part: { type: 'string', description: 'Compatibility alias for symbol name.' },
        query: { type: 'string', description: 'Fallback search query if identifier or library+symbol is not known.' },
      },
    },
    annotations: { title: 'Get component details', readOnlyHint: true },
    execute: (args) => getComponent(args as ComponentLookupArgs),
  },
  {
    name: 'get_component_pins',
    description: 'Get the exact pin list for a KiCad symbol. Prefer identifier from search_components, e.g. "Library:Symbol".',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Exact search result identifier, e.g. "MCU_Espressif:ESP32-WROOM-32" or "Device:R"' },
        library: { type: 'string', description: 'KiCad library name from search_components, e.g. "MCU_Espressif" or "Device"' },
        symbol: { type: 'string', description: 'KiCad symbol name from search_components, e.g. "ESP32-WROOM-32" or "R"' },
        part: { type: 'string', description: 'Compatibility alias for symbol name.' },
        query: { type: 'string', description: 'Fallback search query if identifier or library+symbol is not known.' },
      },
    },
    annotations: { title: 'Get component pins', readOnlyHint: true },
    execute: (args) => getComponentPins(args as ComponentLookupArgs),
  },
  {
    name: 'list_circuit_artifacts',
    description: 'List all generated files (netlist, definition, manifest) for a project circuit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        version: { type: 'number', description: 'Optional version number (defaults to current)' },
      },
      required: ['projectId'],
    },
    annotations: { title: 'List circuit artifacts', readOnlyHint: true },
    execute: (args) => listCircuitArtifacts(args as { projectId: string; version?: number }),
  },
  {
    name: 'get_circuit_artifact',
    description: 'Retrieve the content of a specific circuit artifact (e.g. "circuit.net").',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (e.g. "project-1")' },
        artifactName: { type: 'string', description: 'Artifact filename (e.g. "circuit.net", "circuit_definition.json")' },
        version: { type: 'number', description: 'Optional version number (defaults to current)' },
      },
      required: ['projectId', 'artifactName'],
    },
    annotations: { title: 'Get circuit artifact content', readOnlyHint: true },
    execute: (args) =>
      getCircuitArtifact(args as { projectId: string; artifactName: string; version?: number }),
  },
  {
    name: 'test_circuit',
    description: 'Run the baseline SKiDL + KiCad circuit generation test.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Test circuit generation', readOnlyHint: false },
    execute: () => testCircuit(),
  },
  {
    name: 'health_check',
    description: 'Check backend status and KiCad/SKiDL library availability.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Circuit backend health check', readOnlyHint: true },
    execute: () => healthCheck(),
  },
]

/**
 * Registers all circuit & project WebMCP tools.
 */
export function registerCircuitWebMCPTools(): void {
  // Attach dev console hooks
  if (typeof window !== 'undefined') {
    window.__chipWebMCP = {
      ...(window.__chipWebMCP || {}),
      listProjects,
      getProject,
      generateCircuit,
      addComponent,
      removeComponent,
      updateComponent,
      moveComponent,
      rotateComponent,
      connectPins,
      disconnectPins,
      getCurrentCircuit,
      getCircuitVersion,
      listCircuitVersions,
      validateCircuit,
      getComponents,
      getConnections,
      searchComponents,
      getComponent,
      getComponentPins,
      listCircuitArtifacts,
      getCircuitArtifact,
      testCircuit,
      healthCheck,
    } as unknown as typeof window.__chipWebMCP
  }

  const modelContext = typeof document !== 'undefined' ? document.modelContext : undefined
  if (!modelContext) {
    console.info(
      '[WebMCP:Circuit] document.modelContext unavailable — browser WebMCP API is not enabled.',
    )
    return
  }

  circuitToolDescriptors.forEach((tool) => {
    modelContext
      .registerTool(tool)
      .then(() => console.log(`[WebMCP:Circuit] Registered tool: ${tool.name}`))
      .catch((err: unknown) =>
        console.warn(`[WebMCP:Circuit] Failed to register ${tool.name}:`, err),
      )
  })
}
