import { describe, expect, it } from 'vitest'
import { detectFormat } from './detect'

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function withHeader(header: number[], length = 32): ArrayBuffer {
  const data = new Uint8Array(length)
  data.set(header)
  return data.buffer
}

describe('detectFormat', () => {
  it('detects JPEG', () => {
    expect(detectFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
  })

  it('detects PNG', () => {
    expect(
      detectFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe('png')
  })

  it('detects WebP from the RIFF container', () => {
    expect(
      detectFormat(
        withHeader([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('webp')
  })

  it('detects AVIF from the ftyp brand', () => {
    expect(
      detectFormat(
        withHeader([
          0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
        ]),
      ),
    ).toBe('avif')
  })

  it('detects HEIC from the ftyp brand', () => {
    expect(
      detectFormat(
        withHeader([
          0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        ]),
      ),
    ).toBe('heic')
  })

  it('classifies a generic mif1 container by its compatible brand', () => {
    const data = new Uint8Array(24)
    const put = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) {
        data[offset + i] = text.charCodeAt(i)
      }
    }
    new DataView(data.buffer).setUint32(0, data.length)
    put(4, 'ftyp')
    put(8, 'mif1')
    put(16, 'avif')
    expect(detectFormat(data.buffer)).toBe('avif')
  })

  it('returns null for unknown data', () => {
    expect(detectFormat(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull()
    expect(detectFormat(bytes(0x00))).toBeNull()
    expect(detectFormat(new ArrayBuffer(0))).toBeNull()
  })
})
