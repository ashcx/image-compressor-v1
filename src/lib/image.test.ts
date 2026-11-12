import { describe, expect, it, vi } from 'vitest'
import { BOUNDED_DECODE_ERROR, decodeImageData } from './image'

describe('decodeImageData', () => {
  it('does not retry a failed bounded decode at full resolution', async () => {
    const createImageBitmap = vi
      .fn()
      .mockRejectedValue(new Error('scaled decode unsupported'))
    vi.stubGlobal('createImageBitmap', createImageBitmap)

    await expect(
      decodeImageData(new ArrayBuffer(0), null, {
        size: { width: 8000, height: 4000 },
        allowFullResolutionFallback: false,
      }),
    ).rejects.toThrow(BOUNDED_DECODE_ERROR)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
  })
})
