import { describe, expect, it } from 'vitest'
import { FORMAT_ORDER, FORMAT_SPECS } from './formats'

describe('format specs', () => {
  it('covers every format in the canonical order', () => {
    expect(Object.keys(FORMAT_SPECS).sort()).toEqual([...FORMAT_ORDER].sort())
  })

  it('gives every control a default inside its range and a usable step', () => {
    for (const format of FORMAT_ORDER) {
      const spec = FORMAT_SPECS[format]
      expect(spec.controls.length).toBeGreaterThan(0)
      for (const control of spec.controls) {
        expect(control.min).toBeLessThan(control.max)
        expect(control.default).toBeGreaterThanOrEqual(control.min)
        expect(control.default).toBeLessThanOrEqual(control.max)
        expect(control.step).toBeGreaterThan(0)
      }
    }
  })

  it('marks PNG as the only lossless format', () => {
    for (const format of FORMAT_ORDER) {
      expect(FORMAT_SPECS[format].lossless).toBe(format === 'png')
    }
  })

  it('ships the tuned defaults and bounds for the codec controls', () => {
    const control = (format: 'jpeg' | 'webp' | 'avif' | 'jxl', key: string) =>
      FORMAT_SPECS[format].controls.find((entry) => entry.key === key)

    expect(control('avif', 'speed')).toMatchObject({
      min: 6,
      max: 10,
      default: 8,
    })
    expect(control('jxl', 'quality')).toMatchObject({
      min: 8,
      max: 100,
      default: 8,
    })
    expect(control('jpeg', 'quality')).toMatchObject({ min: 40, max: 95 })
    expect(control('webp', 'quality')).toMatchObject({ min: 40, max: 95 })
  })
})
