import type { OutputFormat, ResizeOptions } from './codecs/types'
import { getDeviceProfile } from './device'
import type { ProcessRequest } from './protocol'
import { type PoolPriority, type PoolSuccess, WorkerPool } from './workerPool'

let pool: WorkerPool | null = null
let desiredSize = getDeviceProfile().workerCount
let counter = 0
const listeners = new Set<() => void>()

function resolvePoolSize(): number {
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

/** Lowers concurrency after a worker crash, floored at one. */
function backOffWorkers(): void {
  shrinkWorkers()
}

function shrinkWorkers(): void {
  if (desiredSize <= 1) return
  desiredSize -= 1
  pool?.setSize(desiredSize)
  for (const listener of listeners) listener()
}

let lastStallBackoff = 0

/**
 * Reduces the worker budget when the main thread is stalling while work is in
 * flight. Rate-limited so a burst of long tasks cannot shrink the pool to one
 * instantly.
 */
export function noteMainThreadStall(): void {
  const now = Date.now()
  if (now - lastStallBackoff < 10_000) return
  lastStallBackoff = now
  shrinkWorkers()
}

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      size: desiredSize,
      onWorkerFailure: backOffWorkers,
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

/**
 * Terminates the pool when it is idle, releasing the worker isolates, WASM
 * heaps and decoded canvases they hold. The pool is recreated lazily on the
 * next job. Safe to call spuriously: it no-ops while any task is in flight.
 */
export function disposePool(): void {
  if (!pool) return
  if (pool.busyCount > 0 || pool.queuedCount > 0) return
  pool.terminate()
  pool = null
  for (const listener of listeners) listener()
}

export function subscribeToPool(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface PoolStats {
  busy: number
  size: number
}

export function getPoolStats(): PoolStats {
  return {
    busy: pool?.busyCount ?? 0,
    size: resolvePoolSize(),
  }
}

export interface ProcessJobOptions {
  /** Resolves the source bytes; `consume` hands over ownership for transfer. */
  readFile: (consume: boolean) => Promise<ArrayBuffer>
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  mode?: number
  resize?: ResizeOptions
  estimateOnly?: boolean
  /**
   * Transfer the input buffer instead of cloning it. Use only when the buffer
   * will not be read again (not for estimate passes that compression reuses).
   */
  consumeInput?: boolean
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
        // Source bytes are read eagerly at selection time (fileBufferStore). The
        // buffer is transferred when the job will not need it again, saving a
        // full-buffer copy; otherwise it is cloned so a later compression can
        // reuse the same estimate input.
        const consume = options.consumeInput === true
        const fileBuffer = await options.readFile(consume)
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
          estimateOnly: options.estimateOnly,
        }
        return consume ? { message, transfer: [fileBuffer] } : { message }
      },
    },
    options.priority ?? 'high',
  )

  return { jobId, response }
}
