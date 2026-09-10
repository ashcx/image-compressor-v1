import { describe, expect, it } from 'vitest'
import { interpolate, scaleToFullSize } from './estimate'

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

describe('scaleToFullSize', () => {
  it('extrapolates with a sub-linear power law', () => {
    // beta = ln(1000/400) / ln(4000/1000) ~= 0.661, estimate ~= 2500
    expect(scaleToFullSize(1000, 4000, 400, 1000, 16000)).toBe(2500)
  })

  it('falls back to linear scaling when there is no smaller sample', () => {
    expect(scaleToFullSize(1000, 4000, 500, 4000, 4000)).toBe(1000)
  })

  it('clamps an aggressive exponent to the maximum', () => {
    // raw beta ~= 1.66 -> clamped to 0.8 -> 1000 * 4^0.8 ~= 3031
    expect(scaleToFullSize(1000, 4000, 100, 1000, 16000)).toBe(3031)
  })

  it('clamps a near-flat exponent to the minimum', () => {
    // raw beta ~= 0 -> clamped to 0.35 -> 1000 * 4^0.35 ~= 1625
    expect(scaleToFullSize(1000, 4000, 999, 1000, 16000)).toBe(1625)
  })
})
