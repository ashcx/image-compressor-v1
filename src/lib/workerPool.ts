import type { WorkerRequest, WorkerResponse } from './protocol'

export type PoolSuccess = Exclude<WorkerResponse, { type: 'error' }>

export interface PoolWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface PoolTask {
  jobId: string
  message: WorkerRequest
  transfer?: Transferable[]
}

interface QueuedTask extends PoolTask {
  resolve: (response: PoolSuccess) => void
  reject: (error: Error) => void
}

export interface WorkerPoolOptions {
  size: number
  createWorker: () => PoolWorker
  onChange?: () => void
}

/**
 * A fixed-size pool of workers fed by a FIFO job queue. Each idle worker pulls the
 * next queued job; a failed job (error response or worker crash) rejects only that
 * job and never stalls the queue.
 */
export class WorkerPool {
  private readonly size: number
  private readonly createWorker: () => PoolWorker
  private readonly onChange: (() => void) | undefined
  private workers: PoolWorker[] = []
  private idle: PoolWorker[] = []
  private queue: QueuedTask[] = []
  private readonly busy = new Map<PoolWorker, QueuedTask>()
  private closed = false

  constructor(options: WorkerPoolOptions) {
    this.size = Math.max(1, options.size)
    this.createWorker = options.createWorker
    this.onChange = options.onChange
  }

  get workerCount(): number {
    return this.workers.length
  }

  get busyCount(): number {
    return this.busy.size
  }

  get queuedCount(): number {
    return this.queue.length
  }

  run(task: PoolTask): Promise<PoolSuccess> {
    if (this.closed) return Promise.reject(new Error('Worker pool is closed'))
    return new Promise<PoolSuccess>((resolve, reject) => {
      this.queue.push({ ...task, resolve, reject })
      this.dispatch()
    })
  }

  terminate(): void {
    this.closed = true
    for (const worker of this.workers) worker.terminate()
    for (const task of this.queue)
      task.reject(new Error('Worker pool terminated'))
    for (const task of this.busy.values())
      task.reject(new Error('Worker pool terminated'))
    this.workers = []
    this.idle = []
    this.queue = []
    this.busy.clear()
    this.notify()
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? this.spawn()
      if (!worker) {
        this.notify()
        return
      }
      const task = this.queue.shift()
      if (!task) {
        this.idle.push(worker)
        this.notify()
        return
      }
      this.busy.set(worker, task)
      worker.postMessage(task.message, task.transfer)
    }
    this.notify()
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

    const response = event.data
    if (response.type === 'error') {
      task.reject(new Error(response.error))
    } else {
      task.resolve(response)
    }

    this.idle.push(worker)
    this.dispatch()
  }

  private handleError(worker: PoolWorker, event: ErrorEvent): void {
    const task = this.busy.get(worker)
    if (task) {
      this.busy.delete(worker)
      task.reject(new Error(event.message || 'Worker failed'))
    }

    this.workers = this.workers.filter((candidate) => candidate !== worker)
    this.idle = this.idle.filter((candidate) => candidate !== worker)
    worker.terminate()

    if (!this.closed) this.dispatch()
    else this.notify()
  }

  private notify(): void {
    this.onChange?.()
  }
}
