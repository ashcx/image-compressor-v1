import type { OutputFormat } from './codecs/types'

/** EXIF orientation values 1-8, as defined by the TIFF/EXIF specification. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

/** True for the orientations that transpose the image (5-8). */
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5
}

function orientationFromTiff(
  view: DataView,
  start: number,
): ExifOrientation | null {
  if (start + 8 > view.byteLength) return null
  const b0 = view.getUint8(start)
  const b1 = view.getUint8(start + 1)
  const littleEndian =
    b0 === 0x49 && b1 === 0x49
      ? true
      : b0 === 0x4d && b1 === 0x4d
        ? false
        : null
  if (littleEndian === null) return null
  if (view.getUint16(start + 2, littleEndian) !== 42) return null

  const ifd = start + view.getUint32(start + 4, littleEndian)
  if (ifd + 2 > view.byteLength) return null
  const count = view.getUint16(ifd, littleEndian)
  if (count === 0 || count > 512) return null

  for (let entry = 0; entry < count; entry += 1) {
    const offset = ifd + 2 + entry * 12
    if (offset + 12 > view.byteLength) return null
    if (view.getUint16(offset, littleEndian) !== 0x0112) continue
    const type = view.getUint16(offset + 2, littleEndian)
    const length = view.getUint32(offset + 4, littleEndian)
    if (type !== 3 || length < 1) return null
    const value = view.getUint16(offset + 8, littleEndian)
    return value >= 1 && value <= 8 ? (value as ExifOrientation) : null
  }
  return null
}

function readJpegOrientation(
  view: DataView,
  data: Uint8Array,
): ExifOrientation {
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) break
    const marker = data[offset + 1]
    offset += 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda) break
    const length = view.getUint16(offset, false)
    if (length < 2 || offset + length > data.length) break
    const payload = offset + 2
    if (
      marker === 0xe1 &&
      length >= 8 &&
      data[payload] === 0x45 &&
      data[payload + 1] === 0x78 &&
      data[payload + 2] === 0x69 &&
      data[payload + 3] === 0x66
    ) {
      const orientation = orientationFromTiff(view, payload + 6)
      if (orientation) return orientation
    }
    offset += length
  }
  return 1
}

function scanHeifOrientation(
  view: DataView,
  data: Uint8Array,
): ExifOrientation {
  for (let i = 0; i + 8 <= data.length; i += 1) {
    const header =
      data[i] === 0x49 && data[i + 1] === 0x49 && data[i + 2] === 0x2a
    const bigHeader =
      data[i] === 0x4d && data[i + 1] === 0x4d && data[i + 2] === 0x00
    if (!header && !bigHeader) continue
    const orientation = orientationFromTiff(view, i)
    if (orientation) return orientation
  }
  return 1
}

/**
 * Reads the EXIF orientation. JPEG APP1 is parsed directly; HEIC/HEIF/AVIF
 * store EXIF as an item, so the TIFF block is located by its header and the
 * candidate is only accepted when it parses as a valid orientation IFD.
 */
export function readExifOrientation(
  buffer: ArrayBuffer,
  format: OutputFormat,
): ExifOrientation {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)

  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
    return readJpegOrientation(view, data)
  }
  if (format === 'heic' || format === 'avif') {
    return scanHeifOrientation(view, data)
  }
  return 1
}

/**
 * Bakes the orientation into the pixels. Returns the source unchanged for
 * orientation 1.
 */
export function orientRgba(
  image: RgbaImage,
  orientation: ExifOrientation,
): RgbaImage {
  if (orientation === 1) return image

  const { width, height, data } = image
  const swap = orientationSwapsAxes(orientation)
  const outWidth = swap ? height : width
  const outHeight = swap ? width : height
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let dx = x
      let dy = y
      switch (orientation) {
        case 2:
          dx = width - 1 - x
          break
        case 3:
          dx = width - 1 - x
          dy = height - 1 - y
          break
        case 4:
          dy = height - 1 - y
          break
        case 5:
          dx = y
          dy = x
          break
        case 6:
          dx = height - 1 - y
          dy = x
          break
        case 7:
          dx = height - 1 - y
          dy = width - 1 - x
          break
        case 8:
          dx = y
          dy = width - 1 - x
          break
      }
      const source = (y * width + x) * 4
      const target = (dy * outWidth + dx) * 4
      out[target] = data[source]
      out[target + 1] = data[source + 1]
      out[target + 2] = data[source + 2]
      out[target + 3] = data[source + 3]
    }
  }

  return { width: outWidth, height: outHeight, data: out }
}
