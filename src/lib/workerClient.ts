import type { OutputFormat } from './codecs/types'
import type { ProcessRequest } from './protocol'
import { type PoolSuccess, WorkerPool } from './workerPool'

const MAX_WORKERS = 8

let pool: WorkerPool | null = null
let counter = 0
const listeners = new Set<() => void>()

export function resolvePoolSize(): number {
  if (typeof window !== 'undefined') {
    const override = new URLSearchParams(window.location.search).get('workers')
    const parsed = override ? Number.parseInt(override, 10) : Number.NaN
    if (Number.isFinite(parsed) && parsed > 0)
      return Math.min(parsed, MAX_WORKERS)
  }
  const coreCount =
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
  return Math.min(coreCount, MAX_WORKERS)
}

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      size: resolvePoolSize(),
      createWorker: () =>
        new Worker(new URL('../workers/image-worker.ts', import.meta.url), {
          type: 'module',
        }),
      onChange: () => {
        for (const listener of listeners) listener()
      },
    })
  }
  return pool
}

export function subscribeToPool(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface PoolStats {
  busy: number
  workers: number
  size: number
}

export function getPoolStats(): PoolStats {
  return {
    busy: pool?.busyCount ?? 0,
    workers: pool?.workerCount ?? 0,
    size: resolvePoolSize(),
  }
}

export interface ProcessJobOptions {
  fileBuffer: ArrayBuffer
  targetFormat: OutputFormat
  quality?: number
  buildEstimate?: boolean
  estimateOnly?: boolean
}

export function processImage(options: ProcessJobOptions): {
  jobId: string
  response: Promise<PoolSuccess>
} {
  const jobId = `job-${++counter}`
  const request: ProcessRequest = {
    type: 'process',
    jobId,
    fileBuffer: options.fileBuffer,
    targetFormat: options.targetFormat,
    quality: options.quality,
    buildEstimate: options.buildEstimate,
    estimateOnly: options.estimateOnly,
  }

  const response = getPool().run({
    jobId,
    message: request,
    transfer: [request.fileBuffer],
  })

  return { jobId, response }
}
