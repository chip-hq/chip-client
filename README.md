# Chip — Developer Guide

Browser-based ESP32 IDE. Claude compiles firmware, the browser flashes it over USB, and a live visualizer syncs with the hardware.

```
Claude ──MCP──► chip-mcp ──REST──► backend ──WebSocket──► browser ──Web Serial──► ESP32
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
| Claude finds no devices | Open dashboard tab, connect board, retry |
| Board not in port picker | Install CP2102/CH340 driver, use a data cable not charge-only |
