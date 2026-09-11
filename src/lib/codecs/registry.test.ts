import { describe, expect, it } from 'vitest'
import { FORMAT_ORDER } from './formats'
import { getCodec, isFormatSupported } from './registry'
import type { OutputFormat } from './types'

const EXPECTED: Record<OutputFormat, { mimeType: string; extension: string }> =
  {
    jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
    png: { mimeType: 'image/png', extension: 'png' },
    webp: { mimeType: 'image/webp', extension: 'webp' },
    avif: { mimeType: 'image/avif', extension: 'avif' },
    jxl: { mimeType: 'image/jxl', extension: 'jxl' },
  }

describe('codec registry', () => {
  it('supports every output format', () => {
    for (const format of FORMAT_ORDER) {
      expect(isFormatSupported(format)).toBe(true)
    }
  })

  it.each(FORMAT_ORDER)(
    'loads the %s codec with the right metadata and functions',
    async (format) => {
      const codec = await getCodec(format)
      expect(codec.format).toBe(format)
      expect(codec.mimeType).toBe(EXPECTED[format].mimeType)
      expect(codec.extension).toBe(EXPECTED[format].extension)
      expect(typeof codec.encode).toBe('function')
      expect(typeof codec.decode).toBe('function')
    },
  )
})
