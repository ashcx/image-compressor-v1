import { context2d, createCanvas } from '../lib/canvas'
import { encodeImageSource } from '../lib/convert'
import { detectFormat } from '../lib/detect'
import { parseDimensions } from '../lib/dimensions'
import { buildEstimateSamples } from '../lib/estimate'
import { decodeImageData } from '../lib/image'
import type {
  EstimateResponse,
  ResultResponse,
  WarmRequest,
  WorkerRequest,
  WorkerResponse,
} from '../lib/protocol'
import {
  clampSizeToLimits,
  resizeImage,
  resolveDecodeTargetSize,
  resolveResize,
} from '../lib/resize'
import { createThumbnail } from '../lib/thumbnail'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

const scope = globalThis as unknown as WorkerScope

// Estimates sample at 384/896px for ordinary images and 512/1536px when the
// source reaches the 2048px decode cap. This keeps high-resolution samples
// representative without decoding tens of megapixels into a large canvas.
const ESTIMATE_DECODE_EDGE = 2048

// A tiny encode is enough to resolve the codec: native encoders only need their
// support probe, while WASM codecs fetch and instantiate on first encode.
const WARM_EDGE = 2

async function warmCodec(request: WarmRequest): Promise<void> {
  const canvas = createCanvas(WARM_EDGE, WARM_EDGE)
  const context = context2d(canvas)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, WARM_EDGE, WARM_EDGE)
  await encodeImageSource(
    { width: WARM_EDGE, height: WARM_EDGE, canvas },
    request.targetFormat,
    {
      quality: request.quality,
      effort: request.effort,
      speed: request.speed,
      mode: request.mode,
    },
  )
}

scope.onmessage = async (event) => {
  const request = event.data
  if (!request) return

  if (request.type === 'warm') {
    try {
      await warmCodec(request)
      scope.postMessage({ type: 'warm', jobId: request.jobId })
    } catch (error) {
      scope.postMessage({
        type: 'error',
        jobId: request.jobId,
        error: error instanceof Error ? error.message : 'Preload failed',
      })
    }
    return
  }

  if (request.type !== 'process') return

  try {
    const sourceFormat = detectFormat(request.fileBuffer)
    // True dimensions come from the header, so a downscaled output can decode
    // straight to its target size instead of decoding full resolution first.
    const dimensions = parseDimensions(request.fileBuffer)
    const decodeSize = dimensions
      ? resolveDecodeTargetSize(
          dimensions.width,
          dimensions.height,
          request.resize,
          {
            capLongEdge: request.estimateOnly
              ? ESTIMATE_DECODE_EDGE
              : undefined,
            limits: request.limits,
          },
        )
      : null
    const decodeTarget = decodeSize
      ? { size: decodeSize }
      : request.estimateOnly
        ? { maxEdge: ESTIMATE_DECODE_EDGE }
        : {}
    const capped = dimensions
      ? clampSizeToLimits(
          resolveResize(
            dimensions.width,
            dimensions.height,
            request.resize,
          ) ?? {
            width: dimensions.width,
            height: dimensions.height,
          },
          request.limits,
        ) !== null
      : false
    const decoded = await decodeImageData(
      request.fileBuffer,
      sourceFormat,
      decodeTarget,
    )
    const source = resizeImage(decoded, request.resize)

    if (request.estimateOnly) {
      // The estimate runs on a scaled decode, so use the true dimensions from
      // the file header (clamped to the device ceilings) so the reported size
      // matches what a real compression would produce.
      const fullTarget = dimensions
        ? resolveDecodeTargetSize(
            dimensions.width,
            dimensions.height,
            request.resize,
            { limits: request.limits },
          )
        : null
      const fullWidth = fullTarget?.width ?? dimensions?.width ?? source.width
      const fullHeight =
        fullTarget?.height ?? dimensions?.height ?? source.height
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
        capped,
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
      capped,
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
