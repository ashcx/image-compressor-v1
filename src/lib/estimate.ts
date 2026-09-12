import { scaleImage } from './canvas'
import { FORMAT_SPECS } from './codecs/formats'
import type { ImageSource, OutputFormat } from './codecs/types'
import { encodeImageSource } from './convert'

const SAMPLE_QUALITIES = [10, 30, 50, 70, 90, 100]
const SMALL_LONG_EDGE = 192
const LARGE_LONG_EDGE = 448

// Encoded size does not scale linearly with pixel count: smaller images carry
// relatively more per-pixel overhead, so a naive "thumbnail bytes x pixel ratio"
// overestimates badly (worse at high quality and large sizes). Instead we sample
// two downscaled sizes at each quality and fit a power law bytes = k * pixels^beta,
// then extrapolate to the full resolution.
const MIN_BETA = 0.35
const MAX_BETA = 0.8

// Residual calibration on top of the power-law fit, tuned against real photos
// (estimate/exact geometric mean ~= 1.0). This is a deliberately rough estimate
// that the exact encode replaces within the debounce window.
const SIZE_CALIBRATION = 1.25

export interface EstimateSample {
  quality: number
  bytes: number
}

export function scaleToFullSize(
  largeBytes: number,
  largePixels: number,
  smallBytes: number,
  smallPixels: number,
  fullPixels: number,
): number {
  if (
    largePixels >= fullPixels ||
    smallBytes <= 0 ||
    largeBytes <= 0 ||
    smallPixels >= largePixels
  ) {
    return Math.round(largeBytes * (fullPixels / largePixels))
  }

  const beta = Math.min(
    MAX_BETA,
    Math.max(
      MIN_BETA,
      Math.log(largeBytes / smallBytes) / Math.log(largePixels / smallPixels),
    ),
  )

  return Math.round(largeBytes * (fullPixels / largePixels) ** beta)
}

export interface EstimateOptions {
  quality?: number
  effort?: number
  speed?: number
  mode?: number
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

  // Lossless formats (PNG) ignore quality, so one measurement per thumbnail is
  // enough; expose it across the whole quality range so interpolation works.
  if (FORMAT_SPECS[format].lossless) {
    const smallBytes = await measure(small, 100)
    const largeBytes = await measure(large, 100)
    const bytes = Math.round(
      scaleToFullSize(
        largeBytes,
        largePixels,
        smallBytes,
        smallPixels,
        fullPixels,
      ) * SIZE_CALIBRATION,
    )
    return [
      { quality: 0, bytes },
      { quality: 100, bytes },
    ]
  }

  // AVIF/JXL are expensive to estimate across the whole quality range, so
  // measure only the currently selected quality and re-estimate (debounced)
  // when the user moves the slider.
  if (format === 'avif') {
    const quality = options.quality ?? 50
    const smallBytes = await measure(small, quality)
    const largeBytes = await measure(large, quality)
    const bytes = Math.round(
      scaleToFullSize(
        largeBytes,
        largePixels,
        smallBytes,
        smallPixels,
        fullPixels,
      ) * SIZE_CALIBRATION,
    )
    return [{ quality, bytes }]
  }

  const samples: EstimateSample[] = []
  for (const quality of SAMPLE_QUALITIES) {
    const smallBytes = await measure(small, quality)
    const largeBytes = await measure(large, quality)
    samples.push({
      quality,
      bytes: Math.round(
        scaleToFullSize(
          largeBytes,
          largePixels,
          smallBytes,
          smallPixels,
          fullPixels,
        ) * SIZE_CALIBRATION,
      ),
    })
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

export interface CurveSample {
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
