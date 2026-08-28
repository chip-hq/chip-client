// WebMCP tool registration for the CHIP client — exposes browser-side state to
// WebMCP-aware agents via the experimental `document.modelContext` API (types in webmcp.d.ts).
// Local testing: enable chrome://flags/#enable-webmcp-testing and relaunch Chrome.

export interface ChipDevice {
  deviceId: string
  chip: string | null // detected chip, e.g. "ESP32-S3"; null before detection
  connected: boolean
  status: string // idle | connecting | connected | flashing | done | error
  baud: number
  transport: 'web-serial'
}

export interface ActiveJobSnapshot {
  jobId: string
  phase: string
  status: string
  progress: number
  log: string[]
}

export interface DashboardSnapshot {
  devices: ChipDevice[]
  serialLogs: string[]
  activeJob: ActiveJobSnapshot | null
  cloudConnected: boolean
  agentConnected: boolean
  userEmail: string | null
  companionEnabled: boolean
  roomKey: string
}

// Live provider injected by the app so `execute` reflects fresh state at call time.
let snapshotProvider: () => DashboardSnapshot = () => ({
  devices: [],
  serialLogs: [],
  activeJob: null,
  cloudConnected: false,
  agentConnected: false,
  userEmail: null,
  companionEnabled: true,
  roomKey: 'chip-default-room',
})

export function setDeviceProvider(next: () => ChipDevice[]): void {
  // Legacy adapter for backward compatibility if only array passed
  const currentProvider = snapshotProvider
  snapshotProvider = () => ({
    ...currentProvider(),
    devices: next(),
  })
}

export function setDashboardSnapshotProvider(next: () => DashboardSnapshot): void {
  snapshotProvider = next
}

// ── WebMCP Tool Implementations ──────────────────────────────────────────────

async function listDevices(): Promise<WebMCPToolResult> {
  const snapshot = snapshotProvider()
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ devices: snapshot.devices, count: snapshot.devices.length }, null, 2),
      },
    ],
  }
}

async function getBoardStatus(): Promise<WebMCPToolResult> {
  const snapshot = snapshotProvider()
  const primary = snapshot.devices[0] || null
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            boardConnected: !!(primary && primary.connected),
            device: primary,
            baudRate: primary ? primary.baud : 115200,
            cloudGatewayConnected: snapshot.cloudConnected,
            agentOAuthConnected: snapshot.agentConnected,
            roomKey: snapshot.roomKey,
          },
          null,
          2,
        ),
      },
    ],
  }
}

// ── Log Sanitizer & Plain English Summary Helper ────────────────────────────

export function sanitizeSerialLine(line: string): string {
  if (!line) return ''
  // Strip ANSI color escape sequences
  let clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim()

  // Filter out low-level ESP bootloader noise & flash progress lines
  if (
    clean.startsWith('ets ') ||
    clean.startsWith('rst:0x') ||
    clean.startsWith('boot:0x') ||
    clean.startsWith('configsip:') ||
    clean.startsWith('clk_drv:') ||
    clean.startsWith('mode:DIO') ||
    clean.startsWith('load:0x') ||
    clean.startsWith('entry 0x') ||
    clean.startsWith('ESP-ROM:') ||
    clean.startsWith('[FLASH') ||
    clean.startsWith('Writing at 0x') ||
    clean.startsWith('Leaving...') ||
    clean.startsWith('Hard resetting via RTS pin...')
  ) {
    return ''
  }

  // Strip ESP-IDF log tags (e.g. `I (1234) main: Hello World` -> `Hello World`)
  clean = clean.replace(/^[IWEVD]\s*\(\d+\)\s*[\w.-]+:\s*/, '')

  return clean.trim()
}

export function generateCleanSerialSummary(rawLogs: string[]): {
  cleanLogs: string[]
  cleanSummary: string[]
} {
  const cleaned: string[] = []
  const seen = new Set<string>()

  for (const line of rawLogs) {
    const s = sanitizeSerialLine(line)
    if (s && !seen.has(s)) {
      seen.add(s)
      cleaned.push(s)
    }
  }

  const recentClean = cleaned.slice(-30)

  // Extract key event highlights (networking, sensors, state changes, errors)
  const highlights: string[] = []
  for (const line of recentClean) {
    const lower = line.toLowerCase()
    if (
      lower.includes('wifi') ||
      lower.includes('ip') ||
      lower.includes('connect') ||
      lower.includes('http') ||
      lower.includes('sensor') ||
      lower.includes('temp') ||
      lower.includes('led') ||
      lower.includes('state') ||
      lower.includes('error') ||
      lower.includes('warn') ||
      lower.includes('ready') ||
      lower.includes('started') ||
      lower.includes('button') ||
      lower.includes('pin')
    ) {
      highlights.push(line)
    }
  }

  const cleanSummary = highlights.length > 0 ? highlights.slice(-10) : recentClean.slice(-10)

  return {
    cleanLogs: recentClean,
    cleanSummary,
  }
}

async function readSerialLogs(args: Record<string, unknown> = {}): Promise<WebMCPToolResult> {
  const snapshot = snapshotProvider()
  const limitArg = typeof args.limit === 'number' ? args.limit : 50
  const limit = Math.max(1, Math.min(limitArg, 200))
  const recentLogs = snapshot.serialLogs.slice(-limit)
  const { cleanLogs, cleanSummary } = generateCleanSerialSummary(snapshot.serialLogs)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            totalLogLines: snapshot.serialLogs.length,
            returnedCount: recentLogs.length,
            cleanSummary,
            cleanLogs,
            logs: recentLogs, // Preserved untouched for full backward compatibility
          },
          null,
          2,
        ),
      },
    ],
  }
}

async function readJobStatus(): Promise<WebMCPToolResult> {
  const snapshot = snapshotProvider()
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            hasActiveJob: !!snapshot.activeJob,
            job: snapshot.activeJob || 'No active compilation or flashing job in progress.',
          },
          null,
          2,
        ),
      },
    ],
  }
}

async function readDashboardState(): Promise<WebMCPToolResult> {
  const snapshot = snapshotProvider()
  const { cleanSummary } = generateCleanSerialSummary(snapshot.serialLogs)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            user: snapshot.userEmail || 'Anonymous User',
            roomKey: snapshot.roomKey,
            boardCount: snapshot.devices.length,
            boardConnected: snapshot.devices.some((d) => d.connected),
            cloudGatewayConnected: snapshot.cloudConnected,
            agentOAuthConnected: snapshot.agentConnected,
            activeJobInProgress: !!snapshot.activeJob,
            webCompanionEnabled: snapshot.companionEnabled,
            totalSerialLogs: snapshot.serialLogs.length,
            cleanSerialSummary: cleanSummary,
          },
          null,
          2,
        ),
      },
    ],
  }
}

// ── Agent Message Dispatcher ────────────────────────────────────────────────
// Agents call this to push a message into the dashboard Live Digest sidebar.
export function dispatchAgentMessage(text: string): void {
  window.dispatchEvent(new CustomEvent('chip:agent-message', { detail: { text } }))
}

async function postAgentMessage(args: { message?: string }): Promise<WebMCPToolResult> {
  const text = (args?.message ?? '').trim()
  if (!text) return { content: [{ type: 'text', text: 'Error: message field is required.' }] }
  dispatchAgentMessage(text)
  return { content: [{ type: 'text', text: `Message delivered to dashboard: "${text}"` }] }
}

export function registerWebMCPTools(): void {
  // Always register browser console hooks for WebMCP tool testing (dev + prod)
  window.__chipWebMCP = {
    listDevices,
    getBoardStatus,
    readSerialLogs,
    readJobStatus,
    readDashboardState,
    postAgentMessage,
  }
  console.log(
    '[WebMCP] Tools registered. Try:\n  await window.__chipWebMCP.getBoardStatus()\n  await window.__chipWebMCP.postAgentMessage({ message: "Hello!" })',
  )

  const modelContext = document.modelContext
  if (!modelContext) {
    console.info(
      '[WebMCP] document.modelContext unavailable — enable chrome://flags/#enable-webmcp-testing and relaunch Chrome to test.',
    )
    return
  }

  const tools: WebMCPToolDescriptor[] = [
    {
      name: 'list_devices',
      description: 'List the ESP32 hardware device(s) currently connected to CHIP over USB Web Serial in this browser session. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'List connected ESP32 devices', readOnlyHint: true },
      execute: listDevices,
    },
    {
      name: 'get_board_status',
      description: 'Read detailed ESP32 board hardware connection status, chip model, baud rate, and cloud gateway link. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Get board connection & hardware status', readOnlyHint: true },
      execute: getBoardStatus,
    },
    {
      name: 'read_serial_logs',
      description: 'Read live real-time serial terminal log output from the ESP32 USB connection. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of recent log lines to retrieve (default 50, max 200).' },
        },
      },
      annotations: { title: 'Read real-time serial console logs', readOnlyHint: true },
      execute: (args) => readSerialLogs(args),
    },
    {
      name: 'read_job_status',
      description: 'Read current firmware compile or flash job stage, progress percentage, and build execution logs. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Read firmware compile & flash job status', readOnlyHint: true },
      execute: readJobStatus,
    },
    {
      name: 'read_dashboard_state',
      description: 'Get full snapshot of the CHIP dashboard session state including user email, room key, and hardware visualizer status. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Read full dashboard state snapshot', readOnlyHint: true },
      execute: readDashboardState,
    },
    {
      name: 'post_agent_message',
      description: 'Post a message or status update from the agent directly into the CHIP dashboard Live Digest sidebar panel. Use this to communicate findings or actions to the user.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message text to display in the dashboard.' },
        },
        required: ['message'],
      },
      annotations: { title: 'Post message to dashboard sidebar', readOnlyHint: false },
      execute: (args) => postAgentMessage(args as { message?: string }),
    },
  ]

  tools.forEach((t) => {
    modelContext
      .registerTool(t)
      .then(() => console.log(`[WebMCP] Registered tool: ${t.name}`))
      .catch((err: unknown) => console.warn(`[WebMCP] Failed to register ${t.name}:`, err))
  })
}

