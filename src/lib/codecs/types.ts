export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'jxl'

export interface EncodeOptions {
  quality?: number
}

export interface Codec {
  readonly format: OutputFormat
  readonly mimeType: string
  readonly extension: string
  encode(imageData: ImageData, options?: EncodeOptions): Promise<ArrayBuffer>
  decode?(buffer: ArrayBuffer): Promise<ImageData>
}
