import type { OutputFormat } from './codecs/types'

/**
 * Carries the EXIF block (capture date, camera, GPS) from a source file into a
 * re-encoded JPEG, PNG, or WebP. Encoders only see raw pixels, so this runs on
 * the finished output bytes. AVIF and HEIC output are not supported.
 */

const ORIENTATION_TAG = 0x0112
const EXIF_IFD_POINTER_TAG = 0x8769
const IMAGE_WIDTH_TAG = 0x0100
const IMAGE_HEIGHT_TAG = 0x0101
const PIXEL_X_DIMENSION_TAG = 0xa002
const PIXEL_Y_DIMENSION_TAG = 0xa003

const TYPE_SHORT = 3
const TYPE_LONG = 4

// The JPEG APP1 length field is 16 bits and counts itself plus "Exif\0\0".
const JPEG_MAX_EXIF_BYTES = 0xffff - 2 - 6

export function supportsExif(format: OutputFormat): boolean {
  return format === 'jpeg' || format === 'png' || format === 'webp'
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let text = ''
  for (let i = 0; i < length && offset + i < data.length; i += 1) {
    text += String.fromCharCode(data[offset + i])
  }
  return text
}

function hasExifPrefix(data: Uint8Array, offset: number): boolean {
  return ascii(data, offset, 6) === 'Exif\0\0'
}

function extractFromJpeg(data: Uint8Array): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1]
    offset += 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    const length = view.getUint16(offset, false)
    if (length < 2 || offset + length > data.length) return null
    const payload = offset + 2
    if (marker === 0xe1 && hasExifPrefix(data, payload)) {
      return data.slice(payload + 6, offset + length)
    }
    offset += length
  }
  return null
}

function extractFromPng(data: Uint8Array): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset, false)
    const type = ascii(data, offset + 4, 4)
    const start = offset + 8
    if (start + length > data.length) return null
    if (type === 'eXIf') return data.slice(start, start + length)
    if (type === 'IEND') return null
    offset = start + length + 4
  }
  return null
}

function extractFromWebp(data: Uint8Array): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 12
  while (offset + 8 <= data.length) {
    const type = ascii(data, offset, 4)
    const length = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + length > data.length) return null
    if (type === 'EXIF') {
      const skip = hasExifPrefix(data, start) ? 6 : 0
      return data.slice(start + skip, start + length)
    }
    offset = start + length + (length % 2)
  }
  return null
}

function readUint(view: DataView, offset: number, size: number): number {
  switch (size) {
    case 0:
      return 0
    case 1:
      return view.getUint8(offset)
    case 2:
      return view.getUint16(offset, false)
    case 4:
      return view.getUint32(offset, false)
    case 8:
      return Number(view.getBigUint64(offset, false))
    default:
      throw new Error(`Unsupported integer size ${size}`)
  }
}

interface Box {
  type: string
  start: number
  end: number
}

function readBoxes(
  data: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): Box[] {
  const boxes: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false)
    const type = ascii(data, offset + 4, 4)
    let header = 8
    if (size === 1) {
      size = Number(view.getBigUint64(offset + 8, false))
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) break
    boxes.push({ type, start: offset + header, end: offset + size })
    offset += size
  }
  return boxes
}

function findExifItemId(
  data: Uint8Array,
  view: DataView,
  iinf: Box,
): number | null {
  const version = data[iinf.start]
  const first = iinf.start + 4 + (version === 0 ? 2 : 4)
  for (const infe of readBoxes(data, view, first, iinf.end)) {
    if (infe.type !== 'infe') continue
    const infeVersion = data[infe.start]
    if (infeVersion < 2) continue
    const idSize = infeVersion === 2 ? 2 : 4
    const typeAt = infe.start + 4 + idSize + 2
    if (ascii(data, typeAt, 4) === 'Exif') {
      return readUint(view, infe.start + 4, idSize)
    }
  }
  return null
}

function readItemExtent(
  view: DataView,
  iloc: Box,
  itemId: number,
): { offset: number; length: number } | null {
  let at = iloc.start
  const version = view.getUint8(at)
  at += 4
  const offsetSize = view.getUint8(at) >> 4
  const lengthSize = view.getUint8(at) & 0x0f
  const baseOffsetSize = view.getUint8(at + 1) >> 4
  const indexSize =
    version === 1 || version === 2 ? view.getUint8(at + 1) & 0x0f : 0
  at += 2
  const itemCount =
    version < 2 ? view.getUint16(at, false) : view.getUint32(at, false)
  at += version < 2 ? 2 : 4

  for (let i = 0; i < itemCount; i += 1) {
    const id =
      version < 2 ? view.getUint16(at, false) : view.getUint32(at, false)
    at += version < 2 ? 2 : 4
    if (version === 1 || version === 2) at += 2
    at += 2
    const baseOffset = readUint(view, at, baseOffsetSize)
    at += baseOffsetSize
    const extentCount = view.getUint16(at, false)
    at += 2
    let found: { offset: number; length: number } | null = null
    for (let e = 0; e < extentCount; e += 1) {
      at += indexSize
      const offset = readUint(view, at, offsetSize)
      at += offsetSize
      const length = readUint(view, at, lengthSize)
      at += lengthSize
      if (!found) found = { offset: baseOffset + offset, length }
    }
    if (id === itemId) return found
  }
  return null
}

function extractFromIsobmff(data: Uint8Array): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const meta = readBoxes(data, view, 0, data.length).find(
    (box) => box.type === 'meta',
  )
  if (!meta) return null
  const children = readBoxes(data, view, meta.start + 4, meta.end)
  const iinf = children.find((box) => box.type === 'iinf')
  const iloc = children.find((box) => box.type === 'iloc')
  if (!iinf || !iloc) return null

  const itemId = findExifItemId(data, view, iinf)
  if (itemId === null) return null
  const extent = readItemExtent(view, iloc, itemId)
  if (
    !extent ||
    extent.length < 4 ||
    extent.offset + extent.length > data.length
  ) {
    return null
  }
  // The item starts with a 4-byte count of bytes to skip before the TIFF header.
  const skip = view.getUint32(extent.offset, false)
  const tiffStart = extent.offset + 4 + skip
  const end = extent.offset + extent.length
  return tiffStart < end ? data.slice(tiffStart, end) : null
}

/** Returns the raw TIFF block of the source's EXIF, or `null` when it has none. */
export function extractExif(buffer: ArrayBuffer): Uint8Array | null {
  const data = new Uint8Array(buffer)
  try {
    if (data[0] === 0xff && data[1] === 0xd8) return extractFromJpeg(data)
    if (ascii(data, 1, 3) === 'PNG') return extractFromPng(data)
    if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') {
      return extractFromWebp(data)
    }
    if (ascii(data, 4, 4) === 'ftyp') return extractFromIsobmff(data)
  } catch {
    // Malformed container: treat as having no EXIF.
  }
  return null
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  valueAt: number
}

const SUB_IFD_TAGS = new Set([EXIF_IFD_POINTER_TAG, 0x8825, 0xa005])
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4]

function readIfd(view: DataView, ifd: number, little: boolean) {
  if (ifd + 2 > view.byteLength) return null
  const count = view.getUint16(ifd, little)
  const entriesEnd = ifd + 2 + count * 12
  if (count > 512 || entriesEnd + 4 > view.byteLength) return null
  const entries: IfdEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12
    entries.push({
      tag: view.getUint16(at, little),
      type: view.getUint16(at + 2, little),
      count: view.getUint32(at + 4, little),
      valueAt: at + 8,
    })
  }
  return { entries, nextPointerAt: entriesEnd }
}

function writeNumber(
  view: DataView,
  entry: IfdEntry,
  value: number,
  little: boolean,
): void {
  if (entry.type === TYPE_SHORT && value <= 0xffff) {
    view.setUint16(entry.valueAt, value, little)
  } else if (entry.type === TYPE_LONG) {
    view.setUint32(entry.valueAt, value, little)
  }
}

/**
 * End offset of an IFD and everything its entries point at, including the
 * Exif, GPS, and Interoperability sub-IFDs. Returns `Infinity` when the layout
 * cannot be read, which keeps the caller from cutting anything.
 */
function ifdDataEnd(
  view: DataView,
  offset: number,
  little: boolean,
  depth = 0,
): number {
  const ifd = readIfd(view, offset, little)
  if (!ifd || depth > 2) return Number.POSITIVE_INFINITY
  let end = ifd.nextPointerAt + 4
  for (const entry of ifd.entries) {
    if (SUB_IFD_TAGS.has(entry.tag)) {
      const sub = view.getUint32(entry.valueAt, little)
      end = Math.max(end, ifdDataEnd(view, sub, little, depth + 1))
      continue
    }
    const unit = TYPE_SIZES[entry.type]
    if (!unit) return Number.POSITIVE_INFINITY
    const size = unit * entry.count
    if (size > 4)
      end = Math.max(end, view.getUint32(entry.valueAt, little) + size)
  }
  return end
}

/**
 * Makes a source EXIF block describe the re-encoded image. Pixels are already
 * upright, so Orientation is reset to 1 (otherwise viewers rotate twice), the
 * pixel dimensions are updated, and the embedded thumbnail is dropped because
 * it shows the old image. The thumbnail bytes are cut off the end of the block
 * only when nothing else in the block lives at or after them.
 */
export function sanitizeExif(
  tiff: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = tiff.slice()
  const view = new DataView(out.buffer)
  const little =
    out[0] === 0x49 && out[1] === 0x49
      ? true
      : out[0] === 0x4d && out[1] === 0x4d
        ? false
        : null
  if (little === null || out.length < 8 || view.getUint16(2, little) !== 42) {
    return out
  }

  const ifd0 = readIfd(view, view.getUint32(4, little), little)
  if (!ifd0) return out

  let exifIfdOffset = 0
  for (const entry of ifd0.entries) {
    if (entry.tag === ORIENTATION_TAG && entry.type === TYPE_SHORT) {
      view.setUint16(entry.valueAt, 1, little)
    } else if (entry.tag === IMAGE_WIDTH_TAG) {
      writeNumber(view, entry, width, little)
    } else if (entry.tag === IMAGE_HEIGHT_TAG) {
      writeNumber(view, entry, height, little)
    } else if (entry.tag === EXIF_IFD_POINTER_TAG) {
      exifIfdOffset = view.getUint32(entry.valueAt, little)
    }
  }
  const thumbnailIfd = view.getUint32(ifd0.nextPointerAt, little)
  const keepEnd = ifdDataEnd(view, view.getUint32(4, little), little)
  view.setUint32(ifd0.nextPointerAt, 0, little)

  const exifIfd = exifIfdOffset ? readIfd(view, exifIfdOffset, little) : null
  for (const entry of exifIfd?.entries ?? []) {
    if (entry.tag === PIXEL_X_DIMENSION_TAG) {
      writeNumber(view, entry, width, little)
    } else if (entry.tag === PIXEL_Y_DIMENSION_TAG) {
      writeNumber(view, entry, height, little)
    }
  }
  return thumbnailIfd > 0 &&
    keepEnd <= thumbnailIfd &&
    thumbnailIfd < out.length
    ? out.slice(0, thumbnailIfd)
    : out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

function injectIntoJpeg(
  data: Uint8Array,
  tiff: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  if (
    tiff.length > JPEG_MAX_EXIF_BYTES ||
    data[0] !== 0xff ||
    data[1] !== 0xd8
  ) {
    return null
  }
  const segment = new Uint8Array(4 + 6 + tiff.length)
  segment[0] = 0xff
  segment[1] = 0xe1
  new DataView(segment.buffer).setUint16(2, 2 + 6 + tiff.length, false)
  segment.set(bytes('Exif\0\0'), 4)
  segment.set(tiff, 10)
  return concat([data.subarray(0, 2), segment, data.subarray(2)])
}

function injectIntoPng(
  data: Uint8Array,
  tiff: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  // 8-byte signature, then IHDR: length(4) + type(4) + 13 data + crc(4).
  const afterHeader = 8 + 25
  if (ascii(data, 12, 4) !== 'IHDR' || data.length < afterHeader) return null
  const chunk = new Uint8Array(12 + tiff.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, tiff.length, false)
  chunk.set(bytes('eXIf'), 4)
  chunk.set(tiff, 8)
  view.setUint32(
    8 + tiff.length,
    crc32(chunk.subarray(4, 8 + tiff.length)),
    false,
  )
  return concat([
    data.subarray(0, afterHeader),
    chunk,
    data.subarray(afterHeader),
  ])
}

function webpChunk(type: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length + (payload.length % 2)
  const chunk = new Uint8Array(8 + padded)
  chunk.set(bytes(type), 0)
  new DataView(chunk.buffer).setUint32(4, payload.length, true)
  chunk.set(payload, 8)
  return chunk
}

function withRiffSize(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  new DataView(data.buffer, data.byteOffset).setUint32(4, data.length - 8, true)
  return data
}

function injectIntoWebp(
  data: Uint8Array,
  tiff: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> | null {
  if (ascii(data, 0, 4) !== 'RIFF' || data.length < 20) return null
  const exifChunk = webpChunk('EXIF', tiff)

  if (ascii(data, 12, 4) === 'VP8X') {
    const out = concat([data, exifChunk])
    out[20] |= 0x08
    return withRiffSize(out)
  }

  // Plain VP8/VP8L files have no feature header, so EXIF needs a VP8X wrapper.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const hasAlpha =
    ascii(data, 12, 4) === 'VP8L' &&
    ((view.getUint32(21, true) >>> 28) & 1) === 1
  const vp8x = new Uint8Array(10)
  vp8x[0] = 0x08 | (hasAlpha ? 0x10 : 0)
  vp8x[4] = (width - 1) & 0xff
  vp8x[5] = ((width - 1) >> 8) & 0xff
  vp8x[6] = ((width - 1) >> 16) & 0xff
  vp8x[7] = (height - 1) & 0xff
  vp8x[8] = ((height - 1) >> 8) & 0xff
  vp8x[9] = ((height - 1) >> 16) & 0xff
  return withRiffSize(
    concat([
      data.subarray(0, 12),
      webpChunk('VP8X', vp8x),
      data.subarray(12),
      exifChunk,
    ]),
  )
}

/**
 * Copies the source's EXIF into the encoded output. Best effort: when the
 * source has no EXIF, the format is unsupported, or the output cannot take the
 * block, the encoded blob is returned unchanged.
 */
export async function preserveExif(
  source: ArrayBuffer,
  encoded: Blob,
  format: OutputFormat,
  size: { width: number; height: number },
): Promise<Blob> {
  if (!supportsExif(format)) return encoded
  try {
    const tiff = extractExif(source)
    if (!tiff) return encoded
    const exif = sanitizeExif(tiff, size.width, size.height)
    const data = new Uint8Array(await encoded.arrayBuffer())
    const merged =
      format === 'jpeg'
        ? injectIntoJpeg(data, exif)
        : format === 'png'
          ? injectIntoPng(data, exif)
          : injectIntoWebp(data, exif, size.width, size.height)
    return merged ? new Blob([merged], { type: encoded.type }) : encoded
  } catch {
    return encoded
  }
}
