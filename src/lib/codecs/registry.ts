import type { Codec, OutputFormat } from './types'

type CodecLoader = () => Promise<Codec>

// Each entry is loaded via dynamic import so the codec (and its WASM) only ships
// when a job actually targets that format. Remaining formats land in Sprint 6.
const loaders: Partial<Record<OutputFormat, CodecLoader>> = {
  webp: async () => {
    const { encode } = await import('@jsquash/webp')
    return {
      format: 'webp',
      mimeType: 'image/webp',
      extension: 'webp',
      encode: (imageData, options) =>
        encode(
          imageData,
          options?.quality != null ? { quality: options.quality } : {},
        ),
    }
  },
}

export function isFormatSupported(format: OutputFormat): boolean {
  return format in loaders
}

export async function getCodec(format: OutputFormat): Promise<Codec> {
  const loader = loaders[format]
  if (!loader) {
    throw new Error(`No codec available for format: ${format}`)
  }
  return loader()
}
