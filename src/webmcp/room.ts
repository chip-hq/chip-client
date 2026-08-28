/**
 * WebMCP Room & Prompt Helper for CHIP Dashboard
 * Generates room session IDs and formats agent prompt copy text.
 */

export function getOrCreateRoomKey(): string {
  if (typeof window === 'undefined') return 'chip-room-527RR'

  // Check URL query search param `?room=...` or hash
  const searchParams = new URLSearchParams(window.location.search)
  const roomQuery = searchParams.get('room')
  if (roomQuery) return roomQuery

  // Check sessionStorage
  const stored = sessionStorage.getItem('chip_webmcp_room_key')
  if (stored) return stored

  // Generate a random 5-character room ID (similar to 527RR in MCPencil)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let randomId = ''
  for (let i = 0; i < 5; i++) {
    randomId += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  const roomKey = `chip-room-${randomId}`
  sessionStorage.setItem('chip_webmcp_room_key', roomKey)
  return roomKey
}

export function getWebMCPRoomUrl(roomKey: string): string {
  if (typeof window === 'undefined') return `https://chip-mocha.vercel.app/?room=${roomKey}&invite=agent#webmcp`
  const origin = window.location.origin
  return `${origin}/?room=${roomKey}&invite=agent#webmcp`
}

export function buildAgentRoomPrompt(roomKey: string): string {
  const roomUrl = getWebMCPRoomUrl(roomKey)

  return `Assist me with CHIP (Hardware Web Agent) using WebMCP.
Use a WebMCP-capable in-app or agent browser. In Codex/ChatGPT/Claude, use the browser surface that exposes page tools.
Open the agent URL in a separate agent tab or view.

Exact CHIP room URL (the angle brackets delimit the URL):
<${roomUrl}>

If that exact room is already loaded in your WebMCP browser, do not reopen it. Otherwise navigate there once.

Inspect hardware state and assist me in this dashboard only through the page-exposed WebMCP tools:
- list_devices: List connected microcontroller hardware
- get_board_status: Get hardware connection, baud rate & gateway status
- read_serial_logs: Read live real-time serial terminal output
- read_job_status: Check compilation & flash pipeline progress
- read_dashboard_state: Full snapshot of dashboard & visualizer state`
}
