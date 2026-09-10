import { describe, expect, it } from 'vitest'
import { getCodec, isFormatSupported } from './registry'

describe('codec registry', () => {
  it('reports implemented formats as supported', () => {
    expect(isFormatSupported('webp')).toBe(true)
  })

  it('reports not-yet-implemented formats as unsupported', () => {
    expect(isFormatSupported('avif')).toBe(false)
  })

  it('loads an implemented codec with the right metadata', async () => {
    const codec = await getCodec('webp')
    expect(codec.format).toBe('webp')
    expect(codec.mimeType).toBe('image/webp')
    expect(codec.extension).toBe('webp')
    expect(typeof codec.encode).toBe('function')
  })

  it('throws for a format with no codec', async () => {
    await expect(getCodec('avif')).rejects.toThrow(/No codec available/)
  })
})
