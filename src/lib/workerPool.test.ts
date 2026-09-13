import { describe, expect, it } from 'vitest'
import type { ResultResponse, WorkerRequest, WorkerResponse } from './protocol'
import { type PoolTask, type PoolWorker, WorkerPool } from './workerPool'

function resultFor(jobId: string): ResultResponse {
  return {
    type: 'result',
    jobId,
    outputBlob: new Blob([new ArrayBuffer(1)]),
    thumbnailBlob: new Blob([new ArrayBuffer(1)]),
    outputSize: 1,
    width: 1,
    height: 1,
    format: 'webp',
    extension: 'webp',
    mimeType: 'image/webp',
    capped: false,
  }
}

function task(jobId: string): PoolTask {
  return {
    jobId,
    message: {
      type: 'process',
      jobId,
      fileBuffer: new ArrayBuffer(1),
      targetFormat: 'webp',
    },
  }
}

class FakeWorker implements PoolWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: WorkerRequest[] = []
  terminated = false

  constructor(
    private readonly onPost: (
      worker: FakeWorker,
      message: WorkerRequest,
    ) => void,
  ) {}

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
    this.onPost(this, message)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>)
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

describe('WorkerPool', () => {
  it('resolves a job with the worker result', async () => {
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) =>
          worker.respond(resultFor(message.jobId)),
        ),
    })

    await expect(pool.run(task('a'))).resolves.toMatchObject({
      jobId: 'a',
      type: 'result',
    })
  })

  it('rejects a job error but keeps processing the next job', async () => {
    let count = 0
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          count += 1
          if (count === 1) {
            worker.respond({
              type: 'error',
              jobId: message.jobId,
              error: 'bad file',
            })
          } else {
            worker.respond(resultFor(message.jobId))
          }
        }),
    })

    await expect(pool.run(task('a'))).rejects.toThrow('bad file')
    await expect(pool.run(task('b'))).resolves.toMatchObject({ jobId: 'b' })
  })

  it('recovers from a worker crash without stalling', async () => {
    let created = 0
    const pool = new WorkerPool({
      size: 1,
      createWorker: () => {
        created += 1
        const index = created
        return new FakeWorker((worker, message) => {
          if (index === 1) worker.crash('boom')
          else worker.respond(resultFor(message.jobId))
        })
      },
    })

    await expect(pool.run(task('a'))).rejects.toThrow('boom')
    await expect(pool.run(task('b'))).resolves.toMatchObject({ jobId: 'b' })
    expect(created).toBe(2)
  })

  it('never exceeds the configured pool size and queues the rest', async () => {
    const created: FakeWorker[] = []
    const pool = new WorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker(() => {})
        created.push(worker)
        return worker
      },
    })

    const promises = [
      pool.run(task('a')),
      pool.run(task('b')),
      pool.run(task('c')),
    ]

    expect(created).toHaveLength(2)
    expect(pool.workerCount).toBe(2)
    expect(
      created.reduce((total, worker) => total + worker.posted.length, 0),
    ).toBe(2)

    pool.terminate()
    await Promise.allSettled(promises)
  })

  it('dispatches queued jobs in FIFO order', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          order.push(message.jobId)
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'))
    const second = pool.run(task('b'))
    const third = pool.run(task('c'))

    releases.shift()?.()
    await first
    releases.shift()?.()
    await second
    releases.shift()?.()
    await third

    expect(order).toEqual(['a', 'b', 'c'])
    pool.terminate()
  })

  it('resolves estimate responses as well as results', async () => {
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) =>
          worker.respond({
            type: 'estimate',
            jobId: message.jobId,
            width: 2,
            height: 2,
            samples: [{ quality: 50, bytes: 10 }],
            thumbnailBlob: new Blob([new ArrayBuffer(1)]),
            capped: false,
          }),
        ),
    })

    await expect(pool.run(task('a'))).resolves.toMatchObject({
      type: 'estimate',
      jobId: 'a',
    })
    pool.terminate()
  })

  it('reports busy and queued counts and notifies on change', async () => {
    const releases: Array<() => void> = []
    let changes = 0
    const pool = new WorkerPool({
      size: 1,
      onChange: () => {
        changes += 1
      },
      createWorker: () =>
        new FakeWorker((worker, message) => {
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'))
    const second = pool.run(task('b'))

    expect(pool.busyCount).toBe(1)
    expect(pool.queuedCount).toBe(1)
    expect(changes).toBeGreaterThan(0)

    releases.shift()?.()
    await first
    expect(pool.busyCount).toBe(1)
    expect(pool.queuedCount).toBe(0)

    releases.shift()?.()
    await second
    expect(pool.busyCount).toBe(0)
    expect(pool.queuedCount).toBe(0)

    pool.terminate()
  })

  it('dispatches high-priority jobs before queued low-priority jobs', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          order.push(message.jobId)
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'), 'high')
    const low = pool.run(task('b'), 'low')
    const high = pool.run(task('c'), 'high')

    releases.shift()?.()
    await first
    releases.shift()?.()
    await high
    releases.shift()?.()
    await low

    expect(order).toEqual(['a', 'c', 'b'])
    pool.terminate()
  })

  it('removes a queued job when its signal aborts', async () => {
    const pool = new WorkerPool({
      size: 1,
      createWorker: () => new FakeWorker(() => {}),
    })

    const running = pool.run(task('a'))
    const controller = new AbortController()
    const queued = pool.run({ ...task('b'), signal: controller.signal }, 'low')
    controller.abort()

    await expect(queued).rejects.toThrow('Task cancelled')
    expect(pool.queuedCount).toBe(0)

    pool.terminate()
    await Promise.allSettled([running])
  })

  it('materializes a queued task only when a worker is free', async () => {
    const releases: Array<() => void> = []
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'))
    let prepared = 0
    const second = pool.run({
      jobId: 'b',
      prepare: async () => {
        prepared += 1
        return { message: task('b').message as WorkerRequest }
      },
    })

    expect(prepared).toBe(0)
    expect(pool.queuedCount).toBe(1)

    releases.shift()?.()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prepared).toBe(1)
    expect(pool.busyCount).toBe(1)

    releases.shift()?.()
    await second
    pool.terminate()
  })
})

describe('WorkerPool memory budget', () => {
  function costTask(jobId: string, cost: number): PoolTask {
    return { ...task(jobId), cost }
  }

  function holdingPool(options: { size: number; memoryBudget: number }): {
    pool: WorkerPool
    releases: Array<() => void>
  } {
    const releases: Array<() => void> = []
    const pool = new WorkerPool({
      size: options.size,
      memoryBudget: options.memoryBudget,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })
    return { pool, releases }
  }

  it('admits jobs only while their cost fits the remaining budget', () => {
    const { pool, releases } = holdingPool({ size: 4, memoryBudget: 1000 })
    const promises = [
      pool.run(costTask('a', 400)),
      pool.run(costTask('b', 400)),
      pool.run(costTask('c', 400)),
      pool.run(costTask('d', 400)),
    ]

    // 400 + 400 <= 1000; the third would reach 1200.
    expect(pool.busyCount).toBe(2)
    expect(pool.queuedCount).toBe(2)
    expect(pool.activeCostCount).toBe(800)

    // Finishing one frees 400 MB, so one queued job takes its place.
    releases.shift()?.()
    expect(pool.busyCount).toBe(2)
    expect(pool.queuedCount).toBe(1)
    expect(pool.activeCostCount).toBe(800)

    pool.terminate()
    void Promise.allSettled(promises)
  })

  it('always admits one job even when it alone exceeds the budget', () => {
    const { pool, releases } = holdingPool({ size: 4, memoryBudget: 100 })
    const promises = [
      pool.run(costTask('a', 500)),
      pool.run(costTask('b', 500)),
    ]

    expect(pool.busyCount).toBe(1)
    expect(pool.queuedCount).toBe(1)

    pool.terminate()
    for (const release of releases) release()
    void Promise.allSettled(promises)
  })

  it('disables gating when the budget is zero', () => {
    const { pool } = holdingPool({ size: 3, memoryBudget: 0 })
    const promises = [
      pool.run(costTask('a', 1_000_000)),
      pool.run(costTask('b', 1_000_000)),
      pool.run(costTask('c', 1_000_000)),
    ]

    expect(pool.busyCount).toBe(3)
    pool.terminate()
    void Promise.allSettled(promises)
  })

  it('releases cost when a job completes and dispatches the next', async () => {
    const { pool, releases } = holdingPool({ size: 4, memoryBudget: 1000 })
    const first = pool.run(costTask('a', 400))
    const second = pool.run(costTask('b', 400))
    const third = pool.run(costTask('c', 400))

    expect(pool.activeCostCount).toBe(800)
    releases.shift()?.()
    await first
    expect(pool.activeCostCount).toBe(800)
    expect(pool.busyCount).toBe(2)

    releases.shift()?.()
    releases.shift()?.()
    await Promise.all([second, third])
    expect(pool.activeCostCount).toBe(0)
    pool.terminate()
  })

  it('raises the ceiling at runtime and dispatches queued work', () => {
    const { pool } = holdingPool({ size: 3, memoryBudget: 100 })
    const promises = [
      pool.run(costTask('a', 60)),
      pool.run(costTask('b', 60)),
      pool.run(costTask('c', 60)),
    ]
    expect(pool.busyCount).toBe(1)

    pool.setMemoryBudget(200)
    expect(pool.busyCount).toBe(3)

    pool.terminate()
    void Promise.allSettled(promises)
  })
})

describe('WorkerPool failure handling', () => {
  it('reports worker failures so callers can back off', async () => {
    let failures = 0
    let created = 0
    const pool = new WorkerPool({
      size: 1,
      onWorkerFailure: () => {
        failures += 1
      },
      createWorker: () => {
        created += 1
        const index = created
        return new FakeWorker((worker, message) => {
          if (index === 1) worker.crash('boom')
          else worker.respond(resultFor(message.jobId))
        })
      },
    })

    await expect(pool.run(task('a'))).rejects.toThrow('boom')
    expect(failures).toBe(1)
    await expect(pool.run(task('b'))).resolves.toMatchObject({ jobId: 'b' })
    pool.terminate()
  })
})
