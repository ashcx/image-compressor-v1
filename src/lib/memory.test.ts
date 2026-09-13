import { describe, expect, it } from 'vitest'
import { formatMemoryWeight, jobCostBytes, maxJobPixels } from './memory'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

describe('formatMemoryWeight', () => {
  it('charges native paths the base multiplier', () => {
    expect(formatMemoryWeight('jpeg')).toBe(2.5)
    expect(formatMemoryWeight('png', 0)).toBe(2.5)
  })

  it('charges WebP as the WASM path (Safari)', () => {
    expect(formatMemoryWeight('webp')).toBe(4)
  })

  it('charges AVIF and compressed PNG the heaviest', () => {
    expect(formatMemoryWeight('avif')).toBe(5)
    expect(formatMemoryWeight('png', 1)).toBe(5)
    expect(formatMemoryWeight('png', 2)).toBe(5)
  })
})

describe('jobCostBytes', () => {
  it('scales with pixels and the codec weight', () => {
    expect(jobCostBytes(25_000_000, 'jpeg')).toBe(25_000_000 * 4 * 2.5)
    expect(jobCostBytes(1_000_000, 'avif')).toBe(1_000_000 * 4 * 5)
  })

  it('fits four 25 MP JPEGs in a 1 GiB iPad budget but not five', () => {
    const cost = jobCostBytes(25_000_000, 'jpeg')
    expect(cost * 4).toBeLessThanOrEqual(GIB)
    expect(cost * 5).toBeGreaterThan(GIB)
  })
})

describe('maxJobPixels', () => {
  it('disables the cap when the budget is not finite', () => {
    expect(maxJobPixels(0, 'jpeg')).toBe(Number.POSITIVE_INFINITY)
  })

  it('reserves headroom below the budget', () => {
    // 0.9 * 1 GiB / (4 bytes * 2.5 weight) = ~96.6 MP.
    expect(maxJobPixels(GIB, 'jpeg')).toBeCloseTo((GIB * 0.9) / 10)
  })

  it('caps heavy codecs on a 512 MiB iPhone near 24 MP', () => {
    const cap = maxJobPixels(512 * MIB, 'avif')
    expect(cap).toBeGreaterThan(23_000_000)
    expect(cap).toBeLessThan(25_000_000)
  })
})
