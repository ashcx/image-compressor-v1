import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageSource } from './codecs/types'
import {
  createThumbnail,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_QUALITY,
  THUMBNAIL_SHORT_EDGE,
} from './thumbnail'

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = []
  readonly context = {
    fillStyle: '',
    fillRect: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: vi.fn(),
  }
  readonly options: { type?: string; quality?: number }[] = []
  readonly width: number
  readonly height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    FakeOffscreenCanvas.instances.push(this)
  }

  getContext(): OffscreenCanvasRenderingContext2D {
    return this.context as unknown as OffscreenCanvasRenderingContext2D
  }

  async convertToBlob(options: { type?: string; quality?: number }) {
    this.options.push(options)
    return new Blob(['preview'], { type: options.type })
  }
}

afterEach(() => {
  FakeOffscreenCanvas.instances = []
  vi.unstubAllGlobals()
})

describe('createThumbnail', () => {
  it('always emits a small JPEG independent of the source dimensions', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    const sourceCanvas = {} as OffscreenCanvas
    const source: ImageSource = {
      width: 400,
      height: 200,
      canvas: sourceCanvas,
    }

    const blob = await createThumbnail(source)
    const canvas = FakeOffscreenCanvas.instances[0]

    expect(blob.type).toBe(THUMBNAIL_MIME_TYPE)
    expect(canvas.width).toBe(THUMBNAIL_SHORT_EDGE * 2)
    expect(canvas.height).toBe(THUMBNAIL_SHORT_EDGE)
    expect(canvas.options).toEqual([
      { type: THUMBNAIL_MIME_TYPE, quality: THUMBNAIL_QUALITY },
    ])
    expect(canvas.context.drawImage).toHaveBeenCalledWith(
      sourceCanvas,
      0,
      0,
      THUMBNAIL_SHORT_EDGE * 2,
      THUMBNAIL_SHORT_EDGE,
    )
  })

  it('does not upscale smaller source images', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)

    await createThumbnail({
      width: 48,
      height: 24,
      canvas: {} as OffscreenCanvas,
    })

    const canvas = FakeOffscreenCanvas.instances[0]
    expect(canvas.width).toBe(48)
    expect(canvas.height).toBe(24)
  })
})
