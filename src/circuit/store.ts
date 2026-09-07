/**
 * Chip Client — Reactive Circuit State Store
 * Central source of truth connecting WebMCP actions, backend APIs, and the UI canvas.
 */

import { useSyncExternalStore } from 'react'
import type { CircuitDefinition, CircuitComponent, CircuitVersionSummary } from './types'
import type { Point } from './layout'
import {
  getCurrentCircuitApi,
  getCircuitVersionApi,
  listCircuitVersionsApi,
  generateCircuitApi,
  validateCircuitApi,
  testCircuitApi,
  addComponentApi,
  removeComponentApi,
  updateComponentApi,
  connectPinsApi,
  disconnectPinsApi,
  hydrateCircuitComponents,
} from './api'

export interface ActivityEntry {
  id: string
  timestamp: Date
  text: string
  type: 'info' | 'success' | 'warning' | 'error'
}

export interface CircuitState {
  projectId: string
  circuit: CircuitDefinition | null
  versions: CircuitVersionSummary[]
  currentVersion: number
  selectedVersion: number
  selectedComponent: CircuitComponent | null
  selectedNet: string | null
  layoutPositions: Record<string, Point>
  layoutRotations: Record<string, 0 | 90 | 180 | 270>
  loading: boolean
  generating: boolean
  error: string | null
  activities: ActivityEntry[]
  canUndo: boolean
  canRedo: boolean
}

const LAYOUT_STORAGE_KEY_PREFIX = 'chip_circuit_layout_'
const ROTATION_STORAGE_KEY_PREFIX = 'chip_circuit_rotations_'

function getStoredLayout(projectId: string): Record<string, Point> {
  try {
    const raw = localStorage.getItem(`${LAYOUT_STORAGE_KEY_PREFIX}${projectId}`)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStoredLayout(projectId: string, positions: Record<string, Point>): void {
  try {
    localStorage.setItem(`${LAYOUT_STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(positions))
  } catch {
    // Ignore storage quota errors
  }
}

function getStoredRotations(projectId: string): Record<string, 0 | 90 | 180 | 270> {
  try {
    const raw = localStorage.getItem(`${ROTATION_STORAGE_KEY_PREFIX}${projectId}`)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStoredRotations(projectId: string, rotations: Record<string, 0 | 90 | 180 | 270>): void {
  try {
    localStorage.setItem(`${ROTATION_STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(rotations))
  } catch {
    // Ignore storage quota errors
  }
}

interface LayoutSnapshot {
  positions: Record<string, Point>
  rotations: Record<string, 0 | 90 | 180 | 270>
}

class CircuitStore {
  private layoutUndoStack: LayoutSnapshot[] = []
  private layoutRedoStack: LayoutSnapshot[] = []

  private state: CircuitState = {
    projectId: '',
    circuit: null,
    versions: [],
    currentVersion: 0,
    selectedVersion: 0,
    selectedComponent: null,
    selectedNet: null,
    layoutPositions: {},
    layoutRotations: {},
    loading: false,
    generating: false,
    error: null,
    activities: [],
    canUndo: false,
    canRedo: false,
  }


  private listeners = new Set<() => void>()

  public getState(): CircuitState {
    return this.state
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.listeners.forEach((l) => l())
  }

  private setState(partial: Partial<CircuitState>): void {
    this.state = { ...this.state, ...partial }
    this.emit()
  }

  public logActivity(text: string, type: ActivityEntry['type'] = 'info'): void {
    const entry: ActivityEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date(),
      text,
      type,
    }
    this.setState({
      activities: [entry, ...this.state.activities.slice(0, 24)],
    })
  }

  public setProject(projectId: string): void {
    if (!projectId) {
      this.clearProject()
      return
    }
    if (this.state.projectId === projectId) return
    const storedPositions = getStoredLayout(projectId)
    const storedRotations = getStoredRotations(projectId)
    this.setState({
      projectId,
      circuit: null,
      versions: [],
      selectedComponent: null,
      layoutPositions: storedPositions,
      layoutRotations: storedRotations,
    })
    this.loadProjectCircuit(projectId)
  }

  public clearProject(): void {
    this.setState({
      projectId: '',
      circuit: null,
      versions: [],
      currentVersion: 0,
      selectedVersion: 0,
      selectedComponent: null,
      selectedNet: null,
      layoutPositions: {},
      layoutRotations: {},
      loading: false,
      generating: false,
      error: null,
      canUndo: false,
      canRedo: false,
    })
    this.layoutUndoStack = []
    this.layoutRedoStack = []
  }

  public selectComponent(comp: CircuitComponent | null): void {
    this.setState({ selectedComponent: comp, selectedNet: null })
  }

  public selectNet(net: string | null): void {
    this.setState({ selectedNet: net, selectedComponent: null })
  }

  /**
   * Loads circuit and version list from the backend.
   */
  public async loadProjectCircuit(
    projectId: string = this.state.projectId,
    versionNumber?: number,
    silent: boolean = false
  ): Promise<void> {
    if (!projectId) return  // no project selected yet
    if (!silent) {
      this.setState({ loading: true, error: null })
    }

    try {
      const vList = await listCircuitVersionsApi(projectId).catch(() => ({
        count: 0,
        currentVersion: 0,
        versions: [],
      }))

      const curVer = vList?.currentVersion ?? 0
      const count = vList?.count ?? 0

      // No circuit versions yet — this is a fresh project, don't try to fetch
      if (count === 0 || curVer === 0) {
        this.setState({
          projectId,
          versions: [],
          currentVersion: 0,
          selectedVersion: 0,
          circuit: null,
          loading: false,
        })
        return
      }

      const targetVer = versionNumber || curVer

      // If silently polling and version haven't changed, skip heavy reload
      if (
        silent &&
        curVer === this.state.currentVersion &&
        targetVer === this.state.selectedVersion &&
        this.state.circuit !== null
      ) {
        return
      }

      const data = await getCircuitVersionApi(projectId, targetVer).catch(() =>
        getCurrentCircuitApi(projectId).catch(() => null)
      )

      const rawCircuit = data?.definition || null
      const circuit = await hydrateCircuitComponents(rawCircuit)

      const canUndo = targetVer > 1 || this.layoutUndoStack.length > 0
      const canRedo = targetVer < curVer || this.layoutRedoStack.length > 0

      this.setState({
        projectId,
        versions: vList?.versions || [],
        currentVersion: curVer,
        selectedVersion: targetVer,
        circuit,
        loading: false,
        canUndo,
        canRedo,
      })
    } catch (err: unknown) {
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err)
        this.setState({ loading: false, error: msg })
        this.logActivity(`Error loading circuit: ${msg}`, 'error')
      }
    }
  }


  /**
   * Selects and loads a historical version.
   */
  public async selectVersion(versionNumber: number): Promise<void> {
    this.logActivity(`Switched to version v${versionNumber}`, 'info')
    await this.loadProjectCircuit(this.state.projectId, versionNumber)
  }

  /**
   * Visual Layout: Reposition a component in client state immediately with undo support.
   */
  public moveComponent(ref: string, x: number, y: number, source: 'UI' | 'AI' = 'UI'): void {
    const current = this.state.layoutPositions[ref]
    if (current && current.x === x && current.y === y) return

    // Save previous snapshot for layout undo
    this.layoutUndoStack.push({
      positions: { ...this.state.layoutPositions },
      rotations: { ...this.state.layoutRotations },
    })
    if (this.layoutUndoStack.length > 40) this.layoutUndoStack.shift()
    this.layoutRedoStack = []

    const updatedPositions = {
      ...this.state.layoutPositions,
      [ref]: { x, y },
    }
    saveStoredLayout(this.state.projectId, updatedPositions)
    this.setState({
      layoutPositions: updatedPositions,
      canUndo: true,
      canRedo: this.state.selectedVersion < this.state.currentVersion,
    })
    if (source === 'AI') {
      this.logActivity(`AI: Moved ${ref} to (${x}, ${y})`, 'info')
    }
  }

  /**
   * Move / set position of a component in client state.
   */
  public setComponentPosition(ref: string, x: number, y: number, source: 'UI' | 'AI' = 'UI'): void {
    this.moveComponent(ref, x, y, source)
  }

  /**
   * Commit all settled component positions so they never shift when another component is adjusted.
   */
  public setLayoutPositions(positions: Record<string, Point>): void {
    saveStoredLayout(this.state.projectId, positions)
    this.setState({ layoutPositions: positions })
  }

  /**
   * Visual Layout: Rotate a component in 90° increments with undo support and persistence.
   */
  public rotateComponent(ref: string, deltaDegrees: number = 90, source: 'UI' | 'AI' = 'UI'): void {
    const currentRot = this.state.layoutRotations[ref] ?? (this.state.circuit?.components.find((c) => c.ref === ref)?.rotation ?? 0)
    const newRot = ((((currentRot + deltaDegrees) % 360) + 360) % 360) as 0 | 90 | 180 | 270
    if (newRot === currentRot) return

    // Save previous snapshot for layout undo
    this.layoutUndoStack.push({
      positions: { ...this.state.layoutPositions },
      rotations: { ...this.state.layoutRotations },
    })
    if (this.layoutUndoStack.length > 40) this.layoutUndoStack.shift()
    this.layoutRedoStack = []

    const updatedRotations = {
      ...this.state.layoutRotations,
      [ref]: newRot,
    }
    saveStoredRotations(this.state.projectId, updatedRotations)

    let selectedComponent = this.state.selectedComponent
    if (selectedComponent && selectedComponent.ref === ref) {
      selectedComponent = { ...selectedComponent, rotation: newRot }
    }

    this.setState({
      layoutRotations: updatedRotations,
      selectedComponent,
      canUndo: true,
      canRedo: this.state.selectedVersion < this.state.currentVersion,
    })
    this.logActivity(`${source}: Rotated ${ref} to ${newRot}°`, 'info')
  }

  /**
   * Undo the last action (reverts layout movement/rotation or steps back in circuit version).
   */
  public async undo(): Promise<void> {
    if (this.state.loading || this.state.generating) return

    // 1. If layout changes exist on the layout undo stack, revert them first
    if (this.layoutUndoStack.length > 0) {
      const prev = this.layoutUndoStack.pop()!
      this.layoutRedoStack.push({
        positions: { ...this.state.layoutPositions },
        rotations: { ...this.state.layoutRotations },
      })
      saveStoredLayout(this.state.projectId, prev.positions)
      saveStoredRotations(this.state.projectId, prev.rotations)
      this.setState({
        layoutPositions: prev.positions,
        layoutRotations: prev.rotations,
        canUndo: this.state.selectedVersion > 1 || this.layoutUndoStack.length > 0,
        canRedo: true,
      })
      this.logActivity('Undo: Reverted layout change', 'info')
      return
    }

    // 2. Otherwise revert circuit version
    if (this.state.selectedVersion > 1) {
      const prevVer = this.state.selectedVersion - 1
      this.logActivity(`Undo: Stepped back to version v${prevVer}`, 'info')
      await this.loadProjectCircuit(this.state.projectId, prevVer)
    }
  }

  /**
   * Redo the last undone action (restores layout movement/rotation or advances in circuit version).
   */
  public async redo(): Promise<void> {
    if (this.state.loading || this.state.generating) return

    // 1. If layout changes exist on redo stack, restore them
    if (this.layoutRedoStack.length > 0) {
      const next = this.layoutRedoStack.pop()!
      this.layoutUndoStack.push({
        positions: { ...this.state.layoutPositions },
        rotations: { ...this.state.layoutRotations },
      })
      saveStoredLayout(this.state.projectId, next.positions)
      saveStoredRotations(this.state.projectId, next.rotations)
      this.setState({
        layoutPositions: next.positions,
        layoutRotations: next.rotations,
        canUndo: true,
        canRedo: this.state.selectedVersion < this.state.currentVersion || this.layoutRedoStack.length > 0,
      })
      this.logActivity('Redo: Restored layout change', 'info')
      return
    }

    // 2. Otherwise advance circuit version
    if (this.state.selectedVersion < this.state.currentVersion) {
      const nextVer = this.state.selectedVersion + 1
      this.logActivity(`Redo: Advanced to version v${nextVer}`, 'info')
      await this.loadProjectCircuit(this.state.projectId, nextVer)
    }
  }

  /**
   * Rename a net/wire in the circuit.
   */
  public async renameNet(
    oldNet: string,
    newNet: string,
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    const circuit = this.state.circuit
    const cleanOld = (oldNet || '').trim()
    const cleanNew = (newNet || '').trim().toUpperCase()

    if (!cleanOld || !cleanNew || cleanOld.toUpperCase() === cleanNew) {
      return { success: false, error: 'Enter a new, unique net name' }
    }

    const conn = circuit?.connections?.find((c) => c.net.toUpperCase() === cleanOld.toUpperCase())
    if (!conn) {
      return { success: false, error: `Net "${cleanOld}" not found` }
    }

    const nodes = [...conn.nodes]
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Renaming net ${cleanOld} -> ${cleanNew}...`, 'info')

    try {
      await disconnectPinsApi(pId, { net: cleanOld })
      const res = await connectPinsApi(pId, { net: cleanNew, nodes })
      if (res && res.success) {
        this.logActivity(`${source}: Renamed net ${cleanOld} to ${cleanNew} — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.selectNet(cleanNew)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = `Failed to rename net ${cleanOld}`
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Rename net failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Incremental: Add a component.
   */
  public async addComponent(
    params: { ref: string; lib?: string; part?: string; name?: string; value?: string; x?: number; y?: number },
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Adding component ${params.ref} (${params.part || params.lib || 'Part'})...`, 'info')

    try {
      const res = await addComponentApi(pId, params)
      if (res && res.success) {
        if (params.x !== undefined && params.y !== undefined) {
          this.moveComponent(params.ref, params.x, params.y, source)
        }
        this.logActivity(`${source}: Added component ${params.ref} — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = 'Failed to add component on backend'
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Add component failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Incremental: Remove a component.
   */
  public async removeComponent(
    ref: string,
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Removing component ${ref}...`, 'info')

    try {
      const res = await removeComponentApi(pId, ref)
      if (res && res.success) {
        const updatedPos = { ...this.state.layoutPositions }
        delete updatedPos[ref]
        saveStoredLayout(pId, updatedPos)

        const updatedRot = { ...this.state.layoutRotations }
        delete updatedRot[ref]
        saveStoredRotations(pId, updatedRot)

        this.setState({ layoutPositions: updatedPos, layoutRotations: updatedRot })

        this.logActivity(`${source}: Removed component ${ref} — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = `Failed to remove ${ref}`
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Remove failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Incremental: Update a component.
   */
  public async updateComponent(
    ref: string,
    params: { value?: string; name?: string },
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Updating component ${ref}...`, 'info')

    try {
      const res = await updateComponentApi(pId, ref, params)
      if (res && res.success) {
        this.logActivity(`${source}: Updated ${ref} (val=${params.value || 'unchanged'}) — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = `Failed to update ${ref}`
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Update failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Incremental: Connect pins.
   */
  public async connectPins(
    params: { net: string; fromNode?: string; toNode?: string; nodes?: string[] },
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Connecting net ${params.net}...`, 'info')

    try {
      const res = await connectPinsApi(pId, params)
      if (res && res.success) {
        this.logActivity(`${source}: Connected net ${params.net} — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = `Failed to connect net ${params.net}`
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Connect failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Incremental: Disconnect pins.
   */
  public async disconnectPins(
    params: { net?: string; node?: string },
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(`${source}: Disconnecting ${params.node || params.net}...`, 'info')

    try {
      const res = await disconnectPinsApi(pId, params)
      if (res && res.success) {
        this.logActivity(`${source}: Disconnected ${params.node || params.net} — version ${res.version}`, 'success')
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = 'Failed to disconnect pin'
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Disconnect failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Generates a new baseline circuit version via backend.
   */
  public async generateCircuit(
    params?: { resistorValue?: string; [key: string]: unknown },
    source: 'UI' | 'AI' = 'UI'
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const pId = this.state.projectId
    this.setState({ generating: true, error: null })
    this.logActivity(
      `${source}: Generating circuit${params?.resistorValue ? ` with R=${params.resistorValue}Ω` : ''}...`,
      'info'
    )

    try {
      const res = await generateCircuitApi(pId, params)
      if (res && res.success) {
        this.logActivity(
          `${source}: Circuit generated successfully — version ${res.version}`,
          'success'
        )
        await this.loadProjectCircuit(pId, res.version)
        this.setState({ generating: false })
        return { success: true, version: res.version }
      } else {
        const errMsg = 'Circuit generation failed on backend'
        this.setState({ generating: false, error: errMsg })
        this.logActivity(`${source}: ${errMsg}`, 'error')
        return { success: false, error: errMsg }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ generating: false, error: msg })
      this.logActivity(`${source}: Generation failed — ${msg}`, 'error')
      return { success: false, error: msg }
    }
  }

  /**
   * Validates active circuit (ERC).
   */
  public async validateCircuit(source: 'UI' | 'AI' = 'UI'): Promise<boolean> {
    const pId = this.state.projectId
    this.logActivity(`${source}: Validating circuit (ERC)...`, 'info')
    try {
      const res = await validateCircuitApi(pId)
      if (res && res.valid) {
        this.logActivity(`${source}: Circuit valid (0 ERC errors)`, 'success')
        return true
      } else {
        const errorCount = res?.ercErrors?.length || 1
        this.logActivity(`${source}: Circuit has ${errorCount} ERC error(s)`, 'warning')
        return false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logActivity(`${source}: Validation failed — ${msg}`, 'error')
      return false
    }
  }

  /**
   * Runs baseline test circuit.
   */
  public async runTest(): Promise<void> {
    this.setState({ generating: true })
    this.logActivity('Running circuit validation & component tests...', 'info')
    try {
      const res = await testCircuitApi('Device', 'R')
      if (res && res.status === 'ok' && res.componentLoaded) {
        this.logActivity('Baseline test passed! Reloading project...', 'success')
        await this.loadProjectCircuit()
      } else {
        // Fallback to active circuit ERC validation
        const ercOk = await this.validateCircuit('UI')
        if (ercOk) {
          this.logActivity('Circuit electrical connections verified successfully (0 ERC errors).', 'success')
        } else {
          this.logActivity(
            `Baseline runner note: Use "Validate (ERC)" for schematic verification.`,
            'info'
          )
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logActivity(`Baseline test note: ${msg}`, 'warning')
    } finally {
      this.setState({ generating: false })
    }
  }

}

export const circuitStore = new CircuitStore()

/**
 * React hook subscribing to live reactive circuit state.
 */
export function useCircuitStore(): CircuitState {
  return useSyncExternalStore(
    circuitStore.subscribe,
    circuitStore.getState.bind(circuitStore)
  )
}
