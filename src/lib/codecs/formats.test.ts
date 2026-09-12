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

  it('labels the slow codecs', () => {
    expect(FORMAT_SPECS.avif.label).toBe('AVIF (slower)')
  })

  it('classifies heavy codecs for the reduced worker pool', () => {
    expect(isHeavyFormat('avif', 0)).toBe(true)
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
    ).toEqual(['Slow', 'Balanced', 'Fast'])
    expect(avifSpeed?.default).toBe(8)

    const pngMode = byKey(FORMAT_SPECS.png.controls, 'mode')
    expect(
      pngMode?.kind === 'select' ? pngMode.options.map((o) => o.value) : [],
    ).toEqual([0, 1, 2])
    expect(pngMode?.default).toBe(0)
  })
})
