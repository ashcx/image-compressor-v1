import { encodeImageData } from '../lib/convert'
import { buildEstimateSamples } from '../lib/estimate'
import { decodeImageData } from '../lib/image'
import type {
  ResultResponse,
  WorkerRequest,
  WorkerResponse,
} from '../lib/protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'process') return

  try {
    const imageData = await decodeImageData(request.fileBuffer)
    const encoded = await encodeImageData(imageData, request.targetFormat, {
      quality: request.quality,
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
