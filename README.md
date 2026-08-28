# Chip Client

Chip is a browser-based ESP32 dashboard that lets an AI agent inspect and control real hardware through WebMCP. The browser owns the USB connection with Web Serial and `esptool-js`; the agent owns the reasoning loop through WebMCP tools exposed by the page.

```
AI agent -> WebMCP browser tools -> Chip dashboard -> Web Serial -> ESP32
```

The important design choice is that the cloud or MCP server never pretends to touch USB. The user's browser is the physical hand connected to the board, while WebMCP gives an agent a structured way to read dashboard state, inspect serial logs, request user actions, post guidance, and perform approved board operations.

## What Works Today

- Connect an ESP32 from the Chip dashboard using Web Serial.
- Flash firmware binaries from the browser with `esptool-js`.
- Track compile and flash jobs in the dashboard UI.
- Read live serial logs and generate cleaner agent-friendly summaries.
- Register WebMCP tools through `document.modelContext` when the browser supports it.
- Let an agent post messages into the dashboard Live Digest.
- Let an agent save persistent dashboard notes.
- Let an agent request structured hardware actions from the user.
- Let an agent erase a connected board only when a board is available and the user has explicitly asked for it.

## WebMCP Tools

The client registers these browser-side WebMCP tools in `src/webmcp/tools.ts`:

| Tool | Purpose |
|---|---|
| `list_devices` | Lists ESP32 devices currently visible to the dashboard session. |
| `get_board_status` | Returns board connection state, chip model, baud rate, cloud gateway state, agent connection state, room key, and current agent note. |
| `read_serial_logs` | Returns recent serial output, a cleaned log view, and a concise summary of useful board events. |
| `read_job_status` | Returns the current compile or flash job state, progress, and logs. |
| `read_dashboard_state` | Returns a full dashboard snapshot, including user, room, board, gateway, job, companion, note, and serial summary state. |
| `post_agent_message` | Posts a message from the agent into the Live Digest sidebar. |
| `set_agent_note` | Stores persistent agent guidance in the dashboard. |
| `request_user_action` | Requests a specific hardware action such as `connect_board`, `press_reset`, `select_file`, `erase_board`, `open_serial_monitor`, or `check_wiring`. |
| `erase_board` | Erases the connected ESP32 flash through the browser Web Serial session. This is destructive and should only be called after a clear user request. |

For local manual testing, the same functions are also exposed on `window.__chipWebMCP`.

Example console checks:

```js
await window.__chipWebMCP.getBoardStatus()
await window.__chipWebMCP.readSerialLogs({ limit: 25 })
await window.__chipWebMCP.postAgentMessage({ message: "ESP32 connected and ready." })
```

## Product Experience

Chip is intended for makers, students, teachers, and hardware teams who want to iterate on ESP32 firmware without juggling local toolchains, IDE setup, board flashing commands, and serial debugging. The dashboard provides a coherent loop:

1. The user opens Chip in Chrome or Edge.
2. The user connects an ESP32 over USB.
3. The agent inspects the board through WebMCP.
4. The agent can read logs, explain what is happening, request physical actions, and guide firmware iteration.
5. The browser performs physical board operations because it owns the Web Serial permission.

This is more than an AI code-generation demo: WebMCP is used as the bridge between an agent and live browser-held hardware state.

## Run Locally

Chip currently has three services:

| Service | Folder | Port |
|---|---|---|
| Backend, compiler, and relay | `backend/` | `3000` |
| MCP server for classic agent integrations | `chip-mcp/` | `3001` |
| Client dashboard | `client/` | `5173` |

Terminal 1:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Terminal 2:

```bash
cd chip-mcp
npm install
npm run dev
```

Terminal 3:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge.

## Environment Variables

`backend/.env`:

```env
PORT=3000
SESSION_SECRET=<long random hex>
FRONTEND_URL=http://localhost:5173
MONGODB_URI=
```

`chip-mcp/.env`:

```env
PORT=3001
BACKEND_URL=http://localhost:3000
SESSION_SECRET=<same value as backend>
```

`client/.env.local`:

```env
VITE_BACKEND_URL=http://localhost:3000
VITE_MCP_URL=http://localhost:3001
```

Generate a secure secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## WebMCP Browser Setup

WebMCP is experimental browser functionality. To test it in Chrome:

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Enable the WebMCP testing flag.
3. Relaunch Chrome.
4. Open the Chip dashboard.
5. Check the WebMCP status in the dashboard settings.

If `document.modelContext` is unavailable, the dashboard still works as a Web Serial flasher, and the `window.__chipWebMCP` console hooks remain available for local testing.

## Classic MCP Integration

The repo also includes `chip-mcp`, a classic MCP server for agent integrations outside the browser. That server can expose backend/cloud tools such as compile, flash relay, status, and device listing. The client-side WebMCP tools are separate: they expose the live browser session and hardware state held by the dashboard.

## Judging Criteria Fit

**WebMCP Leverage:** Chip registers nine non-trivial WebMCP tools that read live state, summarize serial logs, communicate into the UI, request hardware actions, and perform browser-held board operations.

**Execution:** The client is a runnable dashboard, not just a tool registration snippet. It includes Web Serial connection, flashing UI, job progress, serial logs, agent sidebar, setup flow, and WebMCP availability checks.

**Potential Impact:** Chip targets a real pain point for ESP32 users: firmware iteration requires code, compile tooling, flashing utilities, driver knowledge, and serial debugging. The browser plus agent workflow reduces that to connecting a board and asking for help.

**Creativity and Ambition:** The project combines AI agents, WebMCP, Web Serial, browser-side flashing, cloud compile/relay architecture, and live hardware feedback. The agent does not just generate code; it can interact with a real board session through the browser.

## Prerequisites

- Node.js 18+ and npm 9+
- Chrome or Edge on desktop
- ESP32 board connected over USB with a data-capable cable
- PlatformIO CLI for local backend compile workflows
- WebMCP-capable browser or experimental WebMCP flag for full agent/browser tool testing

## Common Issues

| Problem | Fix |
|---|---|
| WebMCP tools do not appear | Enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome, and reopen the dashboard. |
| Board does not appear in port picker | Use a data-capable USB cable and install the CP2102/CH340 driver if needed. |
| Agent sees no connected board | Keep the dashboard tab open and connect the board before calling WebMCP tools. |
| CORS error | Set `FRONTEND_URL=http://localhost:5173` in `backend/.env`. |
| `SESSION_SECRET` mismatch | Use the same `SESSION_SECRET` in `backend/.env` and `chip-mcp/.env`. |
| Port already in use | Change `PORT` in the relevant `.env` file. |
