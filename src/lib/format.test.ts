import { describe, expect, it } from 'vitest'
import { formatBytes, percentReduction, replaceExtension } from './format'

describe('formatBytes', () => {
  it('formats plain bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes with one decimal under 10', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('formats megabytes without decimals at 10 or more', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })
})

describe('replaceExtension', () => {
  it('replaces the existing extension', () => {
    expect(replaceExtension('photo.jpeg', 'webp')).toBe('photo.webp')
  })

  it('handles names without an extension', () => {
    expect(replaceExtension('photo', 'webp')).toBe('photo.webp')
  })

  it('only replaces the final extension', () => {
    expect(replaceExtension('my.photo.png', 'webp')).toBe('my.photo.webp')
  })
})

describe('percentReduction', () => {
  it('computes a positive reduction', () => {
    expect(percentReduction(1000, 400)).toBe(60)
  })

  it('handles growth as a negative reduction', () => {
    expect(percentReduction(1000, 1200)).toBe(-20)
  })

  it('guards against a zero original size', () => {
    expect(percentReduction(0, 100)).toBe(0)
  })
})
