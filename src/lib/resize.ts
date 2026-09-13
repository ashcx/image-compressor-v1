import { context2d, createCanvas } from './canvas'
import type { ImageSource, ResizeOptions } from './codecs/types'

export interface ResolvedSize {
  width: number
  height: number
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): ResolvedSize {
  const scale = Math.min(maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function resolveResize(
  width: number,
  height: number,
  resize: ResizeOptions | undefined,
): ResolvedSize | null {
  if (!resize) return null

  if (resize.maxLongEdge && resize.maxLongEdge > 0) {
    const longEdge = Math.max(width, height)
    if (longEdge <= resize.maxLongEdge) return null
    const scale = resize.maxLongEdge / longEdge
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  }

  const maxWidth = resize.width && resize.width > 0 ? resize.width : width
  const maxHeight = resize.height && resize.height > 0 ? resize.height : height
  if (maxWidth >= width && maxHeight >= height) return null

  return fitWithin(width, height, maxWidth, maxHeight)
}

export function resizeImage(
  source: ImageSource,
  resize: ResizeOptions | undefined,
): ImageSource {
  const size = resolveResize(source.width, source.height, resize)
  if (!size) return source

  const canvas = createCanvas(size.width, size.height)
  const context = context2d(canvas)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.canvas, 0, 0, size.width, size.height)
  return { width: size.width, height: size.height, canvas }
}

/**
 * Chooses the size to decode at so a downscaled output never pays for a
 * full-resolution decode. Applies the requested resize first, then an optional
 * long-edge cap (used by estimates), and returns `null` when the image should be
 * decoded at full resolution.
 */
export function resolveDecodeSize(
  width: number,
  height: number,
  resize: ResizeOptions | undefined,
  capLongEdge?: number,
): ResolvedSize | null {
  let targetWidth = width
  let targetHeight = height

  const target = resolveResize(width, height, resize)
  if (target) {
    targetWidth = target.width
    targetHeight = target.height
  }

  if (capLongEdge && capLongEdge > 0) {
    const capped = resolveResize(targetWidth, targetHeight, {
      maxLongEdge: capLongEdge,
    })
    if (capped) {
      targetWidth = capped.width
      targetHeight = capped.height
    }
  }

  if (targetWidth >= width && targetHeight >= height) return null
  return { width: targetWidth, height: targetHeight }
}
