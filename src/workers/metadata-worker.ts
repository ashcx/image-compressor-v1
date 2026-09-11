import { parseDimensions } from '../lib/dimensions'

interface MetadataRequest {
  type: 'dimensions'
  jobId: string
  file: File
}

interface MetadataResponse {
  type: 'dimensions'
  jobId: string
  width: number
  height: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<MetadataRequest>) => void) | null
  postMessage(message: MetadataResponse): void
}

const scope = globalThis as unknown as WorkerScope
const HEADER_BYTES = 256 * 1024

scope.onmessage = async (event) => {
  const request = event.data
  if (request?.type !== 'dimensions') return

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
