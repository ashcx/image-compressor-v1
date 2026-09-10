import type { OutputFormat } from './codecs/types'
import type { ProcessRequest, ResultResponse } from './protocol'
import { WorkerPool } from './workerPool'

const MAX_WORKERS = 8

let pool: WorkerPool | null = null
let counter = 0

function getPool(): WorkerPool {
  if (!pool) {
    const coreCount =
      typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
    pool = new WorkerPool({
      size: Math.min(coreCount, MAX_WORKERS),
      createWorker: () =>
        new Worker(new URL('../workers/image-worker.ts', import.meta.url), {
          type: 'module',
        }),
    })
  }
  return pool
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

  const response = getPool().run({
    jobId,
    message: request,
    transfer: [request.fileBuffer],
  })

  return { jobId, response }
}
