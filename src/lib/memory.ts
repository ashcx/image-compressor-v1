import { isHeavyFormat } from './codecs/formats'
import type { OutputFormat } from './codecs/types'

/** Keep a little headroom below the configured budget. */
const HEADROOM = 0.9

/**
 * Approximate peak memory for one decoded image, as a multiple of its RGBA
 * bytes (`width * height * 4`). The multiplier counts the copies a codec path
 * holds at once:
 *
 * - native JPEG/PNG: decoded bitmap + drawing canvas + encoder working set
 * - WebP: libwebp WebAssembly on every browser, so charge the heavier path
 *   everywhere
 * - AVIF and compressed PNG: `toImageData` plus the WASM RGBA/YUV buffers
 */
export function formatMemoryWeight(format: OutputFormat, mode = 0): number {
  if (format === 'avif') return 5
  if (format === 'heic') return 5
  if (format === 'png') return isHeavyFormat('png', mode) ? 5 : 2.5
  if (format === 'webp') return 4
  return 2.5
}

/**
 * Peak memory of the libheif WebAssembly decoder as a multiple of the source's
 * RGBA bytes. Measured at 12 MP: the decoded plane, the copy returned to
 * JavaScript, and a WASM heap that is not released after the decode.
 */
export const WASM_HEIC_DECODE_WEIGHT = 8

/**
 * Estimated peak bytes held while one job at this size is in flight.
 * `wasmDecodePixels` is the full source size for a HEIC the browser cannot
 * decode natively: that decode ignores the resize target, so it is charged at
 * source size and competes with the encode for the larger of the two.
 */
export function jobCostBytes(
  pixels: number,
  format: OutputFormat,
  mode = 0,
  wasmDecodePixels = 0,
): number {
  return Math.max(
    pixels * 4 * formatMemoryWeight(format, mode),
    wasmDecodePixels * 4 * WASM_HEIC_DECODE_WEIGHT,
  )
}

/**
 * Largest decoded pixel count a single job may use so it still fits the
 * budget on its own. `Infinity` when gating is disabled. The scheduler always
 * admits one job, so clamping single jobs keeps that guarantee from blowing
 * the budget.
 */
export function maxJobPixels(
  budgetBytes: number,
  format: OutputFormat,
  mode = 0,
): number {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return (budgetBytes * HEADROOM) / (4 * formatMemoryWeight(format, mode))
}
