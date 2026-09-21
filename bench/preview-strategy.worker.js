import { scaleImage } from '../src/lib/canvas.ts'
import { decodeImageData } from '../src/lib/image.ts'
import { createThumbnail } from '../src/lib/thumbnail.ts'

const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
}

const SHORT_EDGE = 96
const DECODE_HINT = 256

function pixels(width, height) {
  return width * height * 4
}

function shortEdgeSize(width, height) {
  const short = Math.min(width, height)
  const scale = short > SHORT_EDGE ? SHORT_EDGE / short : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function longEdgeForShort(width, height) {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  if (short <= SHORT_EDGE) return long
  return Math.round((long / short) * SHORT_EDGE)
}

function canvasFor(width, height) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  return { canvas, context }
}

async function encodeJpeg(canvas) {
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 })
}

async function nativeCurrent(blob) {
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: DECODE_HINT,
    resizeQuality: 'high',
  })
  const decodedWidth = bitmap.width
  const decodedHeight = bitmap.height
  const source = canvasFor(bitmap.width, bitmap.height)
  source.context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const preview = await createThumbnail({
    width: source.canvas.width,
    height: source.canvas.height,
    canvas: source.canvas,
  })
  const target = shortEdgeSize(source.canvas.width, source.canvas.height)
  return {
    outputBytes: preview.size,
    rasterBytes:
      pixels(decodedWidth, decodedHeight) +
      pixels(source.canvas.width, source.canvas.height) +
      pixels(target.width, target.height),
    decodedWidth: source.canvas.width,
    decodedHeight: source.canvas.height,
  }
}

async function nativeBitmap(blob, width, height) {
  const target = shortEdgeSize(width, height)
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  })
  const display = canvasFor(bitmap.width, bitmap.height)
  display.context.drawImage(bitmap, 0, 0)
  const result = {
    outputBytes: 0,
    rasterBytes:
      pixels(bitmap.width, bitmap.height) +
      pixels(display.canvas.width, display.canvas.height),
    decodedWidth: bitmap.width,
    decodedHeight: bitmap.height,
  }
  bitmap.close()
  return result
}

async function nativeJpeg(blob, width, height) {
  const target = shortEdgeSize(width, height)
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  })
  const display = canvasFor(bitmap.width, bitmap.height)
  display.context.drawImage(bitmap, 0, 0)
  const output = await encodeJpeg(display.canvas)
  const result = {
    outputBytes: output.size,
    rasterBytes:
      pixels(bitmap.width, bitmap.height) +
      pixels(display.canvas.width, display.canvas.height),
    decodedWidth: bitmap.width,
    decodedHeight: bitmap.height,
  }
  bitmap.close()
  return result
}

async function fallbackSource(buffer, format) {
  // This intentionally follows the existing fallback shape: the registered
  // WASM decoder receives the source bytes, then the decoded source is scaled.
  return decodeImageData(buffer, format, { maxEdge: DECODE_HINT })
}

async function fallbackCurrent(buffer, format) {
  const source = await fallbackSource(buffer, format)
  const bounded = scaleImage(source, DECODE_HINT)
  const output = await createThumbnail(bounded)
  const target = shortEdgeSize(bounded.width, bounded.height)
  return {
    outputBytes: output.size,
    rasterBytes:
      pixels(source.width, source.height) +
      pixels(bounded.width, bounded.height) +
      pixels(target.width, target.height),
    decodedWidth: source.width,
    decodedHeight: source.height,
    path: 'codec-fallback',
  }
}

async function fallbackBitmap(buffer, format) {
  const source = await fallbackSource(buffer, format)
  const bounded = scaleImage(
    source,
    longEdgeForShort(source.width, source.height),
  )
  return {
    outputBytes: 0,
    rasterBytes:
      pixels(source.width, source.height) +
      pixels(bounded.width, bounded.height),
    decodedWidth: source.width,
    decodedHeight: source.height,
    path: 'codec-fallback',
  }
}

async function fallbackJpeg(buffer, format) {
  const source = await fallbackSource(buffer, format)
  const bounded = scaleImage(
    source,
    longEdgeForShort(source.width, source.height),
  )
  const output = await encodeJpeg(bounded.canvas)
  return {
    outputBytes: output.size,
    rasterBytes:
      pixels(source.width, source.height) +
      pixels(bounded.width, bounded.height),
    decodedWidth: source.width,
    decodedHeight: source.height,
    path: 'codec-fallback',
  }
}

const strategies = [
  ['current-jpeg', nativeCurrent, fallbackCurrent],
  ['small-bitmap-canvas', nativeBitmap, fallbackBitmap],
  ['small-jpeg', nativeJpeg, fallbackJpeg],
]

async function runStrategy(
  name,
  native,
  fallback,
  buffer,
  format,
  width,
  height,
) {
  const times = []
  let first
  let last
  for (let index = 0; index < 1 + Math.max(1, self.__repeats); index += 1) {
    const started = performance.now()
    let result
    try {
      result = await native(
        new Blob([buffer], { type: MIME[format] }),
        width,
        height,
      )
    } catch {
      result = await fallback(buffer, format)
    }
    const elapsedMs = performance.now() - started
    if (index === 0) first = elapsedMs
    else times.push(elapsedMs)
    last = result
  }
  const ordered = [...times].sort((a, b) => a - b)
  return {
    strategy: name,
    path: last.path ?? 'native',
    coldMs: first,
    medianMs: ordered[Math.floor(ordered.length / 2)],
    p95Ms:
      ordered[
        Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)
      ],
    outputBytes: last.outputBytes,
    estimatedPeakRasterBytes: last.rasterBytes,
    decodedWidth: last.decodedWidth,
    decodedHeight: last.decodedHeight,
  }
}

self.onmessage = async (event) => {
  const { id, buffer, format, width, height, repeats } = event.data
  self.__repeats = repeats
  try {
    const results = []
    for (const [name, native, fallback] of strategies) {
      results.push(
        await runStrategy(
          name,
          native,
          fallback,
          buffer,
          format,
          width,
          height,
        ),
      )
    }
    self.postMessage({ id, result: { format, results } })
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
