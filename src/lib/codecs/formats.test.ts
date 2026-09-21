import { describe, expect, it } from 'vitest'
import {
  FORMAT_ORDER,
  FORMAT_SPECS,
  type FormatControl,
  isHeavyFormat,
} from './formats'

const ALL_KEYS = ['quality', 'effort', 'speed', 'mode'] as const

function byKey(controls: FormatControl[], key: string) {
  return controls.find((control) => control.key === key)
}

describe('format specs', () => {
  it('covers every format in the canonical order', () => {
    expect(Object.keys(FORMAT_SPECS).sort()).toEqual([...FORMAT_ORDER].sort())
  })

  it('gives every control valid defaults and options', () => {
    for (const format of FORMAT_ORDER) {
      const spec = FORMAT_SPECS[format]
      expect(spec.controls.length).toBeGreaterThan(0)
      for (const control of spec.controls) {
        expect(ALL_KEYS).toContain(control.key)
        if (control.kind === 'range') {
          expect(control.min).toBeLessThan(control.max)
          expect(control.default).toBeGreaterThanOrEqual(control.min)
          expect(control.default).toBeLessThanOrEqual(control.max)
          expect(control.step).toBeGreaterThan(0)
        } else {
          expect(control.options.length).toBeGreaterThan(0)
          const values = control.options.map((option) => option.value)
          expect(new Set(values).size).toBe(values.length)
          expect(values).toContain(control.default)
        }
      }
    }
  })

  it('marks PNG as the only lossless format', () => {
    for (const format of FORMAT_ORDER) {
      expect(FORMAT_SPECS[format].lossless).toBe(format === 'png')
    }
  })

  it('exposes fast and smaller-size WebP speed options', () => {
    const webpSpeed = byKey(FORMAT_SPECS.webp.controls, 'speed')
    expect(
      webpSpeed?.kind === 'select'
        ? webpSpeed.options.map((option) => option.label)
        : [],
    ).toEqual(['Fast', 'Smaller size (slower)'])
    expect(webpSpeed?.default).toBe(0)
  })

  it('labels the slow codecs', () => {
    expect(FORMAT_SPECS.avif.label).toBe('AVIF (slower)')
  })

  it('classifies heavy codecs for the reduced worker pool', () => {
    expect(isHeavyFormat('avif', 0)).toBe(true)
    expect(isHeavyFormat('heic', 0)).toBe(true)
    expect(isHeavyFormat('png', 0)).toBe(false)
    expect(isHeavyFormat('png', 1)).toBe(true)
    expect(isHeavyFormat('png', 2)).toBe(true)
    expect(isHeavyFormat('jpeg', 0)).toBe(false)
    expect(isHeavyFormat('webp', 0)).toBe(false)
  })

  it('uses the agreed preset values', () => {
    const jpegQuality = byKey(FORMAT_SPECS.jpeg.controls, 'quality')
    expect(
      jpegQuality?.kind === 'select'
        ? jpegQuality.options.map((o) => o.value)
        : [],
    ).toEqual([94, 85, 75, 50])

    const avifSpeed = byKey(FORMAT_SPECS.avif.controls, 'speed')
    expect(
      avifSpeed?.kind === 'select' ? avifSpeed.options.map((o) => o.label) : [],
    ).toEqual([
      'Default',
      'Slow (slightly smaller size)',
      'Slowest (smallest size)',
    ])
    expect(avifSpeed?.default).toBe(10)

    const pngMode = byKey(FORMAT_SPECS.png.controls, 'mode')
    expect(
      pngMode?.kind === 'select' ? pngMode.options.map((o) => o.value) : [],
    ).toEqual([0, 1, 2])
    expect(pngMode?.default).toBe(0)
  })

  it('exposes only the default ultrafast speed for HEIC', () => {
    const heicSpeed = byKey(FORMAT_SPECS.heic.controls, 'speed')
    expect(
      heicSpeed?.kind === 'select' ? heicSpeed.options.map((o) => o.label) : [],
    ).toEqual(['Default'])
    expect(heicSpeed?.default).toBe(0)
  })

  it('uses HEIC-specific quality values tuned to the JPEG presets', () => {
    const heicQuality = byKey(FORMAT_SPECS.heic.controls, 'quality')
    expect(
      heicQuality?.kind === 'select'
        ? heicQuality.options.map((o) => [o.label, o.value])
        : [],
    ).toEqual([
      ['Best', 80],
      ['Better', 58],
      ['Default', 51],
      ['Low', 43],
    ])
    expect(heicQuality?.default).toBe(51)
  })

  it('uses WebP-specific quality values tuned to the JPEG presets', () => {
    const webpQuality = byKey(FORMAT_SPECS.webp.controls, 'quality')
    expect(
      webpQuality?.kind === 'select'
        ? webpQuality.options.map((o) => [o.label, o.value])
        : [],
    ).toEqual([
      ['Best', 98],
      ['Better', 92],
      ['Default', 85],
      ['Low', 70],
    ])
    expect(webpQuality?.default).toBe(85)
  })

  it('uses AVIF-specific quality values tuned to the JPEG presets', () => {
    const avifQuality = byKey(FORMAT_SPECS.avif.controls, 'quality')
    expect(
      avifQuality?.kind === 'select'
        ? avifQuality.options.map((o) => [o.label, o.value])
        : [],
    ).toEqual([
      ['Best', 95],
      ['Better', 85],
      ['Default', 75],
      ['Low', 58],
    ])
    expect(avifQuality?.default).toBe(75)
  })
})
