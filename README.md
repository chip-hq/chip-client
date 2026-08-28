# Chip — Developer Guide

Browser-based ESP32 IDE. Claude compiles firmware, the browser flashes it over USB, and a live visualizer syncs with the hardware.

```
Claude ──MCP──► chip-mcp ──REST──► backend ──WebSocket──► browser ──Web Serial──► ESP32
```

Chip is built around one important hardware truth: the ESP32 is plugged into the user's computer, so the browser must be the part that talks to USB. The agent can plan, inspect, compile, and guide the workflow, but the dashboard is the live bridge to the physical board through Web Serial and `esptool-js`.

---

## WebMCP Browser Tools

The client exposes browser-side tools through the experimental `document.modelContext` WebMCP API. These tools let a WebMCP-capable agent work with the live dashboard session instead of only talking to a remote server.

Available client WebMCP tools:

| Tool | What it does |
|---|---|
| `list_devices` | Lists ESP32 devices visible to the dashboard session. |
| `get_board_status` | Reads board connection state, chip model, baud rate, gateway state, agent state, room key, and agent note. |
| `read_serial_logs` | Reads recent serial output, cleaned logs, and a concise summary of useful board events. |
| `read_job_status` | Reads the current compile or flash job, including phase, status, progress, and logs. |
| `read_dashboard_state` | Returns a full dashboard snapshot for the current browser session. |
| `post_agent_message` | Posts an agent message into the dashboard Live Digest sidebar. |
| `set_agent_note` | Saves persistent agent guidance in the dashboard. |
| `request_user_action` | Requests a hardware action such as connecting the board, pressing reset, selecting a file, opening serial monitor, checking wiring, or erasing flash. |
| `erase_board` | Erases the connected ESP32 flash through the browser Web Serial session when the user clearly asks for it. |

For local testing, the same tool handlers are also available on `window.__chipWebMCP`.

```js
await window.__chipWebMCP.getBoardStatus()
await window.__chipWebMCP.readSerialLogs({ limit: 25 })
await window.__chipWebMCP.postAgentMessage({ message: "ESP32 connected and ready." })
```

---

## Product Flow

1. The user opens the Chip dashboard in Chrome or Edge.
2. The user connects an ESP32 over USB.
3. The agent uses WebMCP tools to inspect the board and dashboard state.
4. The agent reads serial logs, posts guidance, asks for physical actions when needed, and helps with firmware iteration.
5. The browser performs board operations because it owns the Web Serial permission.

---

## Connecting Claude

1. Sign in to the dashboard → **Settings** → copy the **MCP URL**
2. Claude.ai → **Settings → Integrations → Add integration** → paste the URL
3. Authorise the popup that appears in the dashboard

Claude can then call: `list_devices`, `compile_firmware`, `flash_device`, `get_status`

For the in-browser WebMCP room flow, copy the WebMCP Agent Room Prompt from the dashboard and paste it into a WebMCP-capable agent browser. The agent can then use the client WebMCP tools listed above to interact with the live dashboard.

---

## Prerequisites

- Node.js 18+, npm 9+
- PlatformIO CLI: `pip install platformio`
- Chrome or Edge (Web Serial — Firefox not supported)
- ESP32 board over USB with a data cable

---

## Common Issues

| Problem | Fix |
|---|---|
| Claude finds no devices | Open dashboard tab, connect board, retry |
| Board not in port picker | Install CP2102/CH340 driver, use a data cable not charge-only |
