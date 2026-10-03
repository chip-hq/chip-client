/**
 * chip-uf2 - Raspberry Pi Pico flashing package (guided UF2 export).
 *
 * Honest limitation, stated in the UI: browsers cannot write USB
 * mass-storage volumes, and BOOTSEL exposes the Pico as a drive - so there
 * is no silent one-click UF2 flash from a web page. This package does the
 * next-best thing well: it downloads the compiled .uf2 with the right
 * filename and walks the user through the 3-step BOOTSEL drop, with live
 * step state. When a native path exists later, it slots in behind this
 * same interface.
 */

export interface Uf2Offer {
  filename: string
  size: number
  data: Uint8Array
}

export const UF2_STEPS = [
  'Unplug the Pico, hold BOOTSEL, plug it back in - it appears as the RPI-RP2 drive.',
  'Save the .uf2 below onto the RPI-RP2 drive.',
  'The drive disappears and the Pico reboots into your firmware.',
] as const

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function downloadUf2(offer: Uf2Offer) {
  const blob = new Blob([offer.data as unknown as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = offer.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
