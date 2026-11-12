import { context2d, createCanvas } from './canvas'
import type { ImageSource } from './codecs/types'

export const THUMBNAIL_SHORT_EDGE = 96
export const THUMBNAIL_QUALITY = 0.6
export const THUMBNAIL_MIME_TYPE = 'image/jpeg'
// Matches --panel in app.css so transparent sources composite cleanly.
const THUMBNAIL_BACKGROUND = '#161a21'

function thumbnailSize(source: ImageSource) {
  const short = Math.min(source.width, source.height)
  const scale = short > THUMBNAIL_SHORT_EDGE ? THUMBNAIL_SHORT_EDGE / short : 1
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  }
}

/**
 * Tiny JPEG preview (alpha flattened onto the panel colour) so list rows never
 * decode a full-resolution output just to paint a 40px box.
 */
export async function createThumbnail(source: ImageSource): Promise<Blob> {
  const { width, height } = thumbnailSize(source)
  const canvas = createCanvas(width, height)
  const context = context2d(canvas)
  context.fillStyle = THUMBNAIL_BACKGROUND
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.canvas, 0, 0, width, height)
  return canvas.convertToBlob({
    type: THUMBNAIL_MIME_TYPE,
    quality: THUMBNAIL_QUALITY,
  })
}
