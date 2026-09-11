import type { Codec, OutputFormat } from './types'

type CodecLoader = () => Promise<Codec>

// `OffscreenCanvas.convertToBlob` exists in Safari but silently ignores types it
// cannot actually encode (notably image/webp), returning a PNG instead. Probing
// the real output MIME once per type and caching it stops us from shipping a
// PNG-sized file under a .webp name. Falls back to the WASM encoder otherwise.
const nativeSupport = new Map<string, Promise<boolean>>()

function canEncodeNatively(type: string): Promise<boolean> {
  const cached = nativeSupport.get(type)
  if (cached) return cached
  const probe = (async () => {
    if (
      typeof OffscreenCanvas === 'undefined' ||
      typeof OffscreenCanvas.prototype.convertToBlob !== 'function'
    ) {
      return false
    }
    try {
      const canvas = new OffscreenCanvas(2, 2)
      const context = canvas.getContext('2d')
      if (!context) return false
      context.fillStyle = '#000'
      context.fillRect(0, 0, 2, 2)
      const blob = await canvas.convertToBlob({ type, quality: 0.75 })
      return blob.type === type
    } catch {
      return false
    }
  })()
  nativeSupport.set(type, probe)
  return probe
}

async function encodeWithCanvas(
  imageData: ImageData,
  type: string,
  quality?: number,
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  context.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob(
    quality != null ? { type, quality } : { type },
  )
  return blob.arrayBuffer()
}

// JPEG and WebP prefer the browser's native encoder (OffscreenCanvas.convertToBlob),
// which is much faster and avoids the WASM/ImageData copies. jsquash remains the
// fallback for browsers without real support and covers AVIF/JXL/PNG.
const loaders: Record<OutputFormat, CodecLoader> = {
  jpeg: async () => {
    const { encode: jsquashEncode, decode } = await import('@jsquash/jpeg')
    return {
      format: 'jpeg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      encode: async (imageData, options) => {
        if (await canEncodeNatively('image/jpeg')) {
          return encodeWithCanvas(
            imageData,
            'image/jpeg',
            (options?.quality ?? 75) / 100,
          )
        }
        return jsquashEncode(
          imageData,
          options?.quality != null ? { quality: options.quality } : {},
        )
      },
      decode: (buffer) => decode(buffer),
    }
  },
  png: async () => {
    const { encode: pngEncode, decode } = await import('@jsquash/png')
    const { optimise } = await import('@jsquash/oxipng')
    const { encodeImagequant } = await import('./imagequant')
    return {
      format: 'png',
      mimeType: 'image/png',
      extension: 'png',
      encode: async (imageData, options) => {
        const mode = options?.mode ?? 0
        if (mode === 2) return encodeImagequant(imageData)
        const encoded = await pngEncode(imageData)
        if (mode === 1) return optimise(encoded, { level: 0 })
        if (await canEncodeNatively('image/png'))
          return encodeWithCanvas(imageData, 'image/png')
        return encoded
      },
      decode: (buffer) => decode(buffer),
    }
  },
  webp: async () => {
    const { encode: jsquashEncode, decode } = await import('@jsquash/webp')
    return {
      format: 'webp',
      mimeType: 'image/webp',
      extension: 'webp',
      encode: async (imageData, options) => {
        if (await canEncodeNatively('image/webp')) {
          return encodeWithCanvas(
            imageData,
            'image/webp',
            (options?.quality ?? 75) / 100,
          )
        }
        return jsquashEncode(
          imageData,
          options?.quality != null ? { quality: options.quality } : {},
        )
      },
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
