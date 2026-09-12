import { context2d, createCanvas, imageDataToSource } from './canvas'
import { getCodec } from './codecs/registry'
import type { ImageSource, OutputFormat } from './codecs/types'

async function decodeWithBitmap(
  buffer: ArrayBuffer,
  maxEdge?: number,
): Promise<ImageSource> {
  let bitmap: ImageBitmap
  if (maxEdge && maxEdge > 0) {
    try {
      // Scaled decode: far less work/memory than decoding full-res (JPEG uses a
      // reduced IDCT). Falls back to a full decode where unsupported.
      bitmap = await createImageBitmap(new Blob([buffer]), {
        resizeWidth: maxEdge,
        resizeQuality: 'high',
      })
    } catch {
      bitmap = await createImageBitmap(new Blob([buffer]))
    }
  } else {
    bitmap = await createImageBitmap(new Blob([buffer]))
  }

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
 * exists. `maxEdge` requests a cheap scaled decode for estimates.
 */
export async function decodeImageData(
  buffer: ArrayBuffer,
  format?: OutputFormat | null,
  maxEdge?: number,
): Promise<ImageSource> {
  try {
    return await decodeWithBitmap(buffer, maxEdge)
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
