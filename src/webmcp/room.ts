/**
 * WebMCP Prompt & URL Helper for CHIP Dashboard
 * Formats live dashboard URL and agent prompt copy text.
 */

export function getWebMCPUrl(): string {
  if (typeof window === 'undefined') return 'https://chip-mocha.vercel.app/'
  return window.location.origin
}

export function buildAgentPrompt(): string {
  const liveUrl = getWebMCPUrl()

  return `Assist me with CHIP (Hardware Web Agent) using WebMCP.
Use a WebMCP-capable in-app or agent browser. In Codex/ChatGPT/Claude, open the agent URL in a separate agent view:

Exact CHIP live URL:
<${liveUrl}>

If that URL is already open, do not reopen it.

AUTONOMOUS WORKFLOW (Execute immediately without waiting for confirmation):
1. Call 'get_board_status' and 'list_devices' to inspect the connected ESP32 hardware and cloud gateway status.
2. IMMEDIATELY call 'post_agent_message' to post your status summary directly to my dashboard Live Digest sidebar (e.g. "ESP32-D0WD-V3 connected & ready at 115200 baud"). Do NOT ask for permission before calling post_agent_message—post it proactively.
3. If the user says the board is connected, call 'get_board_status' again. If the user explicitly asks you to erase the board, call 'erase_board'. If you only recommend a clean flash, call 'set_agent_note' and 'request_user_action' using action "erase_board" first.
4. Call 'read_serial_logs' to check live serial console output and provide recommendations or assist with firmware compilation.

Exposed WebMCP Tools:
- list_devices: List connected microcontroller hardware
- get_board_status: Get hardware connection, baud rate & gateway status
- post_agent_message: Post status updates or advice directly to the user's dashboard Live Digest sidebar (Proactive)
- set_agent_note: Save persistent agent-visible guidance in the dashboard
- request_user_action: Request structured hardware actions such as connect_board, press_reset, select_file, erase_board, open_serial_monitor, or check_wiring
- erase_board: Actually erase the connected ESP32 flash when the user explicitly asks for it
- read_serial_logs: Read live real-time serial terminal output
- read_job_status: Check compilation & flash pipeline progress
- read_dashboard_state: Full snapshot of dashboard & visualizer state`
}

// Backward-compatibility aliases
export const getWebMCPRoomUrl = (_roomKey?: string) => getWebMCPUrl()
export const buildAgentRoomPrompt = (_roomKey?: string) => buildAgentPrompt()
export const getOrCreateRoomKey = () => ''
