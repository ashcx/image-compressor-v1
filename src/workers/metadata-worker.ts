import { context2d, createCanvas } from '../lib/canvas'
import { parseDimensions } from '../lib/dimensions'
import { createThumbnail } from '../lib/thumbnail'

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
}

type MetadataResponse = DimensionsResponse | ThumbnailResponse

interface WorkerScope {
  onmessage: ((event: MessageEvent<MetadataRequest>) => void) | null
  postMessage(message: MetadataResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope
const HEADER_BYTES = 256 * 1024

// Previews decode straight to a small bitmap (browsers use a reduced IDCT for
// JPEG), so a row costs a fraction of a full decode. `createThumbnail` trims the
// result to the panel size. Runs here, not on the codec pool, so previews never
// contend with estimation or compression.
const PREVIEW_DECODE_EDGE = 256

async function decodePreview(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, {
      resizeWidth: PREVIEW_DECODE_EDGE,
      resizeQuality: 'high',
    })
  } catch {
    // Browsers without scaled decode fall back to a full decode.
    return createImageBitmap(file)
  }
}

async function generateThumbnail(file: File): Promise<Blob | null> {
  try {
    const bitmap = await decodePreview(file)
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
  } catch {
    return null
  }
}

scope.onmessage = async (event) => {
  const request = event.data
  if (!request) return

  if (request.type === 'thumbnail') {
    const thumbnailBlob = await generateThumbnail(request.file)
    scope.postMessage({
      type: 'thumbnail',
      jobId: request.jobId,
      thumbnailBlob,
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
