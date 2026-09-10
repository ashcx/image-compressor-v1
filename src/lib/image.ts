export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob)

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is unavailable')
    }

    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
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

  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) {
    throw new Error('Canvas 2D context is unavailable')
  }
  sourceContext.putImageData(imageData, 0, 0)

  const target = document.createElement('canvas')
  target.width = targetWidth
  target.height = targetHeight
  const targetContext = target.getContext('2d')
  if (!targetContext) {
    throw new Error('Canvas 2D context is unavailable')
  }
  targetContext.imageSmoothingEnabled = true
  targetContext.imageSmoothingQuality = 'medium'
  targetContext.drawImage(source, 0, 0, targetWidth, targetHeight)

  return targetContext.getImageData(0, 0, targetWidth, targetHeight)
}
