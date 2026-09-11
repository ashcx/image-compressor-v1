import type { OutputFormat, ResizeOptions } from './codecs/types'
import { getDeviceProfile } from './device'
import type { ProcessRequest } from './protocol'
import { type PoolPriority, type PoolSuccess, WorkerPool } from './workerPool'

let pool: WorkerPool | null = null
let desiredSize = getDeviceProfile().workerCount
let counter = 0
const listeners = new Set<() => void>()

export function resolvePoolSize(): number {
  return desiredSize
}

/**
 * Sets the worker budget (e.g. half for heavy codecs). Recreates the pool
 * lazily the next time a worker is needed if the current one is idle.
 */
export function configureWorkers(size: number): void {
  const next = Math.max(1, Math.floor(size))
  if (next === desiredSize) return
  desiredSize = next
  if (pool && pool.busyCount === 0 && pool.queuedCount === 0) {
    pool.terminate()
    pool = null
  }
  for (const listener of listeners) listener()
}

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      size: desiredSize,
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
  readFile: () => Promise<ArrayBuffer>
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  mode?: number
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
        // The buffer is read eagerly at selection time (see fileBufferStore) and
        // cached per job; it is cloned rather than transferred so the same job
        // can reuse it for both size estimation and compression.
        const fileBuffer = await options.readFile()
        const message: ProcessRequest = {
          type: 'process',
          jobId,
          fileBuffer,
          targetFormat: options.targetFormat,
          quality: options.quality,
          effort: options.effort,
          speed: options.speed,
          mode: options.mode,
          resize: options.resize,
          buildEstimate: options.buildEstimate,
          estimateOnly: options.estimateOnly,
        }
        return { message }
      },
    },
    options.priority ?? 'high',
  )

  return { jobId, response }
}
