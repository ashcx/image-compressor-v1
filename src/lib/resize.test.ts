import { describe, expect, it } from 'vitest'
import { resolveDecodeSize, resolveResize } from './resize'

describe('resolveResize', () => {
  it('returns null without resize options', () => {
    expect(resolveResize(4000, 3000, undefined)).toBeNull()
  })

  it('scales the long edge down while preserving aspect ratio', () => {
    expect(resolveResize(4000, 3000, { maxLongEdge: 1000 })).toEqual({
      width: 1000,
      height: 750,
    })
    expect(resolveResize(3000, 4000, { maxLongEdge: 1000 })).toEqual({
      width: 750,
      height: 1000,
    })
  })

  it('skips resizing when the image already fits', () => {
    expect(resolveResize(800, 600, { maxLongEdge: 1000 })).toBeNull()
  })

  it('fits within explicit width and height', () => {
    expect(resolveResize(4000, 2000, { width: 1000, height: 1000 })).toEqual({
      width: 1000,
      height: 500,
    })
  })

  it('only scales down for explicit dimensions', () => {
    expect(resolveResize(400, 300, { width: 1000, height: 1000 })).toBeNull()
  })
})

describe('resolveDecodeSize', () => {
  it('decodes at full resolution when nothing shrinks the image', () => {
    expect(resolveDecodeSize(800, 600, undefined)).toBeNull()
    expect(resolveDecodeSize(800, 600, { maxLongEdge: 1000 })).toBeNull()
  })

  it('decodes at the resize target when downscaling', () => {
    expect(resolveDecodeSize(4000, 3000, { maxLongEdge: 1000 })).toEqual({
      width: 1000,
      height: 750,
    })
    // Portrait: the long edge is the height.
    expect(resolveDecodeSize(3000, 4000, { maxLongEdge: 1000 })).toEqual({
      width: 750,
      height: 1000,
    })
  })

  it('applies the estimate cap after the resize target', () => {
    expect(resolveDecodeSize(8000, 6000, undefined, 2048)).toEqual({
      width: 2048,
      height: 1536,
    })
    // A smaller resize target wins over a larger cap.
    expect(resolveDecodeSize(8000, 6000, { maxLongEdge: 1024 }, 2048)).toEqual({
      width: 1024,
      height: 768,
    })
  })

  it('prefers the cap when the resize target is larger', () => {
    expect(resolveDecodeSize(8000, 6000, { maxLongEdge: 4096 }, 2048)).toEqual({
      width: 2048,
      height: 1536,
    })
  })
})
