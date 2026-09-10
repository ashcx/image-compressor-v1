import type { Codec, OutputFormat } from './types'

type CodecLoader = () => Promise<Codec>

// Each entry is loaded via dynamic import so a codec (and its WASM) only ships
// when a job actually targets that format. PNG is lossless via @jsquash/png and
// is squeezed afterwards with oxipng; JPEG/WebP/AVIF/JXL carry an explicit
// quality (and, where the encoder supports it, an effort/speed knob).
const loaders: Record<OutputFormat, CodecLoader> = {
  jpeg: async () => {
    const { encode, decode } = await import('@jsquash/jpeg')
    return {
      format: 'jpeg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      encode: (imageData, options) =>
        encode(
          imageData,
          options?.quality != null ? { quality: options.quality } : {},
        ),
      decode: (buffer) => decode(buffer),
    }
  },
  png: async () => {
    const { encode, decode } = await import('@jsquash/png')
    const { optimise } = await import('@jsquash/oxipng')
    return {
      format: 'png',
      mimeType: 'image/png',
      extension: 'png',
      encode: async (imageData, options) => {
        const encoded = await encode(imageData)
        return optimise(
          encoded,
          options?.effort != null ? { level: options.effort } : {},
        )
      },
      decode: (buffer) => decode(buffer),
    }
  },
  webp: async () => {
    const { encode, decode } = await import('@jsquash/webp')
    return {
      format: 'webp',
      mimeType: 'image/webp',
      extension: 'webp',
      encode: (imageData, options) =>
        encode(
          imageData,
          options?.quality != null ? { quality: options.quality } : {},
        ),
      decode: (buffer) => decode(buffer),
    }
  },
  avif: async () => {
    const { encode, decode } = await import('@jsquash/avif')
    return {
      format: 'avif',
      mimeType: 'image/avif',
      extension: 'avif',
      encode: (imageData, options) =>
        encode(imageData, {
          ...(options?.quality != null ? { quality: options.quality } : {}),
          ...(options?.speed != null ? { speed: options.speed } : {}),
        }),
      decode: async (buffer) => {
        const decoded = await decode(buffer)
        if (!decoded) throw new Error('Failed to decode AVIF image')
        return decoded
      },
    }
  },
  jxl: async () => {
    const { encode, decode } = await import('@jsquash/jxl')
    return {
      format: 'jxl',
      mimeType: 'image/jxl',
      extension: 'jxl',
      encode: (imageData, options) =>
        encode(imageData, {
          ...(options?.quality != null ? { quality: options.quality } : {}),
          ...(options?.effort != null ? { effort: options.effort } : {}),
        }),
      decode: (buffer) => decode(buffer),
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
