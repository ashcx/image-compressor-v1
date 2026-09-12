import { encodeImageSource } from '../lib/convert'
import { detectFormat } from '../lib/detect'
import { parseDimensions } from '../lib/dimensions'
import { buildEstimateSamples } from '../lib/estimate'
import { decodeImageData } from '../lib/image'
import type {
  EstimateResponse,
  ResultResponse,
  WorkerRequest,
  WorkerResponse,
} from '../lib/protocol'
import { resizeImage, resolveResize } from '../lib/resize'
import { createThumbnail } from '../lib/thumbnail'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

const scope = globalThis as unknown as WorkerScope

// Estimates sample at 384/896px; decoding up to 2048px keeps those samples
// representative without decoding tens of megapixels into a large canvas.
const ESTIMATE_DECODE_EDGE = 2048

scope.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'process') return

  try {
    const sourceFormat = detectFormat(request.fileBuffer)
    // Read the true dimensions first: estimates run on a capped decode and
    // small images must not be upscaled.
    const dimensions = request.estimateOnly
      ? parseDimensions(request.fileBuffer)
      : null
    const longEdge = dimensions
      ? Math.max(dimensions.width, dimensions.height)
      : null
    const maxEdge =
      request.estimateOnly &&
      (longEdge == null || longEdge > ESTIMATE_DECODE_EDGE)
        ? ESTIMATE_DECODE_EDGE
        : undefined
    const decoded = await decodeImageData(
      request.fileBuffer,
      sourceFormat,
      maxEdge,
    )
    const source = resizeImage(decoded, request.resize)

    if (request.estimateOnly) {
      // The estimate runs on a scaled decode, so use the true dimensions from
      // the file header and (if resizing) the resolved target size.
      let fullWidth = dimensions?.width ?? source.width
      let fullHeight = dimensions?.height ?? source.height
      const target = resolveResize(fullWidth, fullHeight, request.resize)
      if (target) {
        fullWidth = target.width
        fullHeight = target.height
      }
      const [samples, thumbnailBlob] = await Promise.all([
        buildEstimateSamples(source, request.targetFormat, {
          quality: request.quality,
          effort: request.effort,
          speed: request.speed,
          mode: request.mode,
          fullWidth,
          fullHeight,
        }),
        createThumbnail(source),
      ])
      const response: EstimateResponse = {
        type: 'estimate',
        jobId: request.jobId,
        width: fullWidth,
        height: fullHeight,
        samples,
        thumbnailBlob,
      }
      scope.postMessage(response)
      return
    }

    const encoded = await encodeImageSource(source, request.targetFormat, {
      quality: request.quality,
      effort: request.effort,
      speed: request.speed,
      mode: request.mode,
    })

    const thumbnailBlob = await createThumbnail(source)

    const response: ResultResponse = {
      type: 'result',
      jobId: request.jobId,
      outputBlob: encoded.blob,
      thumbnailBlob,
      outputSize: encoded.blob.size,
      width: encoded.width,
      height: encoded.height,
      format: encoded.format,
      extension: encoded.extension,
      mimeType: encoded.mimeType,
    }

    if (request.buildEstimate) {
      response.samples = await buildEstimateSamples(
        source,
        request.targetFormat,
        {
          quality: request.quality,
          effort: request.effort,
          speed: request.speed,
          mode: request.mode,
        },
      )
    }

    scope.postMessage(response)
  } catch (error) {
    scope.postMessage({
      type: 'error',
      jobId: request.jobId,
      error: error instanceof Error ? error.message : 'Processing failed',
    })
  }
}
