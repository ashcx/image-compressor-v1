export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif'

export interface ResizeOptions {
  width?: number
  height?: number
  maxLongEdge?: number
}

export interface EncodeOptions {
  quality?: number
  effort?: number
  speed?: number
  /** PNG encoder: 0 = native (fast, lossless), 1 = oxipng L0 (lossless), 2 = libimagequant (lossy). */
  mode?: number
  resize?: ResizeOptions
}

/**
 * Decoded pixels held on a canvas. The native encoder consumes the canvas
 * directly, so the pipeline never round-trips through `ImageData` unless a
 * WASM codec explicitly needs it.
 */
export interface ImageSource {
  readonly width: number
  readonly height: number
  readonly canvas: OffscreenCanvas
}

export interface Codec {
  readonly format: OutputFormat
  readonly mimeType: string
  readonly extension: string
  encode(source: ImageSource, options?: EncodeOptions): Promise<Blob>
  decode?(buffer: ArrayBuffer): Promise<ImageData>
}
