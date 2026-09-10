import { encode as encodeWebp } from '@jsquash/webp'

export interface ConversionResult {
  blob: Blob
  width: number
  height: number
}

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

export async function convertToWebp(
  blob: Blob,
  quality: number,
): Promise<ConversionResult> {
  const imageData = await blobToImageData(blob)
  const buffer = await encodeWebp(imageData, { quality })

  return {
    blob: new Blob([buffer], { type: 'image/webp' }),
    width: imageData.width,
    height: imageData.height,
  }
}
