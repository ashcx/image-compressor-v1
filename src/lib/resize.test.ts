import { describe, expect, it } from 'vitest'
import {
  clampSizeToLimits,
  MAX_WORKING_PIXELS,
  resolveDecodeSize,
  resolveDecodeTargetSize,
  resolveResize,
} from './resize'

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

describe('clampSizeToLimits', () => {
  it('returns null when no limit is provided or exceeded', () => {
    expect(
      clampSizeToLimits({ width: 8000, height: 6000 }, undefined),
    ).toBeNull()
    expect(
      clampSizeToLimits({ width: 800, height: 600 }, { maxSide: 8192 }),
    ).toBeNull()
  })

  it('clamps the long edge to the per-axis ceiling', () => {
    expect(
      clampSizeToLimits({ width: 11656, height: 8742 }, { maxSide: 8192 }),
    ).toEqual({ width: 8192, height: 6144 })
  })

  it('clamps by total area (Blink is area-shaped)', () => {
    // 65535 x 16384 has valid sides but exceeds the 32768 x 8192 area budget.
    expect(
      clampSizeToLimits(
        { width: 65535, height: 16384 },
        { maxSide: 65535, maxArea: 32768 * 8192 },
      ),
    ).toEqual({ width: 32768, height: 8192 })
  })

  it('clamps by the single-job pixel budget', () => {
    expect(
      clampSizeToLimits(
        { width: 10000, height: 10000 },
        { maxPixels: 25_000_000 },
      ),
    ).toEqual({ width: 5000, height: 5000 })
  })

  it('supports the universal 100 MP working-resolution ceiling', () => {
    expect(
      clampSizeToLimits(
        { width: 20000, height: 10000 },
        { maxPixels: MAX_WORKING_PIXELS },
      ),
    ).toEqual({ width: 14142, height: 7071 })
  })

  it('ignores an infinite area ceiling', () => {
    expect(
      clampSizeToLimits(
        { width: 11656, height: 8742 },
        { maxSide: 32767, maxArea: Number.POSITIVE_INFINITY },
      ),
    ).toBeNull()
  })
})

describe('resolveDecodeTargetSize', () => {
  it('returns null when a full decode is allowed', () => {
    expect(resolveDecodeTargetSize(800, 600, undefined, {})).toBeNull()
  })

  it('clamps the full-resolution decode to the platform ceiling', () => {
    expect(
      resolveDecodeTargetSize(11656, 8742, undefined, {
        limits: { maxSide: 8192 },
      }),
    ).toEqual({ width: 8192, height: 6144 })
  })

  it('lets the user resize win when it is already under the ceiling', () => {
    expect(
      resolveDecodeTargetSize(
        11656,
        8742,
        { maxLongEdge: 4000 },
        {
          limits: { maxSide: 8192, maxPixels: 25_000_000 },
        },
      ),
    ).toEqual({ width: 4000, height: 3000 })
  })

  it('clamps further when the resize target still exceeds a ceiling', () => {
    expect(
      resolveDecodeTargetSize(
        11656,
        8742,
        { maxLongEdge: 10000 },
        {
          limits: { maxSide: 8192 },
        },
      ),
    ).toEqual({ width: 8192, height: 6144 })
  })
})
