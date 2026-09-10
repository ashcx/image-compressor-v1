import type { OutputFormat } from './codecs/types'
import type { ProcessRequest, ResultResponse, WorkerResponse } from './protocol'

interface Pending {
  resolve: (response: ResultResponse) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
const pending = new Map<string, Pending>()
let counter = 0

function getWorker(): Worker {
  if (worker) return worker

  const instance = new Worker(
    new URL('../workers/image-worker.ts', import.meta.url),
    {
      type: 'module',
    },
  )

  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const entry = pending.get(response.jobId)
    if (!entry) return
    pending.delete(response.jobId)
    if (response.type === 'result') {
      entry.resolve(response)
    } else {
      entry.reject(new Error(response.error))
    }
  }

  instance.onerror = (event) => {
    const error = new Error(event.message || 'Image worker failed')
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  worker = instance
  return worker
}

export interface ProcessJobOptions {
  fileBuffer: ArrayBuffer
  targetFormat: OutputFormat
  quality?: number
  buildEstimate?: boolean
}

export function processImage(options: ProcessJobOptions): {
  jobId: string
  response: Promise<ResultResponse>
} {
  const jobId = `job-${++counter}`
  const request: ProcessRequest = {
    type: 'process',
    jobId,
    fileBuffer: options.fileBuffer,
    targetFormat: options.targetFormat,
    quality: options.quality,
    buildEstimate: options.buildEstimate,
  }

  const response = new Promise<ResultResponse>((resolve, reject) => {
    pending.set(jobId, { resolve, reject })
    try {
      getWorker().postMessage(request, [request.fileBuffer])
    } catch (error) {
      pending.delete(jobId)
      reject(error instanceof Error ? error : new Error('Failed to post job'))
    }
  })

  return { jobId, response }
}
