import { getCodec } from './codecs/registry'
import type { OutputFormat } from './codecs/types'

type AnyCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

function createContext(width: number, height: number): AnyCanvasContext {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    return context
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  return context
}

async function decodeWithBitmap(buffer: ArrayBuffer): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([buffer]))

  try {
    const context = createContext(bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export async function decodeImageData(
  buffer: ArrayBuffer,
  format?: OutputFormat | null,
): Promise<ImageData> {
  try {
    return await decodeWithBitmap(buffer)
  } catch (error) {
    // Browsers do not decode every format (notably JPEG XL); fall back to the
    // matching WASM decoder when we recognised the signature.
    if (format) {
      try {
        const codec = await getCodec(format)
        if (codec.decode) return await codec.decode(buffer)
      } catch {
        // Surface the original native error below.
      }
    }
    throw error
  }
}

export function downscaleImageData(
  imageData: ImageData,
  maxLongEdge: number,
): ImageData {
  const { width, height } = imageData
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) return imageData

  const scale = maxLongEdge / longEdge
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const source = createContext(width, height)
  source.putImageData(imageData, 0, 0)

  const target = createContext(targetWidth, targetHeight)
  target.imageSmoothingEnabled = true
  target.imageSmoothingQuality = 'medium'
  target.drawImage(source.canvas, 0, 0, targetWidth, targetHeight)

  return target.getImageData(0, 0, targetWidth, targetHeight)
}
