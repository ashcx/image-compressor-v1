interface DecodeBitmap {
  width: number
  height: number
  /** RGBA8888 bitmap. */
  data: Uint8Array
}

export interface DecodeImageResult {
  err: string
  data: DecodeBitmap[]
}

export interface EncodeImageResult {
  err: string
  data: Uint8Array
}

/** Must be resolved before calling the decode/encode functions. */
export function ensureInitialized(): Promise<void>

/** Converts a HEIC image to RGBA bitmaps. */
export function jsDecodeImage(buf: Uint8Array): DecodeImageResult

/**
 * Encodes an RGBA bitmap to HEIC.
 *
 * @param quality 0-100 lossy quality (libheif maps this to kvazaar QP).
 * @param preset  kvazaar speed preset: ultrafast, superfast, veryfast, faster,
 *                fast, medium, slow, slower, veryslow, or placebo.
 */
export function jsEncodeImage(
  buf: Uint8Array,
  width: number,
  height: number,
  quality?: number,
  preset?: string,
): EncodeImageResult
