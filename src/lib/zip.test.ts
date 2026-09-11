import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildZip, uniqueEntryName } from './zip'

describe('uniqueEntryName', () => {
  it('returns the original name when unused', () => {
    const used = new Set<string>()
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo.jpg')
    expect(used.has('photo.jpg')).toBe(true)
  })

  it('appends an incrementing suffix on collision', () => {
    const used = new Set<string>()
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo.jpg')
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo-2.jpg')
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo-3.jpg')
  })

  it('handles names without an extension', () => {
    const used = new Set(['clip'])
    expect(uniqueEntryName('clip', used)).toBe('clip-2')
  })
})

describe('buildZip', () => {
  it('bundles entries with the given names and bytes', () => {
    const zip = buildZip([
      { name: 'a.jpg', data: new Uint8Array([1, 2, 3]) },
      { name: 'b.png', data: new Uint8Array([4, 5]) },
    ])

    const contents = unzipSync(zip)
    expect(Object.keys(contents).sort()).toEqual(['a.jpg', 'b.png'])
    expect(Array.from(contents['a.jpg'])).toEqual([1, 2, 3])
    expect(Array.from(contents['b.png'])).toEqual([4, 5])
  })

  it('keeps one file per colliding name', () => {
    const zip = buildZip([
      { name: 'photo.jpg', data: new Uint8Array([1]) },
      { name: 'photo.jpg', data: new Uint8Array([2]) },
    ])

    const contents = unzipSync(zip)
    expect(Object.keys(contents).sort()).toEqual(['photo-2.jpg', 'photo.jpg'])
  })

  it('produces a valid empty zip', () => {
    expect(Object.keys(unzipSync(buildZip([])))).toEqual([])
  })
})
