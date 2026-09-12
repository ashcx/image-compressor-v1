import { describe, expect, it } from 'vitest'
import {
  averageRatioSamples,
  deriveEstimate,
  estimateFullBytes,
  interpolate,
  sampleBeta,
  sampleSize,
} from './estimate'

const samples = [
  { quality: 10, bytes: 1000 },
  { quality: 50, bytes: 3000 },
  { quality: 100, bytes: 6000 },
]

describe('interpolate', () => {
  it('clamps below the lowest sample', () => {
    expect(interpolate(samples, 1)).toBe(1000)
  })

  it('clamps above the highest sample', () => {
    expect(interpolate(samples, 100)).toBe(6000)
    expect(interpolate(samples, 120)).toBe(6000)
  })

  it('interpolates between two samples', () => {
    expect(interpolate(samples, 30)).toBe(2000)
    expect(interpolate(samples, 75)).toBe(4500)
  })

  it('returns the exact sample value at a sample point', () => {
    expect(interpolate(samples, 50)).toBe(3000)
  })

  it('increases monotonically with quality', () => {
    let previous = 0
    for (let quality = 1; quality <= 100; quality += 1) {
      const current = interpolate(samples, quality)
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})

describe('sampleBeta', () => {
  it('derives the local scaling exponent from two samples', () => {
    expect(sampleBeta(1000, 4000, 400, 1000)).toBeCloseTo(0.661, 2)
  })

  it('returns zero for degenerate samples', () => {
    expect(sampleBeta(0, 4000, 400, 1000)).toBe(0)
    expect(sampleBeta(1000, 1000, 400, 1000)).toBe(0)
  })
})

describe('estimateFullBytes', () => {
  it('returns the sample size once it covers the full resolution', () => {
    expect(
      estimateFullBytes('jpeg', { quality: 75 }, 1000, 4000, 500, 4000, 4000),
    ).toBe(1000)
  })

  it('extrapolates jpeg within a sane range', () => {
    const bytes = estimateFullBytes(
      'jpeg',
      { quality: 75 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    expect(bytes).toBeGreaterThan(1000)
    expect(bytes).toBeLessThan(20000)
  })

  it('uses per-codec calibration', () => {
    const jpeg = estimateFullBytes(
      'jpeg',
      { quality: 75 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    const webp = estimateFullBytes(
      'webp',
      { quality: 75 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    expect(jpeg).not.toBe(webp)
  })

  it('grows with quality and varies with png mode', () => {
    const low = estimateFullBytes(
      'jpeg',
      { quality: 50 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    const high = estimateFullBytes(
      'jpeg',
      { quality: 94 },
      2000,
      4000,
      800,
      1000,
      16000,
    )
    expect(high).toBeGreaterThan(low)

    const m0 = estimateFullBytes(
      'png',
      { mode: 0 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    const m1 = estimateFullBytes(
      'png',
      { mode: 1 },
      1000,
      4000,
      400,
      1000,
      16000,
    )
    expect(m0).not.toBe(m1)
  })
})

describe('sampleSize', () => {
  it('measures small batches fully', () => {
    expect(sampleSize(1)).toBe(1)
    expect(sampleSize(3)).toBe(3)
    expect(sampleSize(5)).toBe(5)
  })

  it('measures half of a 6-10 image batch', () => {
    expect(sampleSize(6)).toBe(3)
    expect(sampleSize(7)).toBe(4)
    expect(sampleSize(10)).toBe(5)
  })

  it('caps large batches at 10 (light) or 5 (heavy)', () => {
    expect(sampleSize(11)).toBe(10)
    expect(sampleSize(100)).toBe(10)
    expect(sampleSize(10_000)).toBe(10)
    expect(sampleSize(11, true)).toBe(5)
    expect(sampleSize(100, true)).toBe(5)
    expect(sampleSize(10_000, true)).toBe(5)
  })
})

describe('averageRatioSamples', () => {
  const curves = [
    {
      originalSize: 1000,
      samples: [
        { quality: 50, bytes: 200 },
        { quality: 100, bytes: 500 },
      ],
    },
    {
      originalSize: 2000,
      samples: [
        { quality: 50, bytes: 600 },
        { quality: 100, bytes: 1400 },
      ],
    },
  ]

  it('averages each image ratio at every quality', () => {
    expect(averageRatioSamples(curves)).toEqual([
      { quality: 50, bytes: 0.25 },
      { quality: 100, bytes: 0.6 },
    ])
  })

  it('returns an empty curve without samples', () => {
    expect(averageRatioSamples([])).toEqual([])
  })
})

describe('deriveEstimate', () => {
  it('scales the averaged ratio by the original size', () => {
    const ratios = [
      { quality: 50, bytes: 0.25 },
      { quality: 100, bytes: 0.6 },
    ]
    expect(deriveEstimate(4000, ratios, 50)).toBe(1000)
    expect(deriveEstimate(4000, ratios, 75)).toBe(1700)
  })

  it('returns zero when there is no ratio curve', () => {
    expect(deriveEstimate(4000, [], 75)).toBe(0)
  })
})
