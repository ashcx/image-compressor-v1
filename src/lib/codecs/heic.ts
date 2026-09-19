type ElheifModule = typeof import('elheif')

export interface DecodedBitmap {
  width: number
  height: number
  data: Uint8Array
}

export interface HeicEncodeOptions {
  quality?: number
  speed?: number
}

/**
 * UI speed values index this list. Only the quickest preset is exposed for now
 * (as "Default"); the indices are stable because select values are persisted per
 * format, so any future presets must be appended.
 */
export const HEIC_PRESETS = ['ultrafast'] as const

const DEFAULT_SPEED = 0

/** Maps a select value to a kvazaar preset name, clamped to the valid range. */
export function heicPresetForSpeed(speed: number | undefined): string {
  const index = Math.min(
    HEIC_PRESETS.length - 1,
    Math.max(0, Math.round(speed ?? DEFAULT_SPEED)),
  )
  return HEIC_PRESETS[index]
}

let loaded: Promise<ElheifModule> | null = null

/**
 * Loads and initialises the HEIC WASM module on first use. The module is only
 * imported when a HEIC job actually runs, so JPEG/PNG/WebP/AVIF never pay for
 * it. Must run inside a worker: it is never imported on the main thread.
 */
function load(): Promise<ElheifModule> {
  if (loaded === null) {
    loaded = import('elheif').then(async (module) => {
      await module.ensureInitialized()
      return module
    })
  }
  return loaded
}

/**
 * The elheif decode binding appends the RGBA plane twice, so the returned
 * buffer is twice `width * height * 4`. Trim it back to one image and copy it
 * into a fresh buffer suitable for `ImageData`.
 */
export function fitDecodedBitmap(bitmap: DecodedBitmap): DecodedBitmap {
  const expected = bitmap.width * bitmap.height * 4
  if (bitmap.data.length <= expected) return bitmap
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: bitmap.data.slice(0, expected),
  }
}

export async function decodeHeic(buffer: ArrayBuffer): Promise<ImageData> {
  const { jsDecodeImage } = await load()
  const result = jsDecodeImage(new Uint8Array(buffer))
  if (result.err) throw new Error(`Could not decode HEIC: ${result.err}`)
  const bitmap = result.data[0]
  if (!bitmap) throw new Error('HEIC file does not contain an image')

  const fitted = fitDecodedBitmap(bitmap)
  const data = new Uint8ClampedArray(fitted.width * fitted.height * 4)
  data.set(fitted.data)
  return new ImageData(data, fitted.width, fitted.height)
}

export async function encodeHeic(
  source: ImageData,
  options: HeicEncodeOptions = {},
): Promise<Blob> {
  const { jsEncodeImage } = await load()
  const quality = Math.min(100, Math.max(0, Math.round(options.quality ?? 75)))
  const result = jsEncodeImage(
    new Uint8Array(source.data),
    source.width,
    source.height,
    quality,
    heicPresetForSpeed(options.speed),
  )
  if (result.err) throw new Error(`Could not encode HEIC: ${result.err}`)
  const output = new Uint8Array(result.data.length)
  output.set(result.data)
  return new Blob([output], { type: 'image/heic' })
}
