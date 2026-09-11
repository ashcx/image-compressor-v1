import type { OutputFormat, ResizeOptions } from './codecs/types'
import { getDeviceProfile } from './device'
import type { ProcessRequest } from './protocol'
import { type PoolPriority, type PoolSuccess, WorkerPool } from './workerPool'

let pool: WorkerPool | null = null
let counter = 0
const listeners = new Set<() => void>()

export function resolvePoolSize(): number {
  return getDeviceProfile().workerCount
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
  file: File
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  resize?: ResizeOptions
  buildEstimate?: boolean
  estimateOnly?: boolean
  priority?: PoolPriority
  signal?: AbortSignal
}

export function processImage(options: ProcessJobOptions): {
  jobId: string
  response: Promise<PoolSuccess>
} {
  const jobId = `job-${++counter}`

  const response = getPool().run(
    {
      jobId,
      signal: options.signal,
      prepare: async () => {
        // Read the file only when a worker is free; the pool holds `File`
        // handles, not full buffers, while the task is queued.
        const fileBuffer = await options.file.arrayBuffer()
        const message: ProcessRequest = {
          type: 'process',
          jobId,
          fileBuffer,
          targetFormat: options.targetFormat,
          quality: options.quality,
          effort: options.effort,
          speed: options.speed,
          resize: options.resize,
          buildEstimate: options.buildEstimate,
          estimateOnly: options.estimateOnly,
        }
        return { message, transfer: [fileBuffer] }
      },
    },
    options.priority ?? 'high',
  )

  return { jobId, response }
}
