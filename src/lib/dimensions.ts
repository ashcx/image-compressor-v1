import { detectFormat } from './detect'

export interface Dimensions {
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const MAX_JPEG_SEGMENTS = 4096

function readU8(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 1 > view.byteLength) return null
  return view.getUint8(offset)
}

function readU16BE(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 2 > view.byteLength) return null
  return view.getUint16(offset, false)
}

function readU16LE(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 2 > view.byteLength) return null
  return view.getUint16(offset, true)
}

function readU24LE(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 3 > view.byteLength) return null
  return (
    view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16)
  )
}

function readU32BE(view: DataView, offset: number): number | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null
  return view.getUint32(offset, false)
}

function readFourCC(view: DataView, offset: number): string | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null
  let value = ''
  for (let i = 0; i < 4; i++) {
    value += String.fromCharCode(view.getUint8(offset + i))
  }
  return value
}

function parsePng(view: DataView): Dimensions | null {
  if (view.byteLength < PNG_SIGNATURE.length) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return null
  }
  if (readFourCC(view, 12) !== 'IHDR') return null
  const width = readU32BE(view, 16)
  const height = readU32BE(view, 20)
  if (width === null || height === null) return null
  if (width === 0 || height === 0) return null
  return { width, height }
}

function parseJpeg(view: DataView): Dimensions | null {
  if (readU16BE(view, 0) !== 0xffd8) return null
  let offset = 2
  for (let segment = 0; segment < MAX_JPEG_SEGMENTS; segment++) {
    if (readU8(view, offset) !== 0xff) return null
    offset++
    let code = readU8(view, offset)
    if (code === null) return null
    while (code === 0xff) {
      offset++
      code = readU8(view, offset)
      if (code === null) return null
    }
    offset++

    if (code === 0x01 || (code >= 0xd0 && code <= 0xd9)) continue

    const length = readU16BE(view, offset)
    if (length === null || length < 2) return null
    const isSof =
      code >= 0xc0 &&
      code <= 0xcf &&
      code !== 0xc4 &&
      code !== 0xc8 &&
      code !== 0xcc
    if (isSof) {
      const height = readU16BE(view, offset + 3)
      const width = readU16BE(view, offset + 5)
      if (height === null || width === null) return null
      return { width, height }
    }
    offset += length
  }
  return null
}

function parseWebp(view: DataView): Dimensions | null {
  if (readFourCC(view, 0) !== 'RIFF') return null
  if (readFourCC(view, 8) !== 'WEBP') return null
  const fourcc = readFourCC(view, 12)
  if (fourcc === null) return null

  if (fourcc === 'VP8X') {
    const width = readU24LE(view, 24)
    const height = readU24LE(view, 27)
    if (width === null || height === null) return null
    return { width: width + 1, height: height + 1 }
  }

  if (fourcc === 'VP8L') {
    const b1 = readU8(view, 21)
    const b2 = readU8(view, 22)
    const b3 = readU8(view, 23)
    const b4 = readU8(view, 24)
    if (b1 === null || b2 === null || b3 === null || b4 === null) return null
    const width = 1 + ((b1 | (b2 << 8)) & 0x3fff)
    const height = 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff)
    return { width, height }
  }

  if (fourcc === 'VP8 ') {
    const width = readU16LE(view, 26)
    const height = readU16LE(view, 28)
    if (width === null || height === null) return null
    return { width: width & 0x3fff, height: height & 0x3fff }
  }

  return null
}

interface BoxLocation {
  start: number
  size: number
  headerSize: number
}

function findBox(
  view: DataView,
  start: number,
  end: number,
  type: string,
): BoxLocation | null {
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false)
    const boxType = readFourCC(view, offset + 4)
    if (boxType === null) return null
    let headerSize = 8

    if (size === 1) {
      if (offset + 16 > end) return null
      const high = view.getUint32(offset + 8, false)
      const low = view.getUint32(offset + 12, false)
      size = high * 2 ** 32 + low
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }

    if (boxType === 'uuid') headerSize += 16
    if (size < headerSize || offset + size > end) return null
    if (boxType === type) return { start: offset, size, headerSize }
    offset += size
  }
  return null
}

function parseAvif(view: DataView): Dimensions | null {
  const end = view.byteLength
  const meta = findBox(view, 0, end, 'meta')
  if (meta === null) return null

  const iprp = findBox(
    view,
    meta.start + meta.headerSize + 4,
    meta.start + meta.size,
    'iprp',
  )
  if (iprp === null) return null

  const ipco = findBox(
    view,
    iprp.start + iprp.headerSize,
    iprp.start + iprp.size,
    'ipco',
  )
  if (ipco === null) return null

  const ispe = findBox(
    view,
    ipco.start + ipco.headerSize,
    ipco.start + ipco.size,
    'ispe',
  )
  if (ispe === null) return null

  const payload = ispe.start + ispe.headerSize
  const width = readU32BE(view, payload + 4)
  const height = readU32BE(view, payload + 8)
  if (width === null || height === null) return null
  return { width, height }
}

export function parseDimensions(buffer: ArrayBuffer): Dimensions | null {
  if (!(buffer instanceof ArrayBuffer)) return null
  const format = detectFormat(buffer)
  if (format === null || format === 'jxl') return null

  try {
    const view = new DataView(buffer)
    switch (format) {
      case 'png':
        return parsePng(view)
      case 'jpeg':
        return parseJpeg(view)
      case 'webp':
        return parseWebp(view)
      case 'avif':
        return parseAvif(view)
    }
  } catch {
    return null
  }
}
