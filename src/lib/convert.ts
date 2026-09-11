import { getCodec } from './codecs/registry'
import type { EncodeOptions, OutputFormat } from './codecs/types'
import { resizeImageData } from './resize'

export interface EncodeResult {
  buffer: ArrayBuffer
  width: number
  height: number
  format: OutputFormat
  extension: string
  mimeType: string
}

export async function encodeImageData(
  imageData: ImageData,
  format: OutputFormat,
  options: EncodeOptions = {},
): Promise<EncodeResult> {
  const codec = await getCodec(format)
  const resized = await resizeImageData(imageData, options.resize)
  const buffer = await codec.encode(resized, options)

  return {
    buffer,
    width: resized.width,
    height: resized.height,
    format: codec.format,
    extension: codec.extension,
    mimeType: codec.mimeType,
  }
}
