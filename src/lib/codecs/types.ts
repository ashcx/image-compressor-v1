export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'jxl'

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

export interface Codec {
  readonly format: OutputFormat
  readonly mimeType: string
  readonly extension: string
  encode(imageData: ImageData, options?: EncodeOptions): Promise<ArrayBuffer>
  decode?(buffer: ArrayBuffer): Promise<ImageData>
}
