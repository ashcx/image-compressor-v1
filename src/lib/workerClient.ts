import type { OutputFormat, ResizeOptions } from './codecs/types'
import { getDeviceProfile } from './device'
import type { ProcessLimits, ProcessRequest, WarmRequest } from './protocol'
import { type PoolPriority, type PoolSuccess, WorkerPool } from './workerPool'

let pool: WorkerPool | null = null
let desiredSize = getDeviceProfile().workerCount
let memoryBudget = 0
let counter = 0
let warmController: AbortController | null = null
let warmed = false
const listeners = new Set<() => void>()

function resolvePoolSize(): number {
  return desiredSize
}

/**
 * Sets the decoded-canvas memory ceiling across busy workers (0 disables
 * gating). Jobs are admitted in priority order and any single job may exceed
 * the budget alone, so a large batch cannot run several huge canvases at once.
 */
export function configureMemoryBudget(bytes: number): void {
  const next = Math.max(0, Math.floor(bytes))
  if (next === memoryBudget) return
  memoryBudget = next
  pool?.setMemoryBudget(memoryBudget)
  for (const listener of listeners) listener()
}

export function resolveMemoryBudget(): number {
  return memoryBudget
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
    warmed = false
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
      memoryBudget,
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
  warmed = false
  for (const listener of listeners) listener()
}

export function subscribeToPool(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface WarmOptions {
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  mode?: number
}

/**
 * Initializes the selected codec in every pool worker with a tiny throwaway
 * encode, so the first real compression does not pay the module fetch and WASM
 * instantiation. Tasks run on the worker pool (low priority), entirely off the
 * main thread; a new call cancels the previous warm pass.
 */
export function warmImage(options: WarmOptions): void {
  warmController?.abort()
  const controller = new AbortController()
  warmController = controller
  const pool = getPool()
  for (let i = 0; i < desiredSize; i += 1) {
    const jobId = `warm-${++counter}`
    const message: WarmRequest = {
      type: 'warm',
      jobId,
      targetFormat: options.targetFormat,
      quality: options.quality,
      effort: options.effort,
      speed: options.speed,
      mode: options.mode,
    }
    void pool
      .run({ jobId, signal: controller.signal, message }, 'low')
      .catch(() => {
        // Best-effort: if warming fails the first encode just loads the codec.
      })
  }
  warmed = true
  for (const listener of listeners) listener()
}

/** True while the current pool has been warmed for the selected codec. */
export function isPoolWarm(): boolean {
  return warmed && pool !== null
}

export interface PoolStats {
  busy: number
  /** Workers currently spawned (live). */
  live: number
  /** Configured worker budget the pool is allowed to grow to. */
  size: number
  /** Decoded-memory bytes currently held by busy workers. */
  cost: number
  /** Configured decoded-memory ceiling; 0 when gating is disabled. */
  budget: number
}

export function getPoolStats(): PoolStats {
  return {
    busy: pool?.busyCount ?? 0,
    live: pool?.workerCount ?? 0,
    size: resolvePoolSize(),
    cost: pool?.activeCostCount ?? 0,
    budget: resolveMemoryBudget(),
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
  /** Platform canvas ceilings plus the single-job pixel budget. */
  limits?: ProcessLimits
  /** Estimated decoded-memory bytes, used by the scheduler gate. */
  cost?: number
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
      cost: options.cost ?? 0,
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
          limits: options.limits,
        }
        return consume ? { message, transfer: [fileBuffer] } : { message }
      },
    },
    options.priority ?? 'high',
  )

  return { jobId, response }
}
