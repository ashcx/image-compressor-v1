import { scaleImage } from './canvas'
import { FORMAT_SPECS } from './codecs/formats'
import type { ImageSource, OutputFormat } from './codecs/types'
import { encodeImageSource } from './convert'

// JPEG/WebP quality is a small fixed set, so we sample exactly those values:
// no quality interpolation is needed and every preset estimate is direct.
const SAMPLE_QUALITIES = [50, 75, 85, 94]
const SMALL_LONG_EDGE = 384
const LARGE_LONG_EDGE = 896

// Exponent bounds keep pathological inputs from producing wild sizes.
const MIN_EXPONENT = 0.2
const MAX_EXPONENT = 1.6

// Calibration fitted on a 25-image corpus (photographs from 0.3-26 MP plus UI
// screenshots, scanned text, flat graphics, gradients, noise and alpha images)
// using the estimate decode cap (<=2048px) and 384/896 sample encodes.
//
// Encoded size does not scale linearly with pixel count: downscaled samples
// lose high-frequency detail, so a naive pixel-ratio overestimates. We sample
// two downscaled sizes and derive the local scaling exponent
//   beta = ln(largeBytes / smallBytes) / ln(largePixels / smallPixels),
// then fit the full-resolution exponent as e = a + b * beta. The estimate is
//   bytes = exp(lnCal) * largeBytes * (fullPixels / largePixels) ** e.
// Each row is [a, b, lnCal].
const LIGHT_CALIBRATION: Record<
  'jpeg' | 'webp',
  Record<number, readonly [number, number, number]>
> = {
  jpeg: {
    50: [0.1995, 0.7919, -0.001],
    75: [0.0967, 0.8512, -0.0063],
    85: [0.1753, 0.7315, -0.0437],
    94: [0.2068, 0.5969, -0.0644],
  },
  webp: {
    50: [0.2067, 0.696, 0.05],
    75: [0.1305, 0.775, 0.0736],
    85: [0.1188, 0.7708, 0.0837],
    94: [0.196, 0.6236, 0.0673],
  },
}

// PNG is lossless, so calibration depends only on the compression mode.
const PNG_CALIBRATION: Record<number, readonly [number, number, number]> = {
  0: [-0.2048, 1.0887, 0.0483],
  1: [-0.3829, 1.3154, 0.0167],
  2: [-0.1992, 1.1411, 0.0363],
}

// AVIF quality is continuous and the speed setting shifts the size:
// e = a + b * beta + g * quality/100 + h * speed/10.
const AVIF_CALIBRATION: readonly [number, number, number, number, number] = [
  0.3285, 0.5225, -0.0697, 0.0182, 0.0383,
]

function clampExponent(value: number): number {
  return Math.min(MAX_EXPONENT, Math.max(MIN_EXPONENT, value))
}

function lightRow(
  format: 'jpeg' | 'webp',
  quality: number,
): readonly [number, number, number] {
  const table = LIGHT_CALIBRATION[format]
  if (table[quality]) return table[quality]
  let best = SAMPLE_QUALITIES[0]
  for (const q of SAMPLE_QUALITIES) {
    if (Math.abs(q - quality) < Math.abs(best - quality)) best = q
  }
  return table[best]
}

export function sampleBeta(
  largeBytes: number,
  largePixels: number,
  smallBytes: number,
  smallPixels: number,
): number {
  if (
    smallBytes <= 0 ||
    largeBytes <= 0 ||
    smallPixels <= 0 ||
    largePixels <= smallPixels
  ) {
    return 0
  }
  return Math.log(largeBytes / smallBytes) / Math.log(largePixels / smallPixels)
}

export interface EstimateTarget {
  quality?: number
  speed?: number
  mode?: number
}

/**
 * Extrapolates a sample encode to the full pixel count using the per-codec
 * calibrated exponent. Returns the sample size directly when the sample is
 * already at (or above) the full resolution.
 */
export function estimateFullBytes(
  format: OutputFormat,
  target: EstimateTarget,
  largeBytes: number,
  largePixels: number,
  smallBytes: number,
  smallPixels: number,
  fullPixels: number,
): number {
  if (largePixels >= fullPixels) return Math.round(largeBytes)

  const beta = sampleBeta(largeBytes, largePixels, smallBytes, smallPixels)

  let exponent: number
  let correction: number
  if (format === 'png') {
    const row = PNG_CALIBRATION[target.mode ?? 0] ?? PNG_CALIBRATION[0]
    exponent = clampExponent(row[0] + row[1] * beta)
    correction = row[2]
  } else if (format === 'avif') {
    const [a, b, g, h, lnCal] = AVIF_CALIBRATION
    const quality = (target.quality ?? 50) / 100
    const speed = (target.speed ?? 8) / 10
    exponent = clampExponent(a + b * beta + g * quality + h * speed)
    correction = lnCal
  } else {
    const row = lightRow(format, target.quality ?? 75)
    exponent = clampExponent(row[0] + row[1] * beta)
    correction = row[2]
  }

  return Math.round(
    Math.exp(correction) * largeBytes * (fullPixels / largePixels) ** exponent,
  )
}

export interface EstimateSample {
  quality: number
  bytes: number
}

interface EstimateOptions extends EstimateTarget {
  effort?: number
  /** True pixel size of the image being estimated. Estimates may run on a
   * scaled decode, so the decoded `source` size must not be used here. */
  fullWidth?: number
  fullHeight?: number
}

export async function buildEstimateSamples(
  source: ImageSource,
  format: OutputFormat,
  options: EstimateOptions = {},
): Promise<EstimateSample[]> {
  const small = scaleImage(source, SMALL_LONG_EDGE)
  const large = scaleImage(source, LARGE_LONG_EDGE)

  const smallPixels = small.width * small.height
  const largePixels = large.width * large.height
  const fullPixels =
    options.fullWidth && options.fullHeight
      ? options.fullWidth * options.fullHeight
      : source.width * source.height

  const measure = async (data: ImageSource, quality: number) =>
    (
      await encodeImageSource(data, format, {
        quality,
        effort: options.effort,
        speed: options.speed,
        mode: options.mode,
      })
    ).blob.size

  const estimate = async (quality: number) => {
    const smallBytes = await measure(small, quality)
    const largeBytes = await measure(large, quality)
    return estimateFullBytes(
      format,
      { quality, speed: options.speed, mode: options.mode },
      largeBytes,
      largePixels,
      smallBytes,
      smallPixels,
      fullPixels,
    )
  }

  // Lossless formats (PNG) ignore quality, so one measurement per thumbnail is
  // enough; expose it across the whole quality range so interpolation works.
  if (FORMAT_SPECS[format].lossless) {
    const bytes = await estimate(100)
    return [
      { quality: 0, bytes },
      { quality: 100, bytes },
    ]
  }

  // AVIF is expensive to estimate across the whole quality range, so measure
  // only the currently selected quality and re-estimate when the user moves
  // the slider.
  if (format === 'avif') {
    const quality = options.quality ?? 50
    return [{ quality, bytes: await estimate(quality) }]
  }

  const samples: EstimateSample[] = []
  for (const quality of SAMPLE_QUALITIES) {
    samples.push({ quality, bytes: await estimate(quality) })
  }

  return samples
}

function interpolateRaw(samples: EstimateSample[], quality: number): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (quality <= first.quality) return first.bytes
  if (quality >= last.quality) return last.bytes

  for (let index = 1; index < samples.length; index += 1) {
    const lower = samples[index - 1]
    const upper = samples[index]
    if (quality <= upper.quality) {
      const ratio = (quality - lower.quality) / (upper.quality - lower.quality)
      return lower.bytes + ratio * (upper.bytes - lower.bytes)
    }
  }

  return last.bytes
}

export function interpolate(
  samples: EstimateSample[],
  quality: number,
): number {
  return Math.round(interpolateRaw(samples, quality))
}

const SMALL_BATCH = 5
const HALF_BATCH_LIMIT = 10
const LIGHT_SAMPLE_CAP = 10
const HEAVY_SAMPLE_CAP = 5

/**
 * Bounded sampling so estimate cost does not grow with batch size:
 * ≤5 images estimate all; 6-10 estimate half; larger batches estimate 10
 * (light codecs) or 5 (heavy codecs) and extrapolate the rest.
 */
export function sampleSize(total: number, heavy = false): number {
  if (total <= SMALL_BATCH) return total
  if (total <= HALF_BATCH_LIMIT) return Math.ceil(total / 2)
  return heavy ? HEAVY_SAMPLE_CAP : LIGHT_SAMPLE_CAP
}

interface CurveSample {
  samples: EstimateSample[]
  originalSize: number
}

/**
 * Averages the per-image compression ratio at each sampled quality, so the
 * result can be applied to unmeasured images (`ratio x originalSize`).
 */
export function averageRatioSamples(curves: CurveSample[]): EstimateSample[] {
  const base = curves[0]?.samples
  if (!base || base.length === 0) return []

  return base.map((sample, index) => {
    let sum = 0
    let count = 0
    for (const curve of curves) {
      const point = curve.samples[index]
      if (!point || curve.originalSize <= 0) continue
      sum += point.bytes / curve.originalSize
      count += 1
    }
    return { quality: sample.quality, bytes: count > 0 ? sum / count : 0 }
  })
}

export function deriveEstimate(
  originalSize: number,
  ratios: EstimateSample[],
  quality: number,
): number {
  if (ratios.length === 0) return 0
  return Math.round(originalSize * interpolateRaw(ratios, quality))
}
