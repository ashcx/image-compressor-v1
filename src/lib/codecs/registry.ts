import { toImageData } from '../canvas'
import type { Codec, ImageSource, OutputFormat } from './types'

type CodecLoader = () => Promise<Codec>

// `OffscreenCanvas.convertToBlob` exists in Safari but silently ignores types it
// cannot actually encode (notably image/webp), returning a PNG instead. Probing
// the real output MIME once per type stops us from shipping a PNG-sized file
// under a .webp name, and lets JPEG/WebP run with no WASM loaded at all.
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

async function encodeCanvas(
  source: ImageSource,
  type: string,
  quality?: number,
): Promise<Blob> {
  const options = quality != null ? { type, quality } : { type }
  const blob = await source.canvas.convertToBlob(options)
  if (blob.type !== type) {
    throw new Error(`This browser cannot encode ${type}`)
  }
  return blob
}

function wrap(buffer: ArrayBuffer, type: string): Blob {
  return new Blob([buffer], { type })
}

// JPEG and WebP use the browser's native encoder when it is available, so no
// codec package is fetched for them on Chromium/Firefox. Safari has no native
// WebP encoder, so the WASM encoder is imported lazily only in that case.
// AVIF/JXL (and the PNG compression modes) pull their WASM in lazily too.
const loaders: Record<OutputFormat, CodecLoader> = {
  jpeg: async () => ({
    format: 'jpeg',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    encode: async (source, options) => {
      if (!(await canEncodeNatively('image/jpeg'))) {
        throw new Error('JPEG encoding is not supported in this browser')
      }
      return encodeCanvas(source, 'image/jpeg', (options?.quality ?? 75) / 100)
    },
  }),
  png: async () => ({
    format: 'png',
    mimeType: 'image/png',
    extension: 'png',
    encode: async (source, options) => {
      const mode = options?.mode ?? 0
      if (mode === 2) {
        const { encodeImagequant } = await import('./imagequant')
        return wrap(await encodeImagequant(toImageData(source)), 'image/png')
      }
      if (mode === 1) {
        const { encode: pngEncode } = await import('@jsquash/png')
        const { optimise } = await import('@jsquash/oxipng')
        const encoded = await pngEncode(toImageData(source))
        return wrap(await optimise(encoded, { level: 0 }), 'image/png')
      }
      if (await canEncodeNatively('image/png')) {
        return encodeCanvas(source, 'image/png')
      }
      const { encode: pngEncode } = await import('@jsquash/png')
      return wrap(await pngEncode(toImageData(source)), 'image/png')
    },
    decode: async (buffer) => {
      const { decode } = await import('@jsquash/png')
      return decode(buffer)
    },
  }),
  webp: async () => ({
    format: 'webp',
    mimeType: 'image/webp',
    extension: 'webp',
    encode: async (source, options) => {
      if (await canEncodeNatively('image/webp')) {
        return encodeCanvas(
          source,
          'image/webp',
          (options?.quality ?? 75) / 100,
        )
      }
      // No native WebP encoder (Safari): fall back to WASM, fetched only now.
      // method 1 is ~3x faster than the default 4 for ~10% larger files.
      const { encode } = await import('@jsquash/webp')
      return wrap(
        await encode(toImageData(source), {
          ...(options?.quality != null ? { quality: options.quality } : {}),
          method: 1,
        }),
        'image/webp',
      )
    },
  }),
  avif: async () => {
    const { encode, decode } = await import('@jsquash/avif')
    return {
      format: 'avif',
      mimeType: 'image/avif',
      extension: 'avif',
      encode: async (source, options) =>
        wrap(
          await encode(toImageData(source), {
            ...(options?.quality != null ? { quality: options.quality } : {}),
            ...(options?.speed != null ? { speed: options.speed } : {}),
          }),
          'image/avif',
        ),
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
      encode: async (source, options) =>
        wrap(
          await encode(toImageData(source), {
            ...(options?.quality != null ? { quality: options.quality } : {}),
            ...(options?.effort != null ? { effort: options.effort } : {}),
          }),
          'image/jxl',
        ),
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

/**
 * Warms a codec's module (and WASM) so the first encode of a WASM format does
 * not stall the user. Call when AVIF/JXL is selected.
 */
export async function preloadCodec(format: OutputFormat): Promise<void> {
  await getCodec(format)
}

/**
 * Human-readable encoder backend currently in use, for the diagnostics line.
 * `png` depends on its compression mode; JPEG/WebP report native vs WASM.
 */
export async function describeRenderer(
  format: OutputFormat,
  mode?: number,
): Promise<string> {
  switch (format) {
    case 'jpeg':
      return (await canEncodeNatively('image/jpeg')) ? 'native' : 'unsupported'
    case 'webp':
      return (await canEncodeNatively('image/webp'))
        ? 'native'
        : 'WASM · libwebp'
    case 'png':
      if ((mode ?? 0) === 0) {
        return (await canEncodeNatively('image/png')) ? 'native' : 'WASM · png'
      }
      return (mode ?? 0) === 1 ? 'WASM · oxipng' : 'WASM · libimagequant'
    case 'avif':
      return 'WASM · avif'
    case 'jxl':
      return 'WASM · jxl'
  }
}
