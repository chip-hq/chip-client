# Chip — Developer Guide

Browser-based ESP32 IDE. Claude compiles firmware, the browser flashes it over USB, and a live visualizer syncs with the hardware.

```
Claude ──MCP──► chip-mcp ──REST──► backend ──WebSocket──► browser ──Web Serial──► ESP32
```

---

## Three Services, Three Terminals

| Service | Folder | Port |
|---|---|---|
| Backend (compiler + relay) | `backend/` | `3000` |
| MCP Server (Claude tools) | `chip-mcp/` | `3001` |
| Client (dashboard) | `client/` | `5173` |

**Terminal 1 — Backend**
```bash
cd backend && cp .env.example .env && npm install && npm run dev
```

**Terminal 2 — MCP Server**
```bash
cd chip-mcp && npm install && npm run dev
```

**Terminal 3 — Client**
```bash
cd client && npm install && npm run dev
# open http://localhost:5173 in Chrome or Edge
```

---

## Environment Variables

### `backend/.env`
```
PORT=3000
SESSION_SECRET=<long random hex>   # ⚠️ must match chip-mcp exactly
FRONTEND_URL=http://localhost:5173
MONGODB_URI=                        # optional — falls back to in-memory
```

### `chip-mcp/.env`
```
PORT=3001
BACKEND_URL=http://localhost:3000
SESSION_SECRET=<same value as backend>
```

### `client/.env.local`
```
VITE_BACKEND_URL=http://localhost:3000
VITE_MCP_URL=http://localhost:3001
```

Generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Connecting Claude

1. Sign in to the dashboard → **Settings** → copy the **MCP URL**
2. Claude.ai → **Settings → Integrations → Add integration** → paste the URL
3. Authorise the popup that appears in the dashboard

Claude can then call: `list_devices`, `compile_firmware`, `flash_device`, `get_status`

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
| CORS error | Set `FRONTEND_URL=http://localhost:5173` in `backend/.env` |
| Claude finds no devices | Open dashboard tab, connect board, retry |
| `SESSION_SECRET` mismatch | Copy identical value to both `backend/.env` and `chip-mcp/.env` |
| Port already in use | Change `PORT` in the relevant `.env` |
| Board not in port picker | Install CP2102/CH340 driver, use a data cable not charge-only |
