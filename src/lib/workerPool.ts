import type { WorkerRequest, WorkerResponse } from './protocol'

export type PoolSuccess = Exclude<WorkerResponse, { type: 'error' }>

export type PoolPriority = 'high' | 'low'

export interface PoolWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

interface PreparedTask {
  message: WorkerRequest
  transfer?: Transferable[]
}

export interface PoolTask {
  jobId: string
  /** Eager message. Prefer `prepare` so large buffers are created on dispatch. */
  message?: WorkerRequest
  transfer?: Transferable[]
  /** Resolves the message just before it is posted to an idle worker. */
  prepare?: () => Promise<PreparedTask>
  /** Aborting removes the task from the queue if it has not started yet. */
  signal?: AbortSignal
  /** Estimated decoded pixels, used to gate concurrent large jobs. */
  cost?: number
}

interface QueuedTask extends PoolTask {
  resolve: (response: PoolSuccess) => void
  reject: (error: Error) => void
  settled: boolean
}

interface WorkerPoolOptions {
  size: number
  createWorker: () => PoolWorker
  onChange?: () => void
  /** Total decoded pixels allowed across busy workers; 0 disables gating. */
  pixelBudget?: number
  /** Called when a worker crashes so callers can back off concurrency. */
  onWorkerFailure?: () => void
}

/**
 * A fixed-size pool of workers fed by a two-tier (high/low) job queue. Idle
 * workers pull high-priority jobs first, so user-initiated compression never
 * waits behind background size estimates. Tasks can be aborted while queued,
 * and large payloads can be materialized lazily via `prepare` so a big batch
 * does not allocate every file buffer up front.
 */
export class WorkerPool {
  private size: number
  private readonly createWorker: () => PoolWorker
  private readonly onChange: (() => void) | undefined
  private readonly pixelBudget: number
  private readonly onWorkerFailure: (() => void) | undefined
  private workers: PoolWorker[] = []
  private idle: PoolWorker[] = []
  private high: QueuedTask[] = []
  private low: QueuedTask[] = []
  private readonly busy = new Map<PoolWorker, QueuedTask>()
  private activePixels = 0
  private closed = false

  constructor(options: WorkerPoolOptions) {
    this.size = Math.max(1, options.size)
    this.createWorker = options.createWorker
    this.onChange = options.onChange
    this.pixelBudget = Math.max(0, options.pixelBudget ?? 0)
    this.onWorkerFailure = options.onWorkerFailure
  }

  get workerCount(): number {
    return this.workers.length
  }

  get busyCount(): number {
    return this.busy.size
  }

  get queuedCount(): number {
    return this.high.length + this.low.length
  }

  /** Decoded pixels currently being held by busy workers. */
  get activePixelsCount(): number {
    return this.activePixels
  }

  get pixelBudgetValue(): number {
    return this.pixelBudget
  }

  /** Adjusts the pool ceiling (e.g. lower after a crash). */
  setSize(size: number): void {
    this.size = Math.max(1, Math.floor(size))
    while (this.workers.length > this.size && this.idle.length > 0) {
      const worker = this.idle.pop()
      if (!worker) break
      worker.terminate()
      this.workers = this.workers.filter((candidate) => candidate !== worker)
    }
    this.dispatch()
    this.notify()
  }

  run(task: PoolTask, priority: PoolPriority = 'high'): Promise<PoolSuccess> {
    if (this.closed) return Promise.reject(new Error('Worker pool is closed'))

    return new Promise<PoolSuccess>((resolve, reject) => {
      const queued: QueuedTask = { ...task, resolve, reject, settled: false }
      if (task.signal?.aborted) {
        reject(new Error('Task cancelled'))
        return
      }
      task.signal?.addEventListener('abort', () => this.abort(queued), {
        once: true,
      })
      if (priority === 'high') this.high.push(queued)
      else this.low.push(queued)
      this.dispatch()
    })
  }

  terminate(): void {
    this.closed = true
    for (const worker of this.workers) worker.terminate()
    for (const task of [...this.high, ...this.low, ...this.busy.values()]) {
      this.settleReject(task, new Error('Worker pool terminated'))
    }
    this.workers = []
    this.idle = []
    this.high = []
    this.low = []
    this.busy.clear()
    this.activePixels = 0
    this.notify()
  }

  private abort(task: QueuedTask): void {
    const index = this.high.indexOf(task)
    if (index !== -1) {
      this.high.splice(index, 1)
      this.settleReject(task, new Error('Task cancelled'))
      this.notify()
      return
    }
    const lowIndex = this.low.indexOf(task)
    if (lowIndex !== -1) {
      this.low.splice(lowIndex, 1)
      this.settleReject(task, new Error('Task cancelled'))
      this.notify()
    }
    // Already dispatched: let it finish; callers ignore stale results.
  }

  private hasCapacity(): boolean {
    return this.idle.length > 0 || this.workers.length < this.size
  }

  private canStart(task: QueuedTask): boolean {
    if (this.pixelBudget <= 0) return true
    // Always let at least one job run, even if it alone exceeds the budget.
    if (this.busy.size === 0) return true
    return this.activePixels + (task.cost ?? 0) <= this.pixelBudget
  }

  private takeDispatchable(): QueuedTask | undefined {
    if (this.pixelBudget <= 0) {
      return this.high.shift() ?? this.low.shift()
    }
    // Highest priority task whose pixel cost fits the remaining budget.
    for (const tier of [this.high, this.low]) {
      const index = tier.findIndex((candidate) => this.canStart(candidate))
      if (index !== -1) return tier.splice(index, 1)[0]
    }
    return undefined
  }

  private dispatch(): void {
    while (this.hasCapacity()) {
      const task = this.takeDispatchable()
      if (!task) break
      const worker = this.idle.pop() ?? this.spawn()
      if (!worker) break
      this.activePixels += task.cost ?? 0
      this.busy.set(worker, task)
      void this.prepareAndPost(worker, task)
    }
    this.notify()
  }

  private async prepareAndPost(
    worker: PoolWorker,
    task: QueuedTask,
  ): Promise<void> {
    try {
      const prepared = task.prepare
        ? await task.prepare()
        : { message: task.message, transfer: task.transfer }
      if (!prepared.message) throw new Error('Task has no message')
      if (task.settled) {
        this.release(worker, task)
        return
      }
      worker.postMessage(prepared.message, prepared.transfer)
    } catch (error) {
      this.settleReject(
        task,
        error instanceof Error ? error : new Error('Task preparation failed'),
      )
      this.release(worker, task)
    }
  }

  private spawn(): PoolWorker | null {
    if (this.workers.length >= this.size) return null
    const worker = this.createWorker()
    worker.onmessage = (event) => this.handleMessage(worker, event)
    worker.onerror = (event) => this.handleError(worker, event)
    this.workers.push(worker)
    return worker
  }

  private handleMessage(
    worker: PoolWorker,
    event: MessageEvent<WorkerResponse>,
  ): void {
    const task = this.busy.get(worker)
    if (!task) return
    this.busy.delete(worker)
    this.activePixels -= task.cost ?? 0

    const response = event.data
    if (task.settled) {
      // Cancelled while running; drop the result.
    } else if (response.type === 'error') {
      this.settleReject(task, new Error(response.error))
    } else {
      task.settled = true
      task.resolve(response)
    }

    this.idle.push(worker)
    this.dispatch()
  }

  private handleError(worker: PoolWorker, event: ErrorEvent): void {
    const task = this.busy.get(worker)
    if (task) {
      this.busy.delete(worker)
      this.activePixels -= task.cost ?? 0
      this.settleReject(task, new Error(event.message || 'Worker failed'))
    }

    this.workers = this.workers.filter((candidate) => candidate !== worker)
    this.idle = this.idle.filter((candidate) => candidate !== worker)
    worker.terminate()

    if (!this.closed) {
      this.onWorkerFailure?.()
      this.dispatch()
    } else {
      this.notify()
    }
  }

  private release(worker: PoolWorker, task: QueuedTask): void {
    this.busy.delete(worker)
    this.activePixels -= task.cost ?? 0
    if (!task.settled) task.settled = true
    this.idle.push(worker)
    this.dispatch()
  }

  private settleReject(task: QueuedTask, error: Error): void {
    if (task.settled) return
    task.settled = true
    task.reject(error)
  }

  private notify(): void {
    this.onChange?.()
  }
}
