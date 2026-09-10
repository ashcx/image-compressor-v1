import { describe, expect, it } from 'vitest'
import { resolveResize } from './resize'

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
