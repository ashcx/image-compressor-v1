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
  resize?: ResizeOptions
}

export interface Codec {
  readonly format: OutputFormat
  readonly mimeType: string
  readonly extension: string
  encode(imageData: ImageData, options?: EncodeOptions): Promise<ArrayBuffer>
  decode?(buffer: ArrayBuffer): Promise<ImageData>
}
