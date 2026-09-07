/**
 * Chip Client — Circuit API Layer
 * Direct typed HTTP communication with backend circuit endpoints with UID/Bearer token scoping.
 */

import type {
  CircuitDefinition,
  CircuitManifest,
  CircuitVersionSummary,
  ComponentSearchResult,
  ComponentDetails,
} from './types'
import { auth } from '../components/firebase'

export function getBackendUrl(): string {
  const url = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'
  return url.replace(/\/+$/, '')
}

export interface CatalogSearchIndex {
  components: ComponentSearchResult[]
}

export interface CatalogComponent extends ComponentSearchResult {
  id: string
  displayName: string
  referencePrefix: string
  datasheet?: string
  footprint?: string
  footprintFilters?: string[]
  pins: ComponentDetails['pins']
  verification?: unknown
}

export async function getCatalogSearchIndex(): Promise<CatalogSearchIndex> {
  return { components: [] }
}

export async function getCatalogLibrary(_file?: string): Promise<{ components: CatalogComponent[] }> {
  return { components: [] }
}

async function findCatalogComponent(library: string, part: string): Promise<CatalogComponent | null> {
  if (!part) return null
  const index = await getCatalogSearchIndex()
  const cleanPart = part.trim().toUpperCase()
  const cleanLib = library.trim().toUpperCase()
  const exactId = cleanLib ? `${cleanLib}:${cleanPart}` : cleanPart

  // 1. Exact ID match (e.g. "RF_MODULE:ESP32-WROOM-32")
  let indexed = index.components.find((c) =>
    (c.identifier || `${c.library}:${c.symbol}`).toUpperCase() === exactId
  )

  // 2. Exact symbol or display name match
  if (!indexed) {
    indexed = index.components.find((c) =>
      c.symbol.toUpperCase() === cleanPart || c.displayName?.toUpperCase() === cleanPart
    )
  }

  // 3. Fallback: normalized prefix/substring match (e.g. ESP32-WROOM-32)
  if (!indexed && cleanPart.length > 3) {
    indexed = index.components.find((c) => {
      const sym = c.symbol.toUpperCase()
      return sym.includes(cleanPart) || cleanPart.includes(sym)
    })
  }

  if (!indexed?.file) return null

  const catalogLibrary = await getCatalogLibrary(indexed.file)
  return (
    catalogLibrary.components.find(
      (component) =>
        component.id.toUpperCase() === `${indexed!.library}:${indexed!.symbol}`.toUpperCase() ||
        component.symbol.toUpperCase() === indexed!.symbol.toUpperCase()
    ) || null
  )
}

function getDisplayPinNameOverrides(component: CatalogComponent): Record<string, string> {
  if (!component.verification || typeof component.verification !== 'object') return {}
  const overrides = (component.verification as { displayPinNameOverrides?: unknown }).displayPinNameOverrides
  return overrides && typeof overrides === 'object' ? (overrides as Record<string, string>) : {}
}

function getCatalogPins(component: CatalogComponent): ComponentDetails['pins'] {
  const overrides = getDisplayPinNameOverrides(component)
  return component.pins.map((pin) => ({
    ...pin,
    name: overrides[pin.num] || pin.name,
  }))
}

/** Hydrates components in a circuit definition with real KiCad catalog pin metadata */
export async function hydrateCircuitComponents(circuit: CircuitDefinition | null): Promise<CircuitDefinition | null> {
  if (!circuit || !Array.isArray(circuit.components)) return circuit

  const enrichedComponents = await Promise.all(
    circuit.components.map(async (comp) => {
      // If already has enriched pins with names, return as-is
      if (
        Array.isArray(comp.pins) &&
        comp.pins.length > 0 &&
        typeof comp.pins[0] === 'object' &&
        Boolean((comp.pins[0] as { name?: string }).name)
      ) {
        return comp
      }

      const partCandidates = [
        comp.name,
        comp.value,
        comp.lib,
        comp.ref,
      ].filter((x): x is string => Boolean(x && typeof x === 'string'))

      let catalogComp: CatalogComponent | null = null
      for (const part of partCandidates) {
        catalogComp = await findCatalogComponent(comp.lib || '', part).catch(() => null)
        if (catalogComp) break
      }

      if (catalogComp && Array.isArray(catalogComp.pins) && catalogComp.pins.length > 0) {
        return {
          ...comp,
          kind: catalogComp.kind || comp.kind,
          footprint: catalogComp.footprint || comp.footprint,
          pinCount: catalogComp.pins.length,
          pins: getCatalogPins(catalogComp),
        }
      }

      return comp
    })
  )

  return {
    ...circuit,
    components: enrichedComponents,
  }
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  try {
    const user = auth.currentUser
    if (user) {
      headers['x-user-id'] = user.uid
      const token = await user.getIdToken().catch(() => null)
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }
  } catch {
    // Ignore in unauthenticated environments
  }

  return fetch(url, { ...options, headers })
}

/** 1. List projects */
export async function listProjectsApi(): Promise<{
  count: number
  projects: Array<{
    projectId: string
    name: string
    description?: string
    mcu?: string
    currentVersion: number
    hasCircuit: boolean
    updatedAt: string | null
  }>
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects`)
  return res.json()
}

/** 1b. Create project */
export async function createProjectApi(params: {
  name: string
  description?: string
  mcu?: string
}): Promise<{
  success: boolean
  project: {
    id: string
    projectId: string
    name: string
    description: string
    mcu: string
    userId: string
    createdAt: string
    updatedAt: string
  }
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
  return res.json()
}

/** 2. Get project info */
export async function getProjectApi(projectId: string): Promise<{ projectId: string; exists: boolean; currentVersion: number; hasCircuit: boolean; updatedAt: string | null }> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}`)
  return res.json()
}

/** 2b. Delete project */
export async function deleteProjectApi(projectId: string): Promise<{ success: boolean; projectId?: string; message?: string }> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  })
  return res.json()
}

/** 2c. Delete all projects */
export async function deleteAllProjectsApi(): Promise<{ success: boolean; message?: string }> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects`, {
    method: 'DELETE',
  })
  return res.json()
}

/** 3. Generate circuit version */
export async function generateCircuitApi(
  projectId: string,
  params?: { resistorValue?: string; [key: string]: unknown }
): Promise<{
  projectId: string
  version: number
  currentVersion: number
  success: boolean
  components: unknown[]
  connections: unknown[]
  ercErrors: string[]
  ercWarnings: string[]
  artifacts: Record<string, string>
  generatedAt: string
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/generate`,
    {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }
  )
  return res.json()
}

/** 4. Get active circuit */
export async function getCurrentCircuitApi(projectId: string): Promise<{
  projectId: string
  currentVersion: number
  manifest: CircuitManifest
  definition: CircuitDefinition
  artifacts: Record<string, string>
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit`)
  return res.json()
}

/** 5. Get specific circuit version */
export async function getCircuitVersionApi(projectId: string, version: number): Promise<{
  projectId: string
  version: number
  versionTag: string
  isCurrent: boolean
  manifest: CircuitManifest
  definition: CircuitDefinition
  artifacts: Record<string, string>
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/versions/${encodeURIComponent(version)}`
  )
  return res.json()
}

/** 6. List all circuit versions */
export async function listCircuitVersionsApi(projectId: string): Promise<{
  projectId: string
  currentVersion: number
  count: number
  versions: CircuitVersionSummary[]
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/versions`
  )
  return res.json()
}

/** 7. Validate circuit (ERC) */
export async function validateCircuitApi(projectId: string): Promise<{
  projectId: string
  version: number
  valid: boolean
  ercErrors: string[]
  ercWarnings: string[]
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/validate`,
    { method: 'POST' }
  )
  return res.json()
}

/** 8. Get components for current circuit */
export async function getComponentsApi(projectId: string): Promise<{
  projectId: string
  version: number
  components: CircuitDefinition['components']
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/components`
  )
  return res.json()
}

/** 9. Get connections for current circuit */
export async function getConnectionsApi(projectId: string): Promise<{
  projectId: string
  version: number
  connections: CircuitDefinition['connections']
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/connections`
  )
  return res.json()
}

/** 10. Search KiCad components */
export async function searchComponentsApi(query = ''): Promise<{
  success: boolean
  query: string
  count: number
  results: ComponentSearchResult[]
}> {
  const index = await getCatalogSearchIndex()
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const scored = index.components
    .map((component) => {
      const identifier = component.identifier || `${component.library}:${component.symbol}`
      const haystack = `${identifier} ${component.displayName || ''} ${component.description || ''} ${component.keywords || ''} ${component.kind || ''}`.toLowerCase()
      const score = terms.length === 0
        ? 1
        : terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
      return { component, identifier, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.identifier.localeCompare(b.identifier))
    .slice(0, 100)

  return {
    success: true,
    query,
    count: scored.length,
    results: scored.map(({ component, identifier }) => ({ ...component, identifier })),
  }
}

/** 11. Get component details */
export async function getComponentDetailsApi(library: string, part: string): Promise<ComponentDetails> {
  const component = await findCatalogComponent(library, part)
  if (!component) {
    return {
      success: false,
      library,
      part,
      pinCount: 0,
      pins: [],
      error: `Component ${library}:${part} was not found in the local KiCad catalog.`,
    }
  }

  return {
    success: true,
    library: component.library,
    part: component.symbol,
    displayName: component.displayName,
    refPrefix: component.referencePrefix,
    description: component.description,
    keywords: component.keywords,
    kind: component.kind,
    renderer: component.renderer,
    footprint: component.footprint,
    footprintFilters: component.footprintFilters,
    verification: component.verification,
    pinCount: component.pinCount || component.pins.length,
    pins: getCatalogPins(component),
  }
}

/** 12. Get component pins */
export async function getComponentPinsApi(library: string, part: string): Promise<{
  library: string
  part: string
  pinCount: number
  pins: ComponentDetails['pins']
}> {
  const component = await findCatalogComponent(library, part)
  return {
    library: component?.library || library,
    part: component?.symbol || part,
    pinCount: component?.pinCount || 0,
    pins: component ? getCatalogPins(component) : [],
  }
}

/** 13. List artifacts for project circuit */
export async function listCircuitArtifactsApi(projectId: string, version?: number): Promise<{
  projectId: string
  version: number
  count: number
  artifacts: Array<{ name: string; relativePath: string; url: string }>
}> {
  const vParam = version ? `?version=${version}` : ''
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/artifacts${vParam}`
  )
  return res.json()
}

/** 14. Download circuit artifact (returns URL string) */
export function getCircuitArtifactUrl(projectId: string, artifactPath: string): string {
  return `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/artifacts/${encodeURIComponent(artifactPath)}`
}

/** 14b. Download circuit artifact (async fetch, returns text content) */
export async function getCircuitArtifactApi(projectId: string, artifactPath: string): Promise<string> {
  const res = await fetchWithAuth(getCircuitArtifactUrl(projectId, artifactPath))
  return res.text()
}


/** 15. Check circuit environment health */
export async function healthCheckApi(): Promise<{
  status: string
  pythonAvailable: boolean
  skidlAvailable: boolean
  symbolDirValid: boolean
  symbolDir: string
  librariesAvailable: number
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/circuit/status`)
  return res.json()
}

/** 16. Step 2 Test (Part load test) */
export async function testCircuitApi(lib = 'Device', part = 'R'): Promise<{
  status: string
  lib: string
  part: string
  componentLoaded: boolean
  pinCount?: number
  pins?: unknown[]
  error?: string
}> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/circuit/test?lib=${encodeURIComponent(lib)}&part=${encodeURIComponent(part)}`
  )
  return res.json()
}

/** 17. Step 3 Test (Full LED circuit test) */
export async function testLedCircuitApi(): Promise<{
  status: string
  circuitCompiled: boolean
  netlistGenerated: boolean
  ercErrors?: string[]
  netlistSnippet?: string
  error?: string
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/circuit/test-led-circuit`, {
    method: 'POST',
  })
  return res.json()
}

type IncrementalResult = { success: boolean; version?: number; error?: string }

/** 18. Add component to current circuit */
export async function addComponentApi(
  projectId: string,
  params: { ref: string; lib?: string; part?: string; name?: string; value?: string; x?: number; y?: number }
): Promise<IncrementalResult> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/components`,
    { method: 'POST', body: JSON.stringify(params) }
  )
  return res.json()
}

/** 19. Remove component from current circuit */
export async function removeComponentApi(
  projectId: string,
  ref: string
): Promise<IncrementalResult> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/components/${encodeURIComponent(ref)}`,
    { method: 'DELETE' }
  )
  return res.json()
}

/** 20. Update a component in the current circuit */
export async function updateComponentApi(
  projectId: string,
  ref: string,
  params: { value?: string; name?: string }
): Promise<IncrementalResult> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/components/${encodeURIComponent(ref)}`,
    { method: 'PATCH', body: JSON.stringify(params) }
  )
  return res.json()
}

/** 21. Connect pins / add net */
export async function connectPinsApi(
  projectId: string,
  params: { net: string; fromNode?: string; toNode?: string; nodes?: string[] }
): Promise<IncrementalResult> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/connections`,
    { method: 'POST', body: JSON.stringify(params) }
  )
  return res.json()
}

/** 22. Disconnect pins / remove net or node */
export async function disconnectPinsApi(
  projectId: string,
  params: { net?: string; node?: string }
): Promise<IncrementalResult> {
  const res = await fetchWithAuth(
    `${getBackendUrl()}/api/projects/${encodeURIComponent(projectId)}/circuit/connections/disconnect`,
    { method: 'POST', body: JSON.stringify(params) }
  )
  return res.json()
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CircuitActionResult {
  tool: string
  args: Record<string, unknown>
  description: string
}

export interface CircuitChatResponse {
  success: boolean
  reply: string
  actions: CircuitActionResult[]
  newVersion?: number
  model?: string
  error?: string
  circuit?: CircuitDefinition
}

/** 23. Chat & Prompt AI to automate circuit creation */
export async function circuitChatApi(params: {
  projectId: string
  message: string
  history?: ChatMessage[]
  model?: string
}): Promise<CircuitChatResponse> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/circuit/chat`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
  return res.json()
}

/** 24. Get supported AI models */
export async function fetchCircuitModelsApi(): Promise<{
  models: Array<{ id: string; name: string; units: number }>
}> {
  const res = await fetchWithAuth(`${getBackendUrl()}/api/circuit/models`)
  return res.json()
}

