import { describe, expect, it } from 'vitest'
import { parseDimensions } from './dimensions'

function concat(...parts: ArrayLike<number>[]): ArrayBuffer {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out.buffer
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function u32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]
}

function box(type: string, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...ascii(type), ...payload]
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function png(width: number, height: number): ArrayBuffer {
  return concat(
    PNG_SIGNATURE,
    u32be(13),
    ascii('IHDR'),
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0],
  )
}

function jpeg(width: number, height: number): ArrayBuffer {
  const app0 = [
    0xff,
    0xe0,
    ...u16be(16),
    ...ascii('JFIF\0'),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ]
  const sof0 = [
    0xff,
    0xc0,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
  return concat([0xff, 0xd8], app0, sof0, [0xff, 0xd9])
}

function webpVp8x(width: number, height: number): ArrayBuffer {
  const w = width - 1
  const h = height - 1
  const payload = [
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >>> 8) & 0xff,
    (w >>> 16) & 0xff,
    h & 0xff,
    (h >>> 8) & 0xff,
    (h >>> 16) & 0xff,
  ]
  const chunk = [...ascii('VP8X'), ...u32be(payload.length), ...payload]
  return concat(ascii('RIFF'), u32be(4 + chunk.length), ascii('WEBP'), chunk)
}

function webpVp8l(width: number, height: number): ArrayBuffer {
  const w = width - 1
  const h = height - 1
  const b1 = w & 0xff
  const b2 = ((w >>> 8) & 0x3f) | ((h & 0x03) << 6)
  const b3 = (h >>> 2) & 0xff
  const b4 = (h >>> 10) & 0x0f
  const payload = [0x2f, b1, b2, b3, b4]
  const chunk = [...ascii('VP8L'), ...u32be(payload.length), ...payload]
  return concat(ascii('RIFF'), u32be(4 + chunk.length), ascii('WEBP'), chunk)
}

function avif(width: number, height: number): ArrayBuffer {
  const ispe = box('ispe', [0, 0, 0, 0, ...u32be(width), ...u32be(height)])
  const ipco = box('ipco', ispe)
  const iprp = box('iprp', ipco)
  const meta = box('meta', [0, 0, 0, 0, ...iprp])
  const ftyp = box('ftyp', [...ascii('avif'), ...u32be(0), ...ascii('avif')])
  return concat(ftyp, meta)
}

describe('parseDimensions', () => {
  it('parses PNG dimensions from IHDR', () => {
    expect(parseDimensions(png(640, 480))).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('parses JPEG dimensions from a SOF0 segment', () => {
    expect(parseDimensions(jpeg(800, 600))).toEqual({
      width: 800,
      height: 600,
    })
  })

  it('parses WebP VP8X dimensions', () => {
    expect(parseDimensions(webpVp8x(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    })
  })

  it('parses WebP VP8L dimensions', () => {
    expect(parseDimensions(webpVp8l(100, 50))).toEqual({
      width: 100,
      height: 50,
    })
  })

  it('parses AVIF dimensions from the ispe box', () => {
    expect(parseDimensions(avif(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('returns null for an empty buffer', () => {
    expect(parseDimensions(new ArrayBuffer(0))).toBeNull()
  })

  it('returns null for a truncated PNG', () => {
    expect(parseDimensions(bytes(...PNG_SIGNATURE))).toBeNull()
    expect(parseDimensions(bytes(...PNG_SIGNATURE, 0, 0, 0, 13))).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(
      parseDimensions(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)),
    ).toBeNull()
    expect(parseDimensions(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull()
  })

  it('returns null for JPEG XL', () => {
    expect(parseDimensions(bytes(0xff, 0x0a, 0x00, 0x00))).toBeNull()
  })
})
