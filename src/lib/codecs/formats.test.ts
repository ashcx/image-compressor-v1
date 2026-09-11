import { describe, expect, it } from 'vitest'
import { FORMAT_ORDER, FORMAT_SPECS, type FormatControl } from './formats'

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
    expect(FORMAT_SPECS.jxl.label).toBe('JPEG XL (slower)')
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

    const jxlQuality = byKey(FORMAT_SPECS.jxl.controls, 'quality')
    expect(jxlQuality).toMatchObject({
      kind: 'range',
      min: 1,
      max: 8,
      default: 5,
    })

    const jxlEffort = byKey(FORMAT_SPECS.jxl.controls, 'effort')
    expect(
      jxlEffort?.kind === 'select' ? jxlEffort.options.map((o) => o.value) : [],
    ).toEqual([7, 5, 3])

    const pngMode = byKey(FORMAT_SPECS.png.controls, 'mode')
    expect(
      pngMode?.kind === 'select' ? pngMode.options.map((o) => o.value) : [],
    ).toEqual([0, 1, 2])
    expect(pngMode?.default).toBe(0)
  })
})
