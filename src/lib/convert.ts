import { getCodec } from './codecs/registry'
import type { EncodeOptions, OutputFormat } from './codecs/types'
import { blobToImageData } from './image'

export interface ConversionResult {
  blob: Blob
  width: number
  height: number
  format: OutputFormat
  extension: string
}

export async function encodeImageData(
  imageData: ImageData,
  format: OutputFormat,
  options: EncodeOptions = {},
): Promise<ConversionResult> {
  const codec = await getCodec(format)
  const buffer = await codec.encode(imageData, options)

  return {
    blob: new Blob([buffer], { type: codec.mimeType }),
    width: imageData.width,
    height: imageData.height,
    format: codec.format,
    extension: codec.extension,
  }
}

export async function convertImage(
  blob: Blob,
  format: OutputFormat,
  options: EncodeOptions = {},
): Promise<ConversionResult> {
  const imageData = await blobToImageData(blob)
  return encodeImageData(imageData, format, options)
}
