import { getCodec } from './codecs/registry'
import type { EncodeOptions, ImageSource, OutputFormat } from './codecs/types'

export interface EncodeResult {
  blob: Blob
  width: number
  height: number
  format: OutputFormat
  extension: string
  mimeType: string
}

/**
 * Encodes an already-decoded (and optionally resized) source. The codec is
 * resolved lazily, so WASM codecs only load when a format that needs them is
 * actually used.
 */
export async function encodeImageSource(
  source: ImageSource,
  format: OutputFormat,
  options: EncodeOptions = {},
): Promise<EncodeResult> {
  const codec = await getCodec(format)
  const blob = await codec.encode(source, options)

  return {
    blob,
    width: source.width,
    height: source.height,
    format: codec.format,
    extension: codec.extension,
    mimeType: codec.mimeType,
  }
}
