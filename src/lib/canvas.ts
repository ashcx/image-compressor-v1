import type { ImageSource } from './codecs/types'

export function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height)
}

export function context2d(
  canvas: OffscreenCanvas,
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  return context
}

export function imageDataToSource(imageData: ImageData): ImageSource {
  const canvas = createCanvas(imageData.width, imageData.height)
  context2d(canvas).putImageData(imageData, 0, 0)
  return { width: imageData.width, height: imageData.height, canvas }
}

/**
 * Only called by WASM codecs. The native encoder path consumes the canvas
 * directly and never materializes an `ImageData`.
 */
export function toImageData(source: ImageSource): ImageData {
  return context2d(source.canvas).getImageData(
    0,
    0,
    source.width,
    source.height,
  )
}

export function scaleImage(
  source: ImageSource,
  maxLongEdge: number,
): ImageSource {
  const longEdge = Math.max(source.width, source.height)
  if (longEdge <= maxLongEdge) return source

  const scale = maxLongEdge / longEdge
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = createCanvas(width, height)
  const context = context2d(canvas)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.canvas, 0, 0, width, height)
  return { width, height, canvas }
}
