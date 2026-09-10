import { describe, expect, it } from 'vitest'
import { interpolate } from './estimate'

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
