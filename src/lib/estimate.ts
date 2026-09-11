import { FORMAT_SPECS } from './codecs/formats'
import type { OutputFormat } from './codecs/types'
import { encodeImageData } from './convert'
import { downscaleImageData } from './image'

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
  effort?: number
  speed?: number
}

export async function buildEstimateSamples(
  imageData: ImageData,
  format: OutputFormat,
  options: EstimateOptions = {},
): Promise<EstimateSample[]> {
  const small = downscaleImageData(imageData, SMALL_LONG_EDGE)
  const large = downscaleImageData(imageData, LARGE_LONG_EDGE)

  const smallPixels = small.width * small.height
  const largePixels = large.width * large.height
  const fullPixels = imageData.width * imageData.height

  const measure = async (data: ImageData, quality: number) =>
    (
      await encodeImageData(data, format, {
        quality,
        effort: options.effort,
        speed: options.speed,
      })
    ).buffer.byteLength

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

export function interpolate(
  samples: EstimateSample[],
  quality: number,
): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (quality <= first.quality) return first.bytes
  if (quality >= last.quality) return last.bytes

  for (let index = 1; index < samples.length; index += 1) {
    const lower = samples[index - 1]
    const upper = samples[index]
    if (quality <= upper.quality) {
      const ratio = (quality - lower.quality) / (upper.quality - lower.quality)
      return Math.round(lower.bytes + ratio * (upper.bytes - lower.bytes))
    }
  }

  return last.bytes
}
