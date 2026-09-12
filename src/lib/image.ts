import { context2d, createCanvas, imageDataToSource } from './canvas'
import { getCodec } from './codecs/registry'
import type { ImageSource, OutputFormat } from './codecs/types'

async function decodeWithBitmap(buffer: ArrayBuffer): Promise<ImageSource> {
  const bitmap = await createImageBitmap(new Blob([buffer]))

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
 * that cannot decode a format (notably JPEG XL) fall back to the matching WASM
 * decoder when one exists.
 */
export async function decodeImageData(
  buffer: ArrayBuffer,
  format?: OutputFormat | null,
): Promise<ImageSource> {
  try {
    return await decodeWithBitmap(buffer)
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
