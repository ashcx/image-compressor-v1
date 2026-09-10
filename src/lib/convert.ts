import { getCodec } from './codecs/registry'
import type { EncodeOptions, OutputFormat } from './codecs/types'

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
  const buffer = await codec.encode(imageData, options)

  return {
    buffer,
    width: imageData.width,
    height: imageData.height,
    format: codec.format,
    extension: codec.extension,
    mimeType: codec.mimeType,
  }
}
