import { encodeImageSource } from '../lib/convert'
import { detectFormat } from '../lib/detect'
import { buildEstimateSamples } from '../lib/estimate'
import { decodeImageData } from '../lib/image'
import type {
  EstimateResponse,
  ResultResponse,
  WorkerRequest,
  WorkerResponse,
} from '../lib/protocol'
import { resizeImage } from '../lib/resize'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'process') return

  try {
    const sourceFormat = detectFormat(request.fileBuffer)
    const decoded = await decodeImageData(request.fileBuffer, sourceFormat)
    const source = resizeImage(decoded, request.resize)

    if (request.estimateOnly) {
      const samples = await buildEstimateSamples(source, request.targetFormat, {
        effort: request.effort,
        speed: request.speed,
        mode: request.mode,
      })
      const response: EstimateResponse = {
        type: 'estimate',
        jobId: request.jobId,
        width: source.width,
        height: source.height,
        samples,
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

    const response: ResultResponse = {
      type: 'result',
      jobId: request.jobId,
      outputBlob: encoded.blob,
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
        { effort: request.effort, speed: request.speed, mode: request.mode },
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
