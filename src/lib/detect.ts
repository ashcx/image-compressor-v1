import type { OutputFormat } from './codecs/types'

function matches(
  data: Uint8Array,
  offset: number,
  signature: readonly number[],
): boolean {
  if (data.length < offset + signature.length) return false
  return signature.every((byte, index) => data[offset + index] === byte)
}

const AVIF_BRANDS = new Set(['avif', 'avis'])
// HEIC uses `heic`/`heix`/`hevc`/`hevx`; `heim`/`heis` are the multi-image and
// scaled variants; `mif1`/`msf1` are the generic HEIF brands.
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
])

function ascii(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  )
}

/**
 * Reads the major brand and the compatible-brand list from a `ftyp` box, so a
 * generic `mif1` major brand that still carries an `avif`/`heic` compatible
 * brand is classified correctly.
 */
function ftypBrands(data: Uint8Array): string[] {
  if (!matches(data, 4, [0x66, 0x74, 0x79, 0x70])) return []
  const boxSize =
    ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0
  const end = boxSize >= 16 ? Math.min(data.length, boxSize) : data.length
  const brands: string[] = []
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    // Bytes 12-15 are the minor version, not a brand.
    if (offset === 12) continue
    brands.push(ascii(data, offset))
  }
  return brands
}

/**
 * Identifies an image format from its magic bytes rather than its file
 * extension, so renamed files still route to the right decoder.
 */
export function detectFormat(buffer: ArrayBuffer): OutputFormat | null {
  const data = new Uint8Array(buffer)

  if (matches(data, 0, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (matches(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png'
  }
  if (
    matches(data, 0, [0x52, 0x49, 0x46, 0x46]) &&
    matches(data, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'webp'
  }

  const brands = ftypBrands(data)
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif'
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic'

  return null
}
