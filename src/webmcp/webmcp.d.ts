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
  __chipWebMCP?: {
    listDevices: () => Promise<WebMCPToolResult>
    getBoardStatus: () => Promise<WebMCPToolResult>
    readSerialLogs: (args?: { limit?: number }) => Promise<WebMCPToolResult>
    readJobStatus: () => Promise<WebMCPToolResult>
    readDashboardState: () => Promise<WebMCPToolResult>
  }
}
