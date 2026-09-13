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
import { resizeImage, resolveDecodeSize, resolveResize } from '../lib/resize'
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
    // True dimensions come from the header, so a downscaled output can decode
    // straight to its target size instead of decoding full resolution first.
    const dimensions = parseDimensions(request.fileBuffer)
    const decodeSize = dimensions
      ? resolveDecodeSize(
          dimensions.width,
          dimensions.height,
          request.resize,
          request.estimateOnly ? ESTIMATE_DECODE_EDGE : undefined,
        )
      : null
    const decodeTarget = decodeSize
      ? { size: decodeSize }
      : request.estimateOnly
        ? { maxEdge: ESTIMATE_DECODE_EDGE }
        : {}
    const decoded = await decodeImageData(
      request.fileBuffer,
      sourceFormat,
      decodeTarget,
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

    scope.postMessage(response)
  } catch (error) {
    scope.postMessage({
      type: 'error',
      jobId: request.jobId,
      error: error instanceof Error ? error.message : 'Processing failed',
    })
  }
}
