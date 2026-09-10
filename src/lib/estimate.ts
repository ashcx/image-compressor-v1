import type { OutputFormat } from './codecs/types'
import { encodeImageData } from './convert'
import { downscaleImageData } from './image'

const SAMPLE_LONG_EDGE = 256
const SAMPLE_QUALITIES = [10, 30, 50, 70, 90, 100]

// Downscaling strips high-frequency detail, so a thumbnail compresses better
// per pixel than the full image. This rough factor corrects for that bias.
// The exact encode later replaces the estimate, so precision here is not critical.
const DETAIL_BIAS = 1.3

export interface SizeEstimator {
  at(quality: number): number
}

interface Sample {
  quality: number
  bytes: number
}

export async function buildSizeEstimator(
  imageData: ImageData,
  format: OutputFormat,
): Promise<SizeEstimator> {
  const thumbnail = downscaleImageData(imageData, SAMPLE_LONG_EDGE)
  const pixelRatio =
    (imageData.width * imageData.height) / (thumbnail.width * thumbnail.height)
  const bias = thumbnail === imageData ? 1 : DETAIL_BIAS

  const samples: Sample[] = []
  for (const quality of SAMPLE_QUALITIES) {
    const result = await encodeImageData(thumbnail, format, { quality })
    samples.push({
      quality,
      bytes: Math.round(result.blob.size * pixelRatio * bias),
    })
  }

  return {
    at(quality: number) {
      return interpolate(samples, quality)
    },
  }
}

export function interpolate(samples: Sample[], quality: number): number {
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
