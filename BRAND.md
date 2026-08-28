# CHIP — Brand & Design Tokens

Reference for the colors, type, and UI conventions used across the CHIP web client.
Every value below is pulled from the actual source (`src/index.css`, `src/App.css`, and the
component files). This is documentation only — nothing imports it.

**How theming works today:** Tailwind v4 (CSS-first, `@import "tailwindcss"` in
[src/index.css](src/index.css)) with a small set of `:root` CSS variables. Most component
colors are written inline as Tailwind **arbitrary values** (`bg-[#141414]`, `text-[#16a34a]`)
or inline styles, not named tokens — so this file is the closest thing to a single source of truth.

---

## 1. Neutrals — light UI (the main app)

The app is a light, black-on-white, low-chrome surface.

| Hex | Token / role |
|-----|--------------|
| `#f5f5f5` | App background — `--bg`, `body` |
| `#ffffff` | Surface — `--card-bg`, cards, inputs, gate, pills |
| `#fcfcfc` | Subtle raised surface (history rows) |
| `#fafafa` | Hover surface (file button, subtle fills) |
| `#f8f8f8` | Subtle row background |
| `#f3f3f3` | Hover fill |
| `#f0f0f0` | Ghost-button hover / generic hover fill |
| `#ebebeb` | Divider / soft border |
| `#eaeaea` | Divider |
| `#e5e5e5` | **Primary border** — `--border` |
| `#e0e0e0` | Border (history) |
| `#d1d1d1` | Ghost-button hover border |
| `#cccccc` | Muted border/gray |
| `#d1d5db` | Scrollbar thumb, console body text, disabled text |
| `#9ca3af` | Scrollbar hover, idle status dot |

### Text ramp

| Hex | Token / role |
|-----|--------------|
| `#000000` | **Primary text** — `--text-primary` |
| `#222222` | Strong text / black-button hover |
| `#444444` | Secondary-dark text |
| `#555555` | Gray text |
| `#666666` | **Secondary text** — `--text-secondary` |
| `#6b7280` | Console muted text |
| `#777777` | Muted text |
| `#888888` | **Muted text** — `--text-muted` |

---

## 2. Brand / primary action

The core CHIP action color is **black**. Used for primary buttons, the brand mark, active
pills/stages, progress fill, and focus borders.

| Hex | Role |
|-----|------|
| `#000000` | Primary action (default) |
| `#222222` | Primary action (hover) |
| `#ffffff` | Text/icon on black |

---

## 3. Semantic — status colors

Each status has a base, plus a soft tint background and border for pills/badges.

| Status | Base | Tint bg | Border | Notes / variants |
|--------|------|---------|--------|------------------|
| Success | `#16a34a` | `#f0fdf4` | `#86efac` | Brighter on dark: `#22c55e`, `#4ade80`; emerald `#10b981`; tint border `#bbf7d0` |
| Error | `#dc2626` | `#fef2f2` | `#fecaca` | Darker/hover `#b91c1c` |
| Warning | `#f59e0b` | — | — | Idle/pending yellow `#eab308` |
| Info | `#3b82f6` | — | — | Light `#60a5fa`; sky `#38bdf8` |

---

## 4. Amber "Not connected" / alert family

The alert **toast** ([src/components/AlertToast.tsx](src/components/AlertToast.tsx)) — all alert
types (error / success / info) share one amber palette, bottom-right, flat (no shadow).

| Element | Value |
|---------|-------|
| Background | `#f9e3b3` |
| Title & message text | `#7c2d12` |
| Icon | `#92400e` |
| Border | `rgba(120,53,15,0.35)` |
| Dismiss button (idle) | `rgba(124,45,18,0.55)` |
| Dismiss button (hover) | `#7c2d12` |

> Background history: started `#b45309` (solid, white text) → lightened to the current light-gold
> fill, so the foreground was flipped to dark amber for contrast. Ramp: `#f0c672` → `#f7dda5` →
> **`#f9e3b3`** (current).

Related amber usages elsewhere:

| Hex | Where |
|-----|-------|
| `#b45309` | MCP "Not connected" status dot + text ([src/components/Sidebar.tsx](src/components/Sidebar.tsx)) |
| `#92400e` | Login/gate accent panel background ([src/App.tsx](src/App.tsx)) |
| `#fcd34d` | Login/gate accent text |
| `#f59e0b` | Generic warning accent |

---

## 5. Dark theme (Companion Preview, terminal, code blocks)

The board-companion preview, live serial terminal, and history code views use a dark surface stack.

**Surfaces** (light → dark): `#1e1e1e`, `#181818`, `#141414`, `#111111`, `#0f0f0f`, `#0d0d0d`, `#000000`

**Borders:** `#333333`, `#2d2d2d`, `#2a2a2a`, `#222222`, `#1f1f1f`

**Text ramp:** `#e5e5e5`, `#d4d4d4`, `#a3a3a3`, `#737373`, `#525252`, `#404040`, `#3a3a3a`

**Accents on dark:** green `#22c55e` / `#4ade80` / `#10b981` / `#16a34a` · sky/blue `#38bdf8` / `#60a5fa` / `#3b82f6` · yellow `#eab308` · amber `#f59e0b`

---

## 6. Google Sign-in (external brand — do not restyle)

Used only in the Google sign-in button glyph; these are Google's brand colors, keep as-is.

`#4285F4` (blue) · `#34A853` (green) · `#FBBC05` (yellow) · `#EA4335` (red)

---

## 7. Typography

| Use | Stack |
|-----|-------|
| UI / body | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` |
| Toast component | `Inter, system-ui, sans-serif` |
| Mono (code, console, pills, metadata) | `var(--mono)` — see Known gaps |

Antialiasing: `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`.

---

## 8. Radii, motion & elevation

**Radii:** `3px` progress bars · `4px` buttons / inputs / pills / badges · `6px` cards, console,
brand mark, gate · `10px` alert toast · `50%` / `999px` dots & scrollbar thumb.

**Motion:**
- `0.15s` — standard hover (color / background / border)
- `0.2s` — progress-bar width
- `0.3s` — status-dot color
- `0.6s linear` — spinner
- Alert **enter**: `transform 0.38s cubic-bezier(0.16,1,0.3,1)` + `opacity 0.3s` (slides up from below)
- Alert **leave**: `transform 0.32s cubic-bezier(0.4,0,1,1)` + `opacity 0.28s`

**Elevation:** flat by design — cards use `box-shadow: none`; the alert toast is also shadowless.

**Scrollbar:** thin, `5px`, transparent track, thumb `#d1d5db` → hover `#9ca3af`.

---

## 9. Known gaps / cleanup candidates

- **Undefined variables:** [src/App.css](src/App.css) references `var(--text)` and `var(--mono)`,
  but [src/index.css](src/index.css) `:root` only defines `--bg`, `--card-bg`, `--border`,
  `--text-primary`, `--text-secondary`, `--text-muted`. As a result `color: var(--text)` falls back
  to inherited color, and `.console` / `.pill` `font-family: var(--mono)` falls back to the inherited
  **sans** font (monospace is not actually applied). Define `--text` and `--mono` in `:root`, or swap
  those references to the defined tokens.
- **Near-duplicate neutrals:** many very close light grays (`#f0f0f0`/`#f3f3f3`/`#f8f8f8`/`#fafafa`/`#fcfcfc`;
  `#eaeaea`/`#ebebeb`/`#e5e5e5`) and dark grays could be consolidated into a smaller ramp.
- **Colors live inline:** most values are Tailwind arbitrary values scattered across components. If you
  want a real single source of truth, promote this palette into `:root` variables (or a typed
  `tokens.ts`) and reference those instead.
