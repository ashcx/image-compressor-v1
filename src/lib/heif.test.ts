import { describe, expect, it } from 'vitest'
import { readHeifItems } from './heif'

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  out.set(new TextEncoder().encode(type), 4)
  let offset = 8
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function u16(value: number): Uint8Array {
  return bytes(value >> 8, value & 0xff)
}

function u32(value: number): Uint8Array {
  return bytes(
    value >>> 24,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  )
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

function infe(id: number, type: string): Uint8Array {
  return box('infe', bytes(2, 0, 0, 0), u16(id), u16(0), ascii(type), bytes(0))
}

/** A HEIF with an HEVC primary (id 1) and a JPEG thumbnail item (id 2). */
function heifWithJpegItem(
  payload: Uint8Array,
  split = false,
): Uint8Array<ArrayBuffer> {
  const ftyp = box('ftyp', ascii('heic'), u32(0), ascii('mif1'))
  const iinf = box(
    'iinf',
    bytes(0, 0, 0, 0),
    u16(2),
    infe(1, 'hvc1'),
    infe(2, 'jpeg'),
  )
  const ilocFor = (offset: number) =>
    box(
      'iloc',
      bytes(0, 0, 0, 0),
      bytes(0x44, 0x00), // offset size 4, length size 4, base size 0
      u16(2),
      u16(1),
      u16(0),
      u16(1),
      u32(0),
      u32(10), // id 1: offset 0, length 10
      u16(2),
      u16(0),
      ...(split
        ? [
            u16(2),
            u32(offset),
            u32(3),
            u32(offset + 3),
            u32(payload.length - 3),
          ]
        : [u16(1), u32(offset), u32(payload.length)]),
    )
  const metaWith = (offset: number) =>
    box('meta', bytes(0, 0, 0, 0), iinf, ilocFor(offset))
  const offset = ftyp.length + metaWith(0).length + 8 // after the mdat header
  const mdat = box('mdat', payload)
  return Uint8Array.from([...ftyp, ...metaWith(offset), ...mdat])
}

describe('readHeifItems', () => {
  it('lists items with their types and byte ranges', async () => {
    const payload = ascii('jpeg-bytes')
    const file = heifWithJpegItem(payload)
    const items = await readHeifItems(new Blob([file]))

    expect(items.map((item) => item.type)).toEqual(['hvc1', 'jpeg'])
    const [extent] = items[1].extents
    expect(
      new TextDecoder().decode(
        file.subarray(extent.offset, extent.offset + extent.length),
      ),
    ).toBe('jpeg-bytes')
  })

  it('keeps every extent of an item stored in pieces', async () => {
    const file = heifWithJpegItem(ascii('jpeg-bytes'), true)
    const items = await readHeifItems(new Blob([file]))

    const jpeg = items.find((item) => item.type === 'jpeg')
    expect(jpeg?.extents).toHaveLength(2)
    const text = jpeg?.extents
      .map(({ offset, length }) =>
        new TextDecoder().decode(file.subarray(offset, offset + length)),
      )
      .join('')
    expect(text).toBe('jpeg-bytes')
  })

  it('returns nothing for truncated or non-HEIF input', async () => {
    const file = heifWithJpegItem(ascii('x'))
    expect(await readHeifItems(new Blob([file.slice(0, 40)]))).toEqual([])
    expect(
      await readHeifItems(new Blob([ascii('not a heif file at all')])),
    ).toEqual([])
    expect(await readHeifItems(new Blob([]))).toEqual([])
  })
})
