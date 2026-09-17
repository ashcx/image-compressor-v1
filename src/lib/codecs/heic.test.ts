import { describe, expect, it } from 'vitest'
import { fitDecodedBitmap, heicPresetForSpeed } from './heic'

describe('heicPresetForSpeed', () => {
  it('maps select values to kvazaar presets', () => {
    expect(heicPresetForSpeed(0)).toBe('ultrafast')
    expect(heicPresetForSpeed(1)).toBe('faster')
    expect(heicPresetForSpeed(2)).toBe('slow')
  })

  it('defaults to the balanced preset', () => {
    expect(heicPresetForSpeed(undefined)).toBe('faster')
  })

  it('clamps out-of-range and fractional values', () => {
    expect(heicPresetForSpeed(-5)).toBe('ultrafast')
    expect(heicPresetForSpeed(99)).toBe('slow')
    expect(heicPresetForSpeed(1.6)).toBe('slow')
  })
})

describe('fitDecodedBitmap', () => {
  it('trims the duplicated RGBA plane elheif appends', () => {
    const width = 2
    const height = 2
    const once = new Uint8Array(width * height * 4).fill(7)
    const twice = new Uint8Array(once.length * 2)
    twice.set(once, 0)
    twice.set(once, once.length)

    const fitted = fitDecodedBitmap({ width, height, data: twice })

    expect(fitted.width).toBe(width)
    expect(fitted.height).toBe(height)
    expect(fitted.data.length).toBe(width * height * 4)
    expect([...fitted.data]).toEqual([...once])
  })

  it('returns an already-correct bitmap unchanged', () => {
    const data = new Uint8Array(16).fill(3)
    const fitted = fitDecodedBitmap({ width: 2, height: 2, data })
    expect(fitted.data).toBe(data)
  })
})
