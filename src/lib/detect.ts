import type { OutputFormat } from './codecs/types'

function matches(
  data: Uint8Array,
  offset: number,
  signature: readonly number[],
): boolean {
  if (data.length < offset + signature.length) return false
  return signature.every((byte, index) => data[offset + index] === byte)
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
  if (matches(data, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...data.slice(8, 12))
    if (brand === 'avif' || brand === 'avis') return 'avif'
  }

  return null
}
