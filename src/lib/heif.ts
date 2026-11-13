/**
 * Minimal HEIF/ISOBMFF item-table reader. It finds where each item's bytes
 * live in the file, so a caller can read one item without scanning or decoding
 * the whole file. Only items stored by file offset are reported.
 */

export interface HeifItem {
  id: number
  /** Four-character item type, e.g. `hvc1`, `Exif`, `jpeg`, `mime`. */
  type: string
  /** MIME type of a `mime` item; empty otherwise. */
  contentType: string
  /** Where the item's bytes live in the file, in order. */
  extents: HeifExtent[]
}

export interface HeifExtent {
  offset: number
  length: number
}

export interface BoxHeader {
  type: string
  /** Offset of the box payload from the start of the buffer. */
  payload: number
  /** Offset one past the last byte of the box. */
  end: number
}

const TEXT = new TextDecoder('latin1')

function fourcc(data: Uint8Array, offset: number): string {
  return TEXT.decode(data.subarray(offset, offset + 4))
}

interface BoxSize {
  type: string
  headerSize: number
  /** Total box size including its header. */
  size: number
}

/** Reads a box's type and size from at most 16 bytes at `offset`. */
function peekBox(
  data: Uint8Array,
  offset: number,
  limit: number,
): BoxSize | null {
  if (offset + 8 > limit) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let size = view.getUint32(offset)
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > limit) return null
    size = Number(view.getBigUint64(offset + 8))
    headerSize = 16
  }
  return { type: fourcc(data, offset + 4), headerSize, size }
}

/** Reads one box header at `offset`; `null` when it is truncated or invalid. */
export function readBoxHeader(
  data: Uint8Array,
  offset: number,
  limit = data.length,
): BoxHeader | null {
  const box = peekBox(data, offset, limit)
  if (!box) return null
  // A size of zero means the box runs to the end of the enclosing range.
  const size = box.size === 0 ? limit - offset : box.size
  if (size < box.headerSize || offset + size > limit) return null
  return {
    type: box.type,
    payload: offset + box.headerSize,
    end: offset + size,
  }
}

function childBoxes(data: Uint8Array, start: number, end: number): BoxHeader[] {
  const boxes: BoxHeader[] = []
  let offset = start
  while (offset < end) {
    const box = readBoxHeader(data, offset, end)
    if (!box) break
    boxes.push(box)
    offset = box.end
  }
  return boxes
}

class Reader {
  private readonly view: DataView
  constructor(
    private readonly data: Uint8Array,
    public offset: number,
    private readonly end: number,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  get remaining(): number {
    return this.end - this.offset
  }

  uint(bytes: number): number {
    if (bytes === 0) return 0
    if (this.offset + bytes > this.end) throw new RangeError('truncated box')
    let value = 0
    for (let index = 0; index < bytes; index += 1) {
      value = value * 256 + this.view.getUint8(this.offset + index)
    }
    this.offset += bytes
    return value
  }

  fourcc(): string {
    if (this.offset + 4 > this.end) throw new RangeError('truncated box')
    const value = fourcc(this.data, this.offset)
    this.offset += 4
    return value
  }

  /** Null-terminated string. */
  cstring(): string {
    let stop = this.offset
    while (stop < this.end && this.data[stop] !== 0) stop += 1
    const value = TEXT.decode(this.data.subarray(this.offset, stop))
    this.offset = Math.min(stop + 1, this.end)
    return value
  }
}

interface InfoEntry {
  id: number
  type: string
  contentType: string
}

function parseIinf(data: Uint8Array, box: BoxHeader): InfoEntry[] {
  const reader = new Reader(data, box.payload, box.end)
  const version = reader.uint(1)
  reader.uint(3)
  reader.uint(version === 0 ? 2 : 4)
  const entries: InfoEntry[] = []
  for (const infe of childBoxes(data, reader.offset, box.end)) {
    if (infe.type !== 'infe') continue
    const entry = new Reader(data, infe.payload, infe.end)
    const infeVersion = entry.uint(1)
    entry.uint(3)
    if (infeVersion < 2) continue
    const id = entry.uint(infeVersion === 2 ? 2 : 4)
    entry.uint(2)
    const type = entry.fourcc()
    entry.cstring()
    entries.push({
      id,
      type,
      contentType: type === 'mime' ? entry.cstring() : '',
    })
  }
  return entries
}

function parseIloc(
  data: Uint8Array,
  box: BoxHeader,
): Map<number, HeifExtent[]> {
  const reader = new Reader(data, box.payload, box.end)
  const version = reader.uint(1)
  reader.uint(3)
  const sizes = reader.uint(2)
  const offsetSize = sizes >> 12
  const lengthSize = (sizes >> 8) & 0xf
  const baseOffsetSize = (sizes >> 4) & 0xf
  const indexSize = version === 1 || version === 2 ? sizes & 0xf : 0
  const count = reader.uint(version < 2 ? 2 : 4)

  const locations = new Map<number, HeifExtent[]>()
  for (let item = 0; item < count; item += 1) {
    const id = reader.uint(version < 2 ? 2 : 4)
    const method = version === 1 || version === 2 ? reader.uint(2) & 0xf : 0
    reader.uint(2)
    const base = reader.uint(baseOffsetSize)
    const extents = reader.uint(2)
    const ranges: HeifExtent[] = []
    for (let extent = 0; extent < extents; extent += 1) {
      reader.uint(indexSize)
      const offset = reader.uint(offsetSize)
      ranges.push({ offset: base + offset, length: reader.uint(lengthSize) })
    }
    // Only plain file offsets can be sliced straight out of the file.
    if (method === 0 && ranges.length > 0) locations.set(id, ranges)
  }
  return locations
}

/**
 * Items listed in a `meta` box payload range of `data`. Truncated or malformed
 * tables yield an empty list rather than throwing.
 */
export function parseHeifItems(data: Uint8Array, meta: BoxHeader): HeifItem[] {
  try {
    // `meta` is a FullBox: version and flags precede its children.
    const children = childBoxes(data, meta.payload + 4, meta.end)
    const iinf = children.find((box) => box.type === 'iinf')
    const iloc = children.find((box) => box.type === 'iloc')
    if (!iinf || !iloc) return []
    const locations = parseIloc(data, iloc)
    const items: HeifItem[] = []
    for (const entry of parseIinf(data, iinf)) {
      const extents = locations.get(entry.id)
      if (extents) items.push({ ...entry, extents })
    }
    return items
  } catch {
    return []
  }
}

const MAX_META_BYTES = 8 * 1024 * 1024
const MAX_TOP_LEVEL_BOXES = 64

/**
 * Reads the item table of a HEIF file without loading it: walks the top-level
 * boxes with small slices, then reads only the `meta` box.
 */
export async function readHeifItems(file: Blob): Promise<HeifItem[]> {
  let offset = 0
  for (
    let step = 0;
    step < MAX_TOP_LEVEL_BOXES && offset < file.size;
    step += 1
  ) {
    const head = new Uint8Array(
      await file.slice(offset, offset + 16).arrayBuffer(),
    )
    const box = peekBox(head, 0, head.length)
    if (!box) return []
    const size = box.size === 0 ? file.size - offset : box.size
    if (size < box.headerSize) return []
    if (box.type === 'meta') {
      if (size > MAX_META_BYTES) return []
      const data = new Uint8Array(
        await file.slice(offset, offset + size).arrayBuffer(),
      )
      const meta = readBoxHeader(data, 0)
      return meta ? parseHeifItems(data, meta) : []
    }
    offset += size
  }
  return []
}
