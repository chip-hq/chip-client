/**
 * Chip flashing packages - platform registry mirror.
 *
 * Each chip family flashes with its OWN package (ESP32 → esptool,
 * Arduino AVR → STK500v1, Pico → UF2 …). This module mirrors the backend
 * registry (`GET /api/platforms`) with a bundled fallback so the dashboard
 * can pick a flasher even when the cloud is unreachable.
 */

export interface FlashToolInfo {
  tool: 'esptool' | 'stk500v1' | 'uf2' | string
  package: string
  protocol: string
  notes?: string | null
}

export interface BoardInfo {
  slug: string
  label: string
  mcu?: string
  pageSize?: number
  baud?: number
}

export interface PlatformInfo {
  id: string
  vendor: string
  label: string
  boardCount: number
  status: 'supported' | 'coming-soon'
  ota: boolean
  artifact: 'merged-bin' | 'bin' | 'hex' | 'uf2' | string
  flash: FlashToolInfo | null
  boards: BoardInfo[]
}

/** Bundled fallback - mirrors backend/services/platforms.js (supported set). */
const BUNDLED: PlatformInfo[] = [
  {
    id: 'esp32', vendor: 'Espressif', label: 'ESP32', boardCount: 601,
    status: 'supported', ota: true, artifact: 'merged-bin',
    flash: { tool: 'esptool', package: 'esptool-js', protocol: 'SLIP ROM bootloader over Web Serial' },
    boards: [
      { slug: 'esp32', label: 'ESP32 (generic)' },
      { slug: 'esp32dev', label: 'ESP32 DevKit' },
      { slug: 'esp32s2', label: 'ESP32-S2' },
      { slug: 'esp32s3', label: 'ESP32-S3' },
      { slug: 'esp32c3', label: 'ESP32-C3' },
    ],
  },
  {
    id: 'esp8266', vendor: 'Espressif', label: 'ESP8266', boardCount: 158,
    status: 'supported', ota: false, artifact: 'bin',
    flash: { tool: 'esptool', package: 'esptool-js', protocol: 'SLIP ROM bootloader over Web Serial' },
    boards: [
      { slug: 'esp8266', label: 'ESP8266 (generic)' },
      { slug: 'nodemcuv2', label: 'NodeMCU v2' },
      { slug: 'esp01', label: 'ESP-01' },
    ],
  },
  {
    id: 'arduino-avr', vendor: 'Arduino', label: 'Arduino / AVR', boardCount: 724,
    status: 'supported', ota: false, artifact: 'hex',
    flash: { tool: 'stk500v1', package: 'chip-stk500 (built in)', protocol: 'STK500v1 bootloader over Web Serial' },
    boards: [
      { slug: 'uno', label: 'Arduino Uno', mcu: 'atmega328p', pageSize: 128, baud: 115200 },
      { slug: 'nano', label: 'Arduino Nano', mcu: 'atmega328p', pageSize: 128, baud: 115200 },
      { slug: 'nano-old', label: 'Arduino Nano (old bootloader)', mcu: 'atmega328p', pageSize: 128, baud: 57600 },
    ],
  },
  {
    id: 'rp2040', vendor: 'Raspberry Pi', label: 'RP2040', boardCount: 344,
    status: 'supported', ota: false, artifact: 'uf2',
    flash: { tool: 'uf2', package: 'guided UF2 export', protocol: 'BOOTSEL mass-storage drop' },
    boards: [{ slug: 'pico', label: 'Raspberry Pi Pico' }],
  },
]

let cache: PlatformInfo[] | null = null

export async function loadPlatforms(backendUrl: string): Promise<PlatformInfo[]> {
  if (cache) return cache
  try {
    const res = await fetch(`${backendUrl}/api/platforms`)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.platforms) && data.platforms.length > 0) {
        cache = data.platforms as PlatformInfo[]
        return cache
      }
    }
  } catch {
    // offline backend - bundled fallback below
  }
  cache = BUNDLED
  return cache
}

export function findBoard(platforms: PlatformInfo[], slug: string | null | undefined): { platform: PlatformInfo; board: BoardInfo } | null {
  if (!slug) return null
  const key = slug.toLowerCase()
  for (const p of platforms) {
    const b = p.boards.find((x) => x.slug.toLowerCase() === key)
    if (b) return { platform: p, board: b }
  }
  return null
}

/** Match an esptool chip name to its platform (ESP32* / ESP8266 families). */
export function platformForChip(platforms: PlatformInfo[], chip: string | null | undefined): PlatformInfo | null {
  if (!chip) return null
  const upper = chip.toUpperCase()
  if (/ESP32/.test(upper)) return platforms.find((p) => p.id === 'esp32') ?? null
  if (/ESP8266/.test(upper)) return platforms.find((p) => p.id === 'esp8266') ?? null
  if (/ATMEGA328/.test(upper)) return platforms.find((p) => p.id === 'arduino-avr') ?? null
  return null
}

/**
 * Rank platform candidates from a Web Serial USB VID/PID. Genuine Arduino
 * USB IDs are decisive; shared bridge chips (CH340/FTDI/CP210x) only hint
 * at Espressif-vs-Arduino and the bootloader probe decides.
 */
export function candidatesForVidPid(vendorId: number | undefined, productId: number | undefined): string[] {
  if (vendorId == null) return []
  const ARDUINO_GENUINE: Array<[number, number | undefined]> = [
    [0x2341, 0x0043], [0x2341, 0x0001], [0x2341, 0x0010],
  ]
  if (ARDUINO_GENUINE.some(([v, p]) => v === vendorId && (p == null || p === productId))) {
    return ['arduino-avr']
  }
  if (vendorId === 0x2e8a) return ['rp2040']
  if (vendorId === 0x303a) return ['esp32']
  return []
}
