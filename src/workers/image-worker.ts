import { encodeImageData } from '../lib/convert'
import { detectFormat } from '../lib/detect'
import { buildEstimateSamples } from '../lib/estimate'
import { decodeImageData } from '../lib/image'
import type {
  EstimateResponse,
  ResultResponse,
  WorkerRequest,
  WorkerResponse,
} from '../lib/protocol'
import { resizeImageData } from '../lib/resize'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'process') return

  try {
    const sourceFormat = detectFormat(request.fileBuffer)
    const decoded = await decodeImageData(request.fileBuffer, sourceFormat)
    const imageData = await resizeImageData(decoded, request.resize)

    if (request.estimateOnly) {
      const samples = await buildEstimateSamples(
        imageData,
        request.targetFormat,
        { effort: request.effort, speed: request.speed, mode: request.mode },
      )
      const response: EstimateResponse = {
        type: 'estimate',
        jobId: request.jobId,
        width: imageData.width,
        height: imageData.height,
        samples,
      }
      scope.postMessage(response)
      return
    }

    const encoded = await encodeImageData(imageData, request.targetFormat, {
      quality: request.quality,
      effort: request.effort,
      speed: request.speed,
      mode: request.mode,
    })

    const response: ResultResponse = {
      type: 'result',
      jobId: request.jobId,
      outputBuffer: encoded.buffer,
      outputSize: encoded.buffer.byteLength,
      width: encoded.width,
      height: encoded.height,
      format: encoded.format,
      extension: encoded.extension,
      mimeType: encoded.mimeType,
    }

    if (request.buildEstimate) {
      response.samples = await buildEstimateSamples(
        imageData,
        request.targetFormat,
        { effort: request.effort, speed: request.speed, mode: request.mode },
      )
    }

    scope.postMessage(response, [response.outputBuffer])
  } catch (error) {
    scope.postMessage({
      type: 'error',
      jobId: request.jobId,
      error: error instanceof Error ? error.message : 'Processing failed',
    })
  }
}
