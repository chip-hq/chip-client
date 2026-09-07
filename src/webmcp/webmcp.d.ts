// Ambient types for the experimental WebMCP browser API (`document.modelContext`).
// Not yet in TypeScript's DOM lib, so we declare the subset CHIP uses. No imports/
// exports here, so this stays global and merges into the built-in `Document`.
// Spec: https://github.com/webmachinelearning/webmcp

interface WebMCPTextContent {
  type: 'text'
  text: string
}

interface WebMCPToolResult {
  content: WebMCPTextContent[]
}

// Advisory MCP-style hints; safely ignored by runtimes that don't read them.
interface WebMCPToolAnnotations {
  title?: string
  readOnlyHint?: boolean
}

interface WebMCPToolCallOptions {
  signal?: AbortSignal
}

interface WebMCPToolDescriptor {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  annotations?: WebMCPToolAnnotations
  execute: (
    args: Record<string, unknown>,
    options?: WebMCPToolCallOptions,
  ) => WebMCPToolResult | Promise<WebMCPToolResult>
}

interface WebMCPRegisterToolOptions {
  signal?: AbortSignal
}

interface ModelContext {
  registerTool(
    tool: WebMCPToolDescriptor,
    options?: WebMCPRegisterToolOptions,
  ): Promise<void>
}

interface Document {
  // Present only in browsers with WebMCP enabled.
  readonly modelContext?: ModelContext
}

// Dev-only console hook set by registerWebMCPTools() for manual testing (stripped from prod).
interface Window {
  __chipWebMCP?: Partial<{
    listDevices: () => Promise<WebMCPToolResult>
    getBoardStatus: () => Promise<WebMCPToolResult>
    readSerialLogs: (args?: { limit?: number }) => Promise<WebMCPToolResult>
    readJobStatus: () => Promise<WebMCPToolResult>
    readDashboardState: () => Promise<WebMCPToolResult>
    postAgentMessage: (args?: { message?: string }) => Promise<WebMCPToolResult>
    setAgentNote: (args?: { note?: string }) => Promise<WebMCPToolResult>
    requestUserAction: (args?: { action?: string; reason?: string; details?: string }) => Promise<WebMCPToolResult>
    eraseBoard: () => Promise<WebMCPToolResult>
    // Curated Circuit & Project WebMCP tools
    listProjects: () => Promise<WebMCPToolResult>
    getProject: (args: { projectId: string }) => Promise<WebMCPToolResult>
    generateCircuit: (args: { projectId: string; circuit?: Record<string, unknown> }) => Promise<WebMCPToolResult>
    addComponent: (args: { projectId: string; ref: string; lib?: string; part?: string; name?: string; value?: string; x?: number; y?: number }) => Promise<WebMCPToolResult>
    removeComponent: (args: { projectId: string; ref: string }) => Promise<WebMCPToolResult>
    updateComponent: (args: { projectId: string; ref: string; value?: string; name?: string }) => Promise<WebMCPToolResult>
    moveComponent: (args: { projectId: string; ref: string; x: number; y: number }) => Promise<WebMCPToolResult>
    rotateComponent: (args: { projectId: string; ref: string; deltaDegrees?: number; angle?: 0 | 90 | 180 | 270 }) => Promise<WebMCPToolResult>
    connectPins: (args: { projectId: string; net: string; fromNode?: string; toNode?: string; nodes?: string[] }) => Promise<WebMCPToolResult>
    disconnectPins: (args: { projectId: string; net?: string; node?: string }) => Promise<WebMCPToolResult>
    getCurrentCircuit: (args: { projectId: string }) => Promise<WebMCPToolResult>
    getCircuitVersion: (args: { projectId: string; version: number }) => Promise<WebMCPToolResult>
    listCircuitVersions: (args: { projectId: string }) => Promise<WebMCPToolResult>
    validateCircuit: (args: { projectId: string }) => Promise<WebMCPToolResult>
    getComponents: (args: { projectId: string }) => Promise<WebMCPToolResult>
    getConnections: (args: { projectId: string }) => Promise<WebMCPToolResult>
    searchComponents: (args?: { query?: string }) => Promise<WebMCPToolResult>
    getComponent: (args: { identifier?: string; library?: string; symbol?: string; part?: string; query?: string }) => Promise<WebMCPToolResult>
    getComponentPins: (args: { identifier?: string; library?: string; symbol?: string; part?: string; query?: string }) => Promise<WebMCPToolResult>
    listCircuitArtifacts: (args: { projectId: string; version?: number }) => Promise<WebMCPToolResult>
    getCircuitArtifact: (args: { projectId: string; artifactName: string; version?: number }) => Promise<WebMCPToolResult>
    testCircuit: () => Promise<WebMCPToolResult>
    healthCheck: () => Promise<WebMCPToolResult>
  }>
}
