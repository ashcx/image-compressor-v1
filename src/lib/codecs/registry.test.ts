import { describe, expect, it } from 'vitest'
import { FORMAT_ORDER } from './formats'
import { describeDecoder, getCodec } from './registry'
import type { OutputFormat } from './types'

const EXPECTED: Record<OutputFormat, { mimeType: string; extension: string }> =
  {
    jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
    png: { mimeType: 'image/png', extension: 'png' },
    webp: { mimeType: 'image/webp', extension: 'webp' },
    avif: { mimeType: 'image/avif', extension: 'avif' },
    heic: { mimeType: 'image/heic', extension: 'heic' },
  }

describe('codec registry', () => {
  it.each(FORMAT_ORDER)(
    'loads the %s codec with the right metadata and functions',
    async (format) => {
      const codec = await getCodec(format)
      expect(codec.format).toBe(format)
      expect(codec.mimeType).toBe(EXPECTED[format].mimeType)
      expect(codec.extension).toBe(EXPECTED[format].extension)
      expect(typeof codec.encode).toBe('function')
      if (format === 'jpeg' || format === 'webp') {
        // Native-only formats have no WASM decode fallback.
        expect(codec.decode).toBeUndefined()
      } else {
        expect(typeof codec.decode).toBe('function')
      }
    },
  )

  it('describes a decoder backend for every format', async () => {
    for (const format of FORMAT_ORDER) {
      expect(await describeDecoder(format)).toBeTruthy()
    }
    expect(await describeDecoder('heic')).toContain('libheif')
  })
})
