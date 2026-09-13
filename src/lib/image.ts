import { context2d, createCanvas, imageDataToSource } from './canvas'
import { getCodec } from './codecs/registry'
import type { ImageSource, OutputFormat } from './codecs/types'

export interface DecodeTarget {
  /** Exact size to decode at (resize-aware). */
  size?: { width: number; height: number }
  /** Long-edge ceiling used when an exact size is not known. */
  maxEdge?: number
}

async function createScaledBitmap(
  buffer: ArrayBuffer,
  target: DecodeTarget,
): Promise<ImageBitmap> {
  const blob = new Blob([buffer])
  if (target.size) {
    try {
      // Scaled decode: far less work/memory than decoding full-res (JPEG uses a
      // reduced IDCT). Falls back to a full decode where unsupported.
      return await createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(target.size.width)),
        resizeHeight: Math.max(1, Math.round(target.size.height)),
        resizeQuality: 'high',
      })
    } catch {
      // Fall through to a full decode.
    }
  } else if (target.maxEdge && target.maxEdge > 0) {
    try {
      return await createImageBitmap(blob, {
        resizeWidth: target.maxEdge,
        resizeQuality: 'high',
      })
    } catch {
      // Fall through to a full decode.
    }
  }
  return createImageBitmap(blob)
}

async function decodeWithBitmap(
  buffer: ArrayBuffer,
  target: DecodeTarget,
): Promise<ImageSource> {
  const bitmap = await createScaledBitmap(buffer, target)
  try {
    const canvas = createCanvas(bitmap.width, bitmap.height)
    context2d(canvas).drawImage(bitmap, 0, 0)
    return { width: bitmap.width, height: bitmap.height, canvas }
  } finally {
    bitmap.close()
  }
}

/**
 * Decodes to a canvas-backed source. Native decoding is tried first; browsers
 * that cannot decode a format fall back to the matching WASM decoder when one
 * exists. `target` requests a cheap scaled decode for resized or estimated work.
 */
export async function decodeImageData(
  buffer: ArrayBuffer,
  format?: OutputFormat | null,
  target: DecodeTarget = {},
): Promise<ImageSource> {
  try {
    return await decodeWithBitmap(buffer, target)
  } catch (error) {
    if (format) {
      try {
        const codec = await getCodec(format)
        if (codec.decode) return imageDataToSource(await codec.decode(buffer))
      } catch {
        // Surface the original native error below.
      }
    }
    throw error
  }
}
