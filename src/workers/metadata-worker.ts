import { context2d, createCanvas, scaleImage } from '../lib/canvas'
import type { OutputFormat } from '../lib/codecs/types'
import { detectFormat } from '../lib/detect'
import { type Dimensions, parseDimensions } from '../lib/dimensions'
import { BOUNDED_DECODE_ERROR, decodeImageData } from '../lib/image'
import { createThumbnail, THUMBNAIL_SHORT_EDGE } from '../lib/thumbnail'

interface DimensionsRequest {
  type: 'dimensions'
  jobId: string
  file: File
}

interface ThumbnailRequest {
  type: 'thumbnail'
  jobId: string
  file: File
}

type MetadataRequest = DimensionsRequest | ThumbnailRequest

interface DimensionsResponse {
  type: 'dimensions'
  jobId: string
  width: number
  height: number
}

interface ThumbnailResponse {
  type: 'thumbnail'
  jobId: string
  thumbnailBlob: Blob | null
  thumbnailUnavailable: boolean
}

type MetadataResponse = DimensionsResponse | ThumbnailResponse

interface WorkerScope {
  onmessage: ((event: MessageEvent<MetadataRequest>) => void) | null
  postMessage(message: MetadataResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope
const HEADER_BYTES = 256 * 1024

// Native previews decode straight to the stored thumbnail size (browsers use a
// reduced IDCT for JPEG), so a row costs a fraction of a full decode. Runs here,
// not on the codec pool, so previews never contend with estimation or
// compression.
const PREVIEW_DECODE_EDGE = THUMBNAIL_SHORT_EDGE
const MAX_EMBEDDED_THUMBNAIL_BYTES = 2 * 1024 * 1024
const MAX_EMBEDDED_THUMBNAIL_CANDIDATES = 8

interface ThumbnailResult {
  blob: Blob | null
  unavailable: boolean
}

interface SourceMetadata {
  format: OutputFormat | null
  dimensions: Dimensions | null
}

async function readSourceMetadata(file: File): Promise<SourceMetadata> {
  const header = await file.slice(0, HEADER_BYTES).arrayBuffer()
  return {
    format: detectFormat(header),
    dimensions: parseDimensions(header),
  }
}

function previewTarget(dimensions: Dimensions | null) {
  if (!dimensions) {
    return {
      width: PREVIEW_DECODE_EDGE,
      height: PREVIEW_DECODE_EDGE,
    }
  }
  const short = Math.min(dimensions.width, dimensions.height)
  const long = Math.max(dimensions.width, dimensions.height)
  const scale =
    short > PREVIEW_DECODE_EDGE
      ? PREVIEW_DECODE_EDGE / short
      : long > 256
        ? 256 / long
        : 1
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  }
}

async function decodePreview(
  source: Blob,
  dimensions: Dimensions | null = null,
): Promise<ImageBitmap> {
  const target = previewTarget(dimensions)
  try {
    return await createImageBitmap(source, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    })
  } catch {
    throw new Error(BOUNDED_DECODE_ERROR)
  }
}

async function thumbnailFromBitmap(bitmap: ImageBitmap): Promise<Blob> {
  try {
    const canvas = createCanvas(bitmap.width, bitmap.height)
    context2d(canvas).drawImage(bitmap, 0, 0)
    return await createThumbnail({
      width: bitmap.width,
      height: bitmap.height,
      canvas,
    })
  } finally {
    bitmap.close()
  }
}

function findMarker(
  bytes: Uint8Array,
  start: number,
  first: number,
  second: number,
): number {
  for (let index = start; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === first && bytes[index + 1] === second) return index
  }
  return -1
}

/**
 * Some HEIF files carry a JPEG-encoded auxiliary thumbnail. It is safe to
 * inspect those bytes without decoding the primary HEVC image. HEVC-coded
 * thumbnails are intentionally left unavailable because the current WASM
 * binding exposes no item-level decode API.
 */
async function embeddedJpegThumbnail(file: File): Promise<Blob | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let searchFrom = 0
    let candidates = 0
    while (candidates < MAX_EMBEDDED_THUMBNAIL_CANDIDATES) {
      const start = findMarker(bytes, searchFrom, 0xff, 0xd8)
      if (start < 0) return null
      const end = findMarker(bytes, start + 2, 0xff, 0xd9)
      if (end < 0) return null
      searchFrom = end + 2
      candidates += 1
      if (end + 2 - start > MAX_EMBEDDED_THUMBNAIL_BYTES) continue

      const candidate = new Blob([bytes.slice(start, end + 2)], {
        type: 'image/jpeg',
      })
      try {
        return await thumbnailFromBitmap(await decodePreview(candidate))
      } catch {
        // An incidental marker pair is not a valid embedded JPEG; continue.
      }
    }
  } catch {
    // A malformed container simply has no usable embedded preview.
  }
  return null
}

async function generateThumbnail(file: File): Promise<ThumbnailResult> {
  let sourceFormat: OutputFormat | null = null
  let sourceDimensions: Dimensions | null = null
  try {
    const metadata = await readSourceMetadata(file)
    sourceFormat = metadata.format
    sourceDimensions = metadata.dimensions
  } catch {
    // Native decode below can still identify formats the header parser misses.
  }

  // The bundled HEIC decoder has no resize-at-decode API. Do not spend the
  // full primary-image decode just to paint a tiny row; leave a clear UI
  // placeholder instead. An embedded-thumbnail extractor can replace this
  // early exit later without changing the metadata protocol.
  const isHeic =
    sourceFormat === 'heic' ||
    file.type.toLowerCase() === 'image/heic' ||
    file.type.toLowerCase() === 'image/heif'
  if (isHeic) {
    const embedded = await embeddedJpegThumbnail(file)
    return embedded
      ? { blob: embedded, unavailable: false }
      : { blob: null, unavailable: true }
  }

  try {
    const bitmap = await decodePreview(file, sourceDimensions)
    return {
      blob: await thumbnailFromBitmap(bitmap),
      unavailable: false,
    }
  } catch {
    return generateFallbackThumbnail(file, sourceFormat, sourceDimensions)
  }
}

/**
 * If native decoding fails, use the decoder registered for the detected source
 * format. The destination format is deliberately absent: every source is
 * reduced to the same fixed JPEG preview by `createThumbnail`.
 */
async function generateFallbackThumbnail(
  file: File,
  sourceFormat: OutputFormat | null,
  sourceDimensions: Dimensions | null,
): Promise<ThumbnailResult> {
  try {
    const buffer = await file.arrayBuffer()
    const format = sourceFormat ?? detectFormat(buffer)
    if (!format) return { blob: null, unavailable: false }
    const target = previewTarget(sourceDimensions)
    const maxEdge = Math.max(target.width, target.height)
    const source = await decodeImageData(buffer, format, {
      maxEdge,
    })
    return {
      blob: await createThumbnail(scaleImage(source, maxEdge)),
      unavailable: false,
    }
  } catch {
    return { blob: null, unavailable: false }
  }
}

scope.onmessage = async (event) => {
  const request = event.data
  if (!request) return

  if (request.type === 'thumbnail') {
    const result = await generateThumbnail(request.file)
    scope.postMessage({
      type: 'thumbnail',
      jobId: request.jobId,
      thumbnailBlob: result.blob,
      thumbnailUnavailable: result.unavailable,
    })
    return
  }

  if (request.type !== 'dimensions') return

  let width = 0
  let height = 0
  try {
    const buffer = await request.file.slice(0, HEADER_BYTES).arrayBuffer()
    const dimensions = parseDimensions(buffer)
    if (dimensions) {
      width = dimensions.width
      height = dimensions.height
    }
  } catch {
    // Unreadable/unparsable header: report no dimensions.
  }

  scope.postMessage({ type: 'dimensions', jobId: request.jobId, width, height })
}
