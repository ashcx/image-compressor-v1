import { describe, expect, it } from 'vitest'
import {
  orientationSwapsAxes,
  orientRgba,
  type RgbaImage,
  readExifOrientation,
} from './orientation'

function exifTiff(orientation: number, littleEndian = true): number[] {
  if (littleEndian) {
    return [
      0x49,
      0x49,
      0x2a,
      0x00,
      8,
      0,
      0,
      0,
      1,
      0,
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      orientation,
      0,
      0,
      0,
      0,
      0,
    ]
  }
  return [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
  ]
}

function jpegWithOrientation(orientation: number): ArrayBuffer {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...exifTiff(orientation)]
  const app1 = [
    0xff,
    0xe1,
    (exif.length + 2) >> 8,
    (exif.length + 2) & 0xff,
    ...exif,
  ]
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]).buffer
}

describe('readExifOrientation', () => {
  it('reads the JPEG APP1 orientation', () => {
    expect(readExifOrientation(jpegWithOrientation(6), 'jpeg')).toBe(6)
    expect(readExifOrientation(jpegWithOrientation(8), 'jpeg')).toBe(8)
  })

  it('reads the big-endian JPEG orientation', () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...exifTiff(3, false)]
    const app1 = [
      0xff,
      0xe1,
      (exif.length + 2) >> 8,
      (exif.length + 2) & 0xff,
      ...exif,
    ]
    const buffer = new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]).buffer
    expect(readExifOrientation(buffer, 'jpeg')).toBe(3)
  })

  it('locates the EXIF item in a HEIF container', () => {
    const data = new Uint8Array([
      0,
      0,
      0,
      0x18,
      0x66,
      0x74,
      0x79,
      0x70,
      0x68,
      0x65,
      0x69,
      0x63,
      0,
      0,
      0,
      0,
      ...exifTiff(8),
    ])
    expect(readExifOrientation(data.buffer, 'heic')).toBe(8)
  })

  it('defaults to 1 when there is no EXIF orientation', () => {
    expect(
      readExifOrientation(
        new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
        'jpeg',
      ),
    ).toBe(1)
    expect(readExifOrientation(new ArrayBuffer(32), 'heic')).toBe(1)
  })
})

describe('orientationSwapsAxes', () => {
  it('is true only for transposing orientations', () => {
    for (const orientation of [1, 2, 3, 4] as const) {
      expect(orientationSwapsAxes(orientation)).toBe(false)
    }
    for (const orientation of [5, 6, 7, 8] as const) {
      expect(orientationSwapsAxes(orientation)).toBe(true)
    }
  })
})

describe('orientRgba', () => {
  const source: RgbaImage = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
  }

  it('returns the source unchanged for orientation 1', () => {
    expect(orientRgba(source, 1)).toBe(source)
  })

  it('flips horizontally for orientation 2', () => {
    const result = orientRgba(source, 2)
    expect(result.width).toBe(2)
    expect(result.height).toBe(1)
    expect([...result.data]).toEqual([40, 50, 60, 255, 10, 20, 30, 255])
  })

  it('rotates 180 degrees for orientation 3', () => {
    const result = orientRgba(source, 3)
    expect(result.width).toBe(2)
    expect(result.height).toBe(1)
    expect([...result.data]).toEqual([40, 50, 60, 255, 10, 20, 30, 255])
  })

  it('rotates 90 degrees clockwise and swaps the axes for orientation 6', () => {
    const result = orientRgba(source, 6)
    expect(result.width).toBe(1)
    expect(result.height).toBe(2)
    expect([...result.data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  it('rotates 270 degrees clockwise for orientation 8', () => {
    const result = orientRgba(source, 8)
    expect(result.width).toBe(1)
    expect(result.height).toBe(2)
    expect([...result.data]).toEqual([40, 50, 60, 255, 10, 20, 30, 255])
  })
})
