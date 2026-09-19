import { toImageData } from '../canvas'
import { decodeSample } from './decode-samples'
import type { Codec, ImageSource, OutputFormat } from './types'

type CodecLoader = () => Promise<Codec>

const DECODE_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
}

// `OffscreenCanvas.convertToBlob` exists in Safari but silently ignores types it
// cannot actually encode (notably image/webp), returning a PNG instead. Probing
// the real output MIME once per type stops us from shipping a PNG-sized file
// under a .webp name, and lets JPEG/WebP run with no WASM loaded at all.
const nativeSupport = new Map<string, Promise<boolean>>()

export function canEncodeNatively(type: string): Promise<boolean> {
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

// Native decode support is probed with tiny embedded samples rather than a
// static table, because it varies by engine: Chrome/Firefox decode AVIF but not
// HEIC, Safari decodes both, and JPEG/PNG/WebP are near-universal. `decodeSample`
// bytes are decoded through `createImageBitmap`, the exact native path
// `decodeImageData` tries before falling back to WASM.
const nativeDecodeSupport = new Map<string, Promise<boolean>>()

export function canDecodeNatively(type: string): Promise<boolean> {
  const cached = nativeDecodeSupport.get(type)
  if (cached) return cached
  const probe = (async () => {
    if (typeof createImageBitmap !== 'function') return false
    const sample = decodeSample(type)
    if (sample) {
      try {
        const blob = new Blob([sample], { type })
        const bitmap = await createImageBitmap(blob)
        bitmap.close()
        return true
      } catch {
        // Fall through to the WebCodecs hint, which can still report support
        // (e.g. a probe sample the platform's image pipeline rejects).
      }
    }
    const decoder =
      typeof ImageDecoder === 'undefined' ? undefined : ImageDecoder
    if (decoder && typeof decoder.isTypeSupported === 'function') {
      try {
        return await decoder.isTypeSupported(type)
      } catch {
        return false
      }
    }
    return false
  })()
  nativeDecodeSupport.set(type, probe)
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
// AVIF (and the PNG compression modes) pull their WASM in lazily too.
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
  heic: async () => {
    const { decodeHeic, encodeHeic } = await import('./heic')
    return {
      format: 'heic',
      mimeType: 'image/heic',
      extension: 'heic',
      encode: async (source, options) =>
        encodeHeic(toImageData(source), options),
      decode: async (buffer) => decodeHeic(buffer),
    }
  },
}

export async function getCodec(format: OutputFormat): Promise<Codec> {
  const loader = loaders[format]
  if (!loader) {
    throw new Error(`No codec available for format: ${format}`)
  }
  return loader()
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
    case 'heic':
      return 'WASM · libheif/kvazaar'
  }
}

/**
 * Human-readable decoder path for a format, for the diagnostics page. Unlike
 * the encoder line this used to be a static string, which mislabelled Chrome as
 * "native (Safari)". It now probes native decode support and reports the WASM
 * decoder only when the native one is unavailable. JPEG/WebP have no WASM
 * fallback; PNG, AVIF, and HEIC do (`decodeImageData` in `lib/image.ts`).
 */
export async function describeDecoder(format: OutputFormat): Promise<string> {
  const native = await canDecodeNatively(DECODE_MIME[format])
  switch (format) {
    case 'jpeg':
    case 'webp':
      return native ? 'native (browser)' : 'unsupported'
    case 'png':
      return native ? 'native (browser)' : 'WASM · @jsquash/png'
    case 'avif':
      return native ? 'native (browser)' : 'WASM · @jsquash/avif'
    case 'heic':
      return native ? 'native (browser)' : 'WASM · libheif/libde265'
  }
}
