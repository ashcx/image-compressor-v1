import type { ResizeOptions } from './codecs/types'

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

export async function resizeImageData(
  imageData: ImageData,
  resize: ResizeOptions | undefined,
): Promise<ImageData> {
  const size = resolveResize(imageData.width, imageData.height, resize)
  if (!size) return imageData

  const { default: resizeWasm } = await import('@jsquash/resize')
  return resizeWasm(imageData, {
    width: size.width,
    height: size.height,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: false,
    linearRGB: false,
  })
}
